// XML, SOAP and OData data sources (batch 3a): XPath rows and fields, namespaces, the SOAP envelope and its escaping,
// OData query building, paging and type mapping, and adversarial input (XXE, entity bombs, depth, size, prototype keys).
import { describe, it, expect } from 'vitest';
import { loadSources, buildDataSets, sourceRows, isXmlDoc } from '../../src/engine/data/index.js';
import { xmlDocument, selectXml, compileXPath, xmlRowPaths, bestXmlRows } from '../../src/engine/data/xml.js';
import { odataMetadata, odataQuery, odataLiteral } from '../../src/engine/data/odata.js';

const ORDERS = `<?xml version="1.0"?>
<shop xmlns="urn:shop" xmlns:x="urn:extra">
  <customer id="c1" tier="gold"><name>Ann</name>
    <order no="1" status="paid"><total>10.5</total><date>2026-01-02</date><x:note>first</x:note></order>
    <order no="2" status="open"><total>7</total><date>2026-02-03</date></order>
  </customer>
  <customer id="c2" tier="basic"><name>Bob &amp; Co</name>
    <order no="3" status="paid"><total>3.25</total><date>2026-03-04</date></order>
  </customer>
</shop>`;

const ctx = () => ({ params: {}, globals: {}, dataSets: {}, fields: null });
const build = (src, sets) => buildDataSets({ dataSets: sets }, src, ctx());
const okRes = (body, extra = {}) => ({ ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body), ...extra });

describe('XML source: rows by XPath, fields from elements and attributes', () => {
  it('reads inline XML and picks rows with /a/b/c, //c and predicates', async () => {
    const src = await loadSources({ dataSources: [{ name: 'x', type: 'xml', data: ORDERS }] }, { params: {} });
    const doc = src.x;
    expect(isXmlDoc(doc)).toBe(true);
    expect(selectXml(doc, '/shop/customer/order').length).toBe(3);
    expect(selectXml(doc, '//order').length).toBe(3);
    expect(selectXml(doc, "//order[@status='paid']").length).toBe(2);
    expect(selectXml(doc, "//order[@status!='paid']/@no")).toEqual(['2']);
    expect(selectXml(doc, '/shop/customer/order[1]/@no')).toEqual(['1', '3']); // the first order of each customer
    expect(selectXml(doc, '//customer[last()]/name/text()')).toEqual(['Bob & Co']);
    expect(selectXml(doc, "//customer[name='Ann']/@id")).toEqual(['c1']);
    expect(selectXml(doc, '//order[@missing]')).toEqual([]);
    expect(selectXml(doc, '/shop/*').length).toBe(2);
  });

  it('builds typed rows: attributes, child elements, relative paths with .. and @', async () => {
    const src = await loadSources({ dataSources: [{ name: 'x', type: 'xml', data: ORDERS }] }, { params: {} });
    const { Orders } = build(src, [{ name: 'Orders', source: 'x', path: '//order', fields: [
      { name: 'no', type: 'number' }, { name: 'status', type: 'string' }, { name: 'total', type: 'number' }, { name: 'date', type: 'date' },
      { name: 'customer', type: 'string', path: '../name' }, { name: 'tier', type: 'string', path: '../@tier' },
    ] }]);
    expect(Orders.map(r => [r.no, r.status, r.total, r.customer, r.tier])).toEqual([[1, 'paid', 10.5, 'Ann', 'gold'], [2, 'open', 7, 'Ann', 'gold'], [3, 'paid', 3.25, 'Bob & Co', 'basic']]);
    expect(Orders[0].date).toBeInstanceOf(Date);
  });

  it('detects fields when none are listed, and "$" takes the likeliest repeating element', async () => {
    const src = await loadSources({ dataSources: [{ name: 'x', type: 'xml', data: '<r><row a="1"><b>x</b></row><row a="2"><b>y</b></row></r>' }] }, { params: {} });
    const { R } = build(src, [{ name: 'R', source: 'x', path: '$' }]);
    expect(R).toEqual([{ a: '1', b: 'x' }, { a: '2', b: 'y' }]);
    expect(sourceRows(src.x, '$').length).toBe(2);
    expect(bestXmlRows(src.x).path).toBe('/r/row');
  });

  it('lists repeating elements with their fields for the response explorer', async () => {
    const doc = xmlDocument(ORDERS);
    const paths = xmlRowPaths(doc);
    expect(paths.map(p => p.path).sort()).toEqual(['/shop/customer', '/shop/customer/order']);
    const order = paths.find(p => p.path === '/shop/customer/order');
    expect(order.rows).toBe(3);
    expect(order.fields).toEqual(expect.arrayContaining(['no', 'status', 'total', 'date', 'note']));
  });

  it('maps namespace prefixes; an unprefixed name matches any namespace', () => {
    const doc = xmlDocument(ORDERS, { namespaces: { s: 'urn:shop', e: 'urn:extra' } });
    expect(selectXml(doc, '/s:shop/s:customer/s:order').length).toBe(3);
    expect(selectXml(doc, '//s:order/e:note/text()')).toEqual(['first']);
    expect(selectXml(doc, '//e:order').length).toBe(0); // the wrong namespace
    expect(() => selectXml(doc, '//q:order')).toThrow(/prefix "q"/);
  });

  it('fetches XML through the caller\'s fetch with the source\'s method and headers', async () => {
    const seen = [];
    const f = async (u, init) => { seen.push([u, init]); return okRes(ORDERS); };
    const src = await loadSources({ dataSources: [{ name: 'x', type: 'xml', url: 'https://api.test/orders?c={Parameters.c}', headers: { 'x-key': 'k' } }] }, { params: { c: 'a b' }, fetch: f });
    expect(seen[0][0]).toBe('https://api.test/orders?c=a%20b');
    expect(seen[0][1].headers['x-key']).toBe('k');
    expect(selectXml(src.x, '//order').length).toBe(3);
    // through the data proxy, like REST
    await loadSources({ dataSources: [{ name: 'x', type: 'xml', url: 'https://api.test/o', useProxy: true }] }, { params: {}, fetch: f, baseUrl: 'http://pw.local' });
    expect(seen[1][0]).toBe('http://pw.local/api/data/proxy?url=https%3A%2F%2Fapi.test%2Fo');
  });

  it('rejects bad XPaths with a clear message', () => {
    expect(() => compileXPath('//a[')).toThrow(/unclosed/);
    expect(() => compileXPath('child::a')).toThrow(/not supported/);
    expect(() => compileXPath('@a/b')).toThrow(/must come last/);
    expect(() => compileXPath('a[@x=y]')).toThrow(/quoted/);
    expect(() => compileXPath('/a/' + 'b/'.repeat(300))).toThrow(/longer/);
  });
});

