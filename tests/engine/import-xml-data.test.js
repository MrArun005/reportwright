// Importers map XML data: SSRS's XML data provider (ElementPath, <Query> with XmlData or a SOAP Method), ActiveReports'
// XML provider (XPath query, XmlDoc/XmlData) and JasperReports xPath queries (fieldDescription XPaths).
import { describe, it, expect } from 'vitest';
import { importRdl } from '../../src/importers/rdl.js';
import { importRdlx } from '../../src/importers/rdlx.js';
import { importJrxml } from '../../src/importers/jrxml.js';
import { loadSources, buildDataSets } from '../../src/engine/data/index.js';

const NS = 'http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rdl = (connect, command, fields) => `<?xml version="1.0"?><Report xmlns="${NS}">
  <DataSources><DataSource Name="S"><ConnectionProperties><DataProvider>XML</DataProvider><ConnectString>${connect}</ConnectString></ConnectionProperties></DataSource></DataSources>
  <DataSets><DataSet Name="D"><Query><DataSourceName>S</DataSourceName><CommandText>${esc(command)}</CommandText></Query>
    <Fields>${fields.map(([n, df, t]) => `<Field Name="${n}"><DataField>${df}</DataField>${t ? `<rd:TypeName xmlns:rd="http://schemas.microsoft.com/SQLServer/reporting/reportdesigner">${t}</rd:TypeName>` : ''}</Field>`).join('')}</Fields></DataSet></DataSets>
  <ReportSections><ReportSection><Body><ReportItems /><Height>1in</Height></Body><Width>6in</Width><Page /></ReportSection></ReportSections></Report>`;
const DOC = '<Customers><Customer ID="7"><Name>Ann</Name><Orders><Order ID="1"><Qty>2</Qty></Order><Order ID="2"><Qty>5</Qty></Order></Orders></Customer><Customer ID="8"><Name>Bob</Name><Orders><Order ID="3"><Qty>1</Qty></Order></Orders></Customer></Customers>';
const rows = async (def, fetchBody) => {
  const sources = await loadSources(def, { params: {}, fetch: async () => ({ ok: true, status: 200, text: async () => fetchBody }) });
  return buildDataSets(def, sources, { params: {}, globals: {}, dataSets: {}, fields: null });
};

describe('SSRS XML data provider', () => {
  it('a URL and an ElementPath: rows from the last element, fields from elements above it', async () => {
    const r = importRdl(rdl('https://data.test/customers.xml', 'Customers {}/Customer {Name}/Orders/Order {@ID(Integer), Qty(Integer)}', [['Name', 'Name'], ['ID', 'ID', 'System.Int32'], ['Qty', 'Qty', 'System.Int32']]));
    const d = r.definition;
    expect(d.dataSources[0]).toEqual({ name: 'S', type: 'xml', url: 'https://data.test/customers.xml' });
    expect(d.dataSets[0].path).toBe('/Customers/Customer/Orders/Order');
    const { D } = await rows(d, DOC);
    expect(D).toEqual([{ Name: 'Ann', ID: 1, Qty: 2 }, { Name: 'Ann', ID: 2, Qty: 5 }, { Name: 'Bob', ID: 3, Qty: 1 }]);
    expect(r.warnings.join('\n')).not.toMatch(/cannot read|not supported/);
  });

  it('<Query> with XmlData: the XML is embedded in the report', async () => {
    const r = importRdl(rdl('', `<Query><ElementPath IgnoreNamespaces="true">Customers/Customer</ElementPath><XmlData>${DOC}</XmlData></Query>`, [['Name', 'Name'], ['ID', 'ID']]));
    const src = r.definition.dataSources[0];
    expect(src.type).toBe('xml');
    expect(src.data).toBe(DOC);
    const { D } = await rows(r.definition, '');
    expect(D.map(x => [x.ID, x.Name])).toEqual([['7', 'Ann'], ['8', 'Bob']]);
  });

  it('<Query> with a Method: a SOAP source with an envelope from its parameters', () => {
    const r = importRdl(rdl('https://ws.test/svc.asmx', '<Query><Method Namespace="http://tempuri.org/" Name="GetOrders"><Parameters><Parameter Name="customer"/></Parameters></Method><SoapAction>http://tempuri.org/GetOrders</SoapAction><ElementPath>GetOrdersResponse/GetOrdersResult/Order</ElementPath></Query>', [['ID', 'ID']]));
    const src = r.definition.dataSources[0];
    expect(src).toMatchObject({ type: 'soap', url: 'https://ws.test/svc.asmx', soapAction: 'http://tempuri.org/GetOrders' });
    expect(src.envelope).toContain('<GetOrders xmlns="http://tempuri.org/"><customer>{Parameters.customer}</customer></GetOrders>');
    expect(r.definition.dataSets[0].path).toBe('/GetOrdersResponse/GetOrdersResult/Order');
  });
});

describe('ActiveReports XML provider', () => {
  it('XmlData and an XPath query; DataFields are XPaths relative to the row', async () => {
    const r = importRdlx({ DataSources: [{ Name: 'S', ConnectionProperties: { DataProvider: 'XML', ConnectString: `XmlData=${DOC}` } }],
      DataSets: [{ Name: 'D', Fields: [{ Name: 'id', DataField: '@ID' }, { Name: 'qty', DataField: 'Qty[Integer]' }, { Name: 'who', DataField: '../../Name' }, { Name: 'first', DataField: '../Order[1]/@ID' }],
        Query: { DataSourceName: 'S', CommandText: '//Order' } }], Body: { ReportItems: [] } });
    const d = r.definition;
    expect(d.dataSources[0]).toMatchObject({ type: 'xml', data: DOC });
    expect(d.dataSets[0].fields.find(f => f.name === 'first').path).toBe('../Order[1]/@ID'); // [1] is a position, not a type
    const { D } = await rows(d, '');
    expect(D).toEqual([{ id: '1', qty: 2, who: 'Ann', first: '1' }, { id: '2', qty: 5, who: 'Ann', first: '1' }, { id: '3', qty: 1, who: 'Bob', first: '3' }]);
  });

  it('XmlDoc: a URL is fetched, a file path is reported', () => {
    const one = (cs) => importRdlx({ DataSources: [{ Name: 'S', ConnectionProperties: { DataProvider: 'XML', ConnectString: cs } }],
      DataSets: [{ Name: 'D', Fields: [], Query: { DataSourceName: 'S', CommandText: '/a/b' } }], Body: { ReportItems: [] } });
    expect(one('XmlDoc=https://x.test/a.xml').definition.dataSources[0]).toEqual({ name: 'S', type: 'xml', url: 'https://x.test/a.xml' });
    const f = one('XmlDoc=C:\\data\\a.xml');
    expect(f.warnings.join()).toMatch(/reads the file/);
  });
});

describe('JasperReports xPath queries', () => {
  const jr = (prop) => `<?xml version="1.0"?><jasperReport xmlns="http://jasperreports.sourceforge.net/jasperreports" name="x" pageWidth="595" pageHeight="842" columnWidth="555" leftMargin="20" rightMargin="20" topMargin="20" bottomMargin="20">
    ${prop}<queryString language="xPath"><![CDATA[/Customers/Customer/Orders/Order]]></queryString>
    <field name="id" class="java.lang.Integer"><fieldDescription><![CDATA[@ID]]></fieldDescription></field>
    <field name="who" class="java.lang.String"><fieldDescription><![CDATA[../../Name]]></fieldDescription></field>
    <detail><band height="20"/></detail></jasperReport>`;
  it('the query picks the rows, fieldDescription the fields, net.sf.jasperreports.xml.source the URL', async () => {
    const r = importJrxml(jr('<property name="net.sf.jasperreports.xml.source" value="https://x.test/c.xml"/>'));
    expect(r.error).toBeUndefined();
    const d = r.definition;
    expect(d.dataSources[0]).toMatchObject({ type: 'xml', url: 'https://x.test/c.xml' });
    expect(d.dataSets[0].path).toBe('/Customers/Customer/Orders/Order');
    const { [d.dataSets[0].name]: D } = await rows(d, DOC);
    expect(D).toEqual([{ id: 1, who: 'Ann' }, { id: 2, who: 'Ann' }, { id: 3, who: 'Bob' }]);
  });
  it('without a source property: an XML source to point at the data, with a note', () => {
    const r = importJrxml(jr(''));
    expect(r.definition.dataSources[0].type).toBe('xml');
    expect(r.warnings.join()).toMatch(/XML from Java code/);
  });
});