describe('XML source: untrusted documents', () => {
  const load = (data) => loadSources({ dataSources: [{ name: 'x', type: 'xml', data }] }, { params: {} });

  it('refuses a DOCTYPE, so no external entity (XXE) and no entity expansion (billion laughs)', async () => {
    await expect(load('<!DOCTYPE r [<!ENTITY e SYSTEM "file:///etc/passwd">]><r>&e;</r>')).rejects.toThrow(/DOCTYPE/);
    const lol = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]><lolz>&lol2;</lolz>';
    await expect(load(lol)).rejects.toThrow(/DOCTYPE/);
    await expect(load('<r>&undefined;</r>')).rejects.toThrow(/not defined/);
  });

  it('caps depth, element count and size', async () => {
    await expect(load('<a>'.repeat(200) + '</a>'.repeat(200))).rejects.toThrow(/nested more than/);
    await expect(load(`<r>${'<i/>'.repeat(250_001)}</r>`)).rejects.toThrow(/more than 250000 elements/);
    await expect(load(`<r>${'x'.repeat(16 * 1024 * 1024 + 1)}</r>`)).rejects.toThrow(/too large/);
  });

  it('keeps __proto__ elements and attributes out of row objects', async () => {
    const src = await load('<r><row __proto__="p"><__proto__><polluted>1</polluted></__proto__><ok>1</ok></row><row><ok>2</ok></row></r>');
    const { R } = build(src, [{ name: 'R', source: 'x', path: '//row' }]);
    expect(R.map(r => r.ok)).toEqual(['1', '2']);
    expect(({}).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(sourceRows(src.x, '//row')[0])).toBe(Object.prototype);
  });

  it('evaluates // in linear time on a deep document', () => {
    const deep = '<a>'.repeat(127) + '</a>'.repeat(127);
    const wide = `<r>${'<a><a><a><b/></a></a></a>'.repeat(20000)}</r>`;
    const t0 = performance.now();
    expect(selectXml(xmlDocument(deep), '//a//a//a//a//a//a').length).toBe(122);
    expect(selectXml(xmlDocument(wide), '//a//a//b').length).toBe(20000);
    expect(performance.now() - t0).toBeLessThan(3000);
  });

  it('never reads a JSON response as XML, even one with an "$xml" key', () => {
    const json = { $xml: { name: 'r', children: [], attrs: {}, text: '' }, $ns: {} };
    expect(isXmlDoc(json)).toBe(false);
    expect(build({ j: json }, [{ name: 'J', source: 'j', path: '$' }]).J.length).toBe(1);
  });
});

describe('SOAP source', () => {
  const ENV = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><GetOrders xmlns="urn:shop"><customer>{Parameters.c}</customer></GetOrders></soap:Body></soap:Envelope>`;
  const RESP = `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><GetOrdersResponse xmlns="urn:shop"><GetOrdersResult><Order id="1"><Total>5</Total></Order><Order id="2"><Total>6</Total></Order></GetOrdersResult></GetOrdersResponse></soap:Body></soap:Envelope>`;
  const src = (extra = {}) => ({ name: 's', type: 'soap', url: 'https://ws.test/svc.asmx', soapAction: 'urn:shop/GetOrders', envelope: ENV, ...extra });

  it('posts the envelope with values XML-escaped, sends SOAPAction, and unwraps the Body', async () => {
    const seen = [];
    const f = async (u, init) => { seen.push([u, init]); return okRes(RESP); };
    const out = await loadSources({ dataSources: [src()] }, { params: { c: '</customer><admin>1</admin><x a="\'' }, fetch: f });
    const [, init] = seen[0];
    expect(init.method).toBe('POST');
    expect(init.headers.SOAPAction).toBe('"urn:shop/GetOrders"');
    expect(init.headers['content-type']).toMatch(/^text\/xml/);
    expect(init.body).toContain('<customer>&lt;/customer&gt;&lt;admin&gt;1&lt;/admin&gt;&lt;x a=&quot;&apos;</customer>');
    expect(out.s.$xml.name).toBe('GetOrdersResponse');
    const { O } = build(out, [{ name: 'O', source: 's', path: '//Order', fields: [{ name: 'id', type: 'number' }, { name: 'Total', type: 'number' }] }]);
    expect(O).toEqual([{ id: 1, Total: 5 }, { id: 2, Total: 6 }]);
  });

  it('SOAP 1.2 puts the action in the content type', async () => {
    let h;
    await loadSources({ dataSources: [src({ soapVersion: '1.2' })] }, { params: { c: 'a' }, fetch: async (u, init) => { h = init.headers; return okRes(RESP); } });
    expect(h['content-type']).toBe('application/soap+xml; charset=utf-8; action="urn:shop/GetOrders"');
    expect(h.SOAPAction).toBeUndefined();
  });

  it('reports a SOAP fault (HTTP 500) by its message', async () => {
    const fault = '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><faultcode>s:Client</faultcode><faultstring>Unknown customer</faultstring></s:Fault></s:Body></s:Envelope>';
    await expect(loadSources({ dataSources: [src()] }, { params: { c: 'a' }, fetch: async () => okRes(fault, { ok: false, status: 500 }) })).rejects.toThrow(/SOAP fault: Unknown customer/);
    await expect(loadSources({ dataSources: [src()] }, { params: { c: 'a' }, fetch: async () => okRes('nope', { ok: false, status: 502 }) })).rejects.toThrow(/HTTP 502/);
  });

  it('refuses an =expression envelope, a header-splitting action and the GET-only proxy', async () => {
    const f = async () => okRes(RESP);
    await expect(loadSources({ dataSources: [src({ envelope: '="<a>" & Parameters.c' })] }, { params: { c: 'a' }, fetch: f })).rejects.toThrow(/not as an =expression/);
    await expect(loadSources({ dataSources: [src({ soapAction: 'a"\r\nX-Evil: 1' })] }, { params: { c: 'a' }, fetch: f })).rejects.toThrow(/quotes or line breaks/);
    await expect(loadSources({ dataSources: [src({ useProxy: true })] }, { params: { c: 'a' }, fetch: f })).rejects.toThrow(/proxy/);
  });

  it('a response that is not an Envelope is an error', async () => {
    await expect(loadSources({ dataSources: [src()] }, { params: { c: 'a' }, fetch: async () => okRes('<html/>') })).rejects.toThrow(/not an Envelope/);
  });
});

describe('OData source', () => {
  const META = `<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0"><edmx:DataServices>
    <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="Demo" Alias="D">
      <EntityType Name="Base"><Key><PropertyRef Name="ID"/></Key><Property Name="ID" Type="Edm.Int64"/></EntityType>
      <EntityType Name="Product" BaseType="D.Base"><Property Name="Name" Type="Edm.String"/><Property Name="Price" Type="Edm.Decimal"/><Property Name="Released" Type="Edm.DateTimeOffset"/><NavigationProperty Name="Category" Type="Demo.Category"/></EntityType>
      <EntityType Name="Category"><Property Name="Name" Type="Edm.String"/></EntityType>
      <EntityContainer Name="C"><EntitySet Name="Products" EntityType="Demo.Product"/><EntitySet Name="Categories" EntityType="Demo.Category"/></EntityContainer>
    </Schema></edmx:DataServices></edmx:Edmx>`;

  it('reads entity sets, properties (base types too) and navigation from $metadata', () => {
    const sets = odataMetadata(META);
    expect(sets.map(s => s.name)).toEqual(['Categories', 'Products']);
    const p = sets.find(s => s.name === 'Products');
    expect(p.properties.map(x => x.name)).toEqual(['Name', 'Price', 'Released', 'ID']);
    expect(p.navigation).toEqual(['Category']);
  });

  it('builds $select, $filter, $orderby, $top, $skip and $expand; values are literals, never query text', () => {
    const q = odataQuery({ select: ['Name', 'Price'], filters: [
      { field: 'Name', op: 'eq', value: "O'Brien) or 1 eq 1 or (Name" },
      { field: 'Price', op: 'gt', value: '10', type: 'Edm.Decimal' },
      { field: 'Name', op: 'contains', value: 'a' },
      { field: 'Name', op: 'eq', value: '' }, // an unset parameter: no clause
    ], orderby: [{ field: 'Price', dir: 'desc' }], top: '5', skip: 10, expand: ['Category'] }, v => v);
    expect(q).toContain('$select=Name,Price');
    expect(decodeURIComponent(/\$filter=([^&]*)/.exec(q)[1])).toBe("Name eq 'O''Brien) or 1 eq 1 or (Name' and Price gt 10 and contains(Name,'a')");
    expect(q).toContain('$orderby=Price%20desc');
    expect(q).toContain('$top=5&$skip=10&$expand=Category');
  });

  it('refuses names and numbers that could change the query', () => {
    expect(() => odataQuery({ select: ['Name,Secret'] }, v => v)).toThrow(/not a valid property/);
    expect(() => odataQuery({ filters: [{ field: 'Name eq 1 or Name', op: 'eq', value: 'x' }] }, v => v)).toThrow(/not a valid/);
    expect(() => odataQuery({ filters: [{ field: 'Price', op: 'gt', value: '1 or true', type: 'Edm.Int32' }] }, v => v)).toThrow(/not a number/);
    expect(() => odataQuery({ filters: [{ field: 'Price', op: 'or', value: '1' }] }, v => v)).toThrow(/operator/);
    expect(() => odataQuery({ top: '5;drop' }, v => v)).toThrow(/whole number/);
    expect(() => odataLiteral('x', 'Edm.Guid')).toThrow(/GUID/);
    // a multi-value parameter is an OR of literals
    expect(decodeURIComponent(odataQuery({ filters: [{ field: 'Name', op: 'eq', value: ['a', "b'"] }] }, v => v))).toBe("$filter=(Name eq 'a' or Name eq 'b''')");
  });

  it('follows @odata.nextLink up to the page cap and maps Edm types', async () => {
    const seen = [];
    const f = async (u) => {
      seen.push(u);
      const n = seen.length;
      return okRes(JSON.stringify({ '@odata.context': 'x', value: [{ '@odata.etag': 'e', ID: String(n), Price: '1.5', Name: `p${n}` }], '@odata.nextLink': `https://od.test/svc/Products?$skiptoken=${n}` }));
    };
    const out = await loadSources({ dataSources: [{ name: 'o', type: 'odata', url: 'https://od.test/svc/', entitySet: 'Products', select: ['ID', 'Name', 'Price'], maxPages: 3, types: { ID: 'Edm.Int64', Price: 'Edm.Decimal' }, filters: [{ field: 'Name', op: 'startswith', value: '{Parameters.q}' }] }] }, { params: { q: 'p' }, fetch: f });
    expect(seen.length).toBe(3);
    expect(seen[0]).toBe("https://od.test/svc/Products?$select=ID,Name,Price&$filter=startswith(Name%2C'p')");
    expect(seen[1]).toBe('https://od.test/svc/Products?$skiptoken=1');
    expect(out.o).toEqual([{ ID: 1, Price: 1.5, Name: 'p1' }, { ID: 2, Price: 1.5, Name: 'p2' }, { ID: 3, Price: 1.5, Name: 'p3' }]);
  });

  it('does not follow a next link to another site', async () => {
    const f = async () => okRes(JSON.stringify({ value: [{ a: 1 }], '@odata.nextLink': 'http://169.254.169.254/latest/meta-data' }));
    await expect(loadSources({ dataSources: [{ name: 'o', type: 'odata', url: 'https://od.test/svc', entitySet: 'P' }] }, { params: {}, fetch: f })).rejects.toThrow(/another site/);
    const g = async () => okRes(JSON.stringify({ value: [{ a: 1 }], '@odata.nextLink': '//evil.test/x' }));
    await expect(loadSources({ dataSources: [{ name: 'o', type: 'odata', url: '/odata', entitySet: 'P' }] }, { params: {}, fetch: g })).rejects.toThrow(/another site/);
  });

  it('reads OData v2 (d.results, __next, /Date()/) and relative next links on this server', async () => {
    const seen = [];
    const f = async (u) => {
      seen.push(u);
      return okRes(JSON.stringify(seen.length === 1 ? { d: { results: [{ __metadata: {}, When: '/Date(86400000)/', Cat: { __deferred: {} } }], __next: 'P?$skip=1' } } : { d: { results: [{ When: '/Date(0)/' }] } }));
    };
    const out = await loadSources({ dataSources: [{ name: 'o', type: 'odata', url: '/odata/', entitySet: 'P' }] }, { params: {}, fetch: f, baseUrl: 'http://pw.local' });
    expect(seen).toEqual(['http://pw.local/odata/P', 'http://pw.local/odata/P?$skip=1']);
    expect(out.o).toEqual([{ When: '1970-01-02T00:00:00.000Z' }, { When: '1970-01-01T00:00:00.000Z' }]);
  });

  it('a response that is not an entity set is a clear error', async () => {
    await expect(loadSources({ dataSources: [{ name: 'o', type: 'odata', url: 'https://od.test', entitySet: 'P' }] }, { params: {}, fetch: async () => okRes('{"x":1}') })).rejects.toThrow(/no "value" list/);
  });
});

describe('the server checks cover XML, SOAP and OData sources', async () => {
  const { serverSources } = await import('../../src/server/perms.js');
  const { assertFixedHosts } = await import('../../src/server/renderer.js');
  const withEnv = async (vars, fn) => {
    const old = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]]));
    for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    try { return await fn(); } finally { for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  };
  const one = (type, url, extra = {}) => ({ dataSources: [{ name: 's', type, url, ...extra }] });

  it('a fetch that can reach an internal host needs a designer (serverSources)', () => withEnv({ PW_INTERNAL_HOSTS: 'hr.internal' }, () => {
    for (const type of ['xml', 'soap', 'odata']) {
      expect(serverSources(one(type, 'http://hr.internal/x')), type).toHaveLength(1);
      expect(serverSources(one(type, '{Parameters.base}/x')), type).toHaveLength(1);
      expect(serverSources(one(type, 'https://api.example.com/x')), type).toHaveLength(0);
    }
    expect(serverSources(one('xml', undefined, { data: '<r/>' }))).toHaveLength(0);
  }));

  it('in production the host must be written out (assertFixedHosts)', () => withEnv({ NODE_ENV: 'production', PW_FIXED_FETCH_HOSTS: undefined }, () => {
    for (const type of ['xml', 'soap', 'odata']) {
      expect(() => assertFixedHosts(one(type, 'http://{Parameters.h}/x')), type).toThrow(/PW_FIXED_FETCH_HOSTS/);
      expect(() => assertFixedHosts(one(type, 'https://api.example.com/{Parameters.p}')), type).not.toThrow();
    }
    expect(() => assertFixedHosts(one('xml', undefined, { data: '<r/>' }))).not.toThrow();
  }));
});

describe('data pushed for an XML source (render API)', () => {
  const def = { dataSources: [{ name: 'x', type: 'xml', url: 'https://x.test/a.xml' }], dataSets: [{ name: 'R', source: 'x', path: '//row' }] };
  it('XML text is read as XML; JSON rows are the rows', () => {
    expect(buildDataSets(def, { x: '<r><row a="1"/><row a="2"/></r>' }, ctx()).R).toEqual([{ a: '1' }, { a: '2' }]);
    expect(buildDataSets(def, { x: [{ a: 3 }] }, ctx()).R).toEqual([{ a: 3 }]);
  });
});
