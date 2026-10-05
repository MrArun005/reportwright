// Batch 3a: XML, SOAP and OData sources built in the Designer against a small mock server this test starts
// (127.0.0.1:MOCK_PORT, CORS open). Two reports: XML + SOAP, and OData; each is previewed.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';

const BASE = process.env.BASE || 'http://localhost:3000';
const MOCK_PORT = Number(process.env.MOCK_PORT || 4291);
const M = `http://127.0.0.1:${MOCK_PORT}`;
const step = (s) => console.log('·', s);

const ORDERS = `<?xml version="1.0"?>
<shop xmlns="urn:shop">
  <customer id="c1"><name>Ann</name>
    <order no="101" status="paid"><total>10.5</total></order>
    <order no="102" status="open"><total>7</total></order>
  </customer>
  <customer id="c2"><name>Bob</name>
    <order no="103" status="paid"><total>3.25</total></order>
  </customer>
</shop>`;
const SOAP_RESP = (who) => `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><GetInvoicesResponse xmlns="http://tempuri.org/"><GetInvoicesResult>
  <Invoice id="INV-1"><Amount>120</Amount><Customer>${who}</Customer></Invoice><Invoice id="INV-2"><Amount>80</Amount><Customer>${who}</Customer></Invoice>
</GetInvoicesResult></GetInvoicesResponse></s:Body></s:Envelope>`;
const META = `<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" Version="4.0"><edmx:DataServices>
  <Schema xmlns="http://docs.oasis-open.org/odata/ns/edm" Namespace="Demo">
    <EntityType Name="Product"><Key><PropertyRef Name="ID"/></Key><Property Name="ID" Type="Edm.Int32"/><Property Name="Name" Type="Edm.String"/><Property Name="Price" Type="Edm.Decimal"/></EntityType>
    <EntityType Name="Supplier"><Property Name="Name" Type="Edm.String"/></EntityType>
    <EntityContainer Name="C"><EntitySet Name="Products" EntityType="Demo.Product"/><EntitySet Name="Suppliers" EntityType="Demo.Supplier"/></EntityContainer>
  </Schema></edmx:DataServices></edmx:Edmx>`;
const PRODUCTS = [{ ID: 1, Name: 'Bolt', Price: '2.5' }, { ID: 2, Name: 'Nut', Price: '1.25' }, { ID: 3, Name: 'Gear', Price: '19' }];

const seen = [];
const mock = http.createServer((q, r) => {
  let body = '';
  q.on('data', c => { body += c; });
  q.on('end', () => {
    seen.push({ method: q.method, url: q.url, h: q.headers, body });
    r.setHeader('access-control-allow-origin', '*');
    r.setHeader('access-control-allow-headers', 'content-type, soapaction, accept');
    r.setHeader('access-control-allow-methods', 'GET, POST');
    if (q.method === 'OPTIONS') { r.statusCode = 204; return r.end(); }
    const u = new URL(q.url, M);
    if (u.pathname === '/orders.xml') { r.setHeader('content-type', 'application/xml'); return r.end(ORDERS); }
    if (u.pathname === '/soap' && q.method === 'POST') {
      r.setHeader('content-type', 'text/xml');
      if (q.headers.soapaction !== '"http://tempuri.org/GetInvoices"') { r.statusCode = 500; return r.end('<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><faultstring>bad action</faultstring></s:Fault></s:Body></s:Envelope>'); }
      const who = /<customer>([^<]*)<\/customer>/.exec(body)?.[1] || '?';
      return r.end(SOAP_RESP(who));
    }
    if (u.pathname === '/odata/$metadata') { r.setHeader('content-type', 'application/xml'); return r.end(META); }
    if (u.pathname === '/odata/Products') {
      r.setHeader('content-type', 'application/json');
      if (u.searchParams.get('$skiptoken') === '2') return r.end(JSON.stringify({ value: PRODUCTS.slice(2) }));
      return r.end(JSON.stringify({ '@odata.context': 'x', value: PRODUCTS.slice(0, 2), '@odata.nextLink': `${M}/odata/Products?$skiptoken=2` }));
    }
    r.statusCode = 404; r.end('not found');
  });
});
await new Promise(res => mock.listen(MOCK_PORT, '127.0.0.1', res));

const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
const ids = [];
const newReport = async (name) => {
  const { id } = await (await fetch(`${BASE}/api/reports`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ name }) })).json();
  ids.push(id);
  await p.goto(`${BASE}/designer/${id}`);
  await p.waitForSelector('[data-testid=paper]');
  return id;
};
const addSet = async (name, source, pathText, rows) => {
  await p.getByRole('button', { name: '+ Add' }).nth(2).click();
  const dlg = p.getByRole('dialog');
  await dlg.getByLabel('Name').fill(name);
  await dlg.locator('label.field', { has: p.locator('span', { hasText: /^Source$/ }) }).locator('select').selectOption(source);
  await dlg.getByRole('button', { name: 'Explore the response' }).click();
  await dlg.getByRole('listitem').filter({ hasText: pathText }).first().getByRole('button', { name: 'Use' }).click();
  await dlg.getByText(`Found ${rows} rows.`).waitFor();
  await dlg.getByRole('button', { name: 'Save' }).click();
};
const dropTable = async (set, y) => p.dragAndDrop(`.trow span.nm[draggable]:has(b:text-is("${set}"))`, '[data-section=body]', { targetPosition: { x: 20, y } });
const previewText = async () => {
  await p.keyboard.press('Control+s');
  await p.getByTestId('save-state').filter({ hasText: /^Saved$/ }).waitFor();
  await p.getByTestId('tab-preview').click();
  await p.waitForSelector('.vpage text');
  await p.waitForTimeout(500);
  return p.$$eval('.vpage text', ns => ns.map(n => n.textContent));
};

try {
  step('XML source from a URL, rows picked in the explorer (repeating elements)');
  const id1 = await newReport('e2e xml + soap');
  await p.getByRole('button', { name: '+ Add' }).nth(1).click();
  let dlg = p.getByRole('dialog');
  await dlg.getByLabel('Name').fill('shop');
  await dlg.getByLabel('Type').selectOption('xml');
  await dlg.getByLabel('URL').fill(`${M}/orders.xml`);
  await dlg.getByLabel('Namespaces').fill('s=urn:shop');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await addSet('Orders', 'shop', '/shop/customer/order', 3);
  await p.locator('.field-chip', { hasText: 'total' }).waitFor();

  step('the data set path is an XPath with a namespace prefix and a predicate');
  await p.locator('.trow').filter({ has: p.locator('b', { hasText: /^Orders$/ }) }).getByRole('button', { name: 'Edit' }).click();
  dlg = p.getByRole('dialog');
  await dlg.getByLabel('Path to the rows').fill("/s:shop/s:customer/s:order[@status='paid']");
  await dlg.getByRole('button', { name: 'Detect fields' }).click();
  await dlg.getByText('Found 2 rows.').waitFor();
  await dlg.getByRole('button', { name: 'Save' }).click();

  step('SOAP source: envelope template, action, a parameter in the envelope');
  await p.getByRole('button', { name: '+ Add' }).nth(0).click();
  dlg = p.getByRole('dialog');
  await dlg.getByLabel('Name').fill('customer');
  await dlg.getByLabel('Default').fill('Ann & <Co>');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await p.getByRole('button', { name: '+ Add' }).nth(1).click();
  dlg = p.getByRole('dialog');
  await dlg.getByLabel('Name').fill('billing');
  await dlg.getByLabel('Type').selectOption('soap');
  await dlg.getByLabel('URL').fill(`${M}/soap`);
  await dlg.getByLabel('SOAP action').fill('http://tempuri.org/GetInvoices');
  await dlg.getByRole('button', { name: 'Insert a template' }).click();
  const env = dlg.getByLabel('Envelope');
  assert.match(await env.inputValue(), /soap:Envelope/);
  await env.fill((await env.inputValue()).replace('GetOrders', 'GetInvoices').replace('GetOrders', 'GetInvoices').replace(/<customerId>.*<\/customerId>/, '<customer>{Parameters.customer}</customer>'));
  await dlg.getByRole('button', { name: 'Save' }).click();
  await addSet('Invoices', 'billing', '/GetInvoicesResponse/GetInvoicesResult/Invoice', 2);
  const soapCall = seen.find(x => x.url === '/soap' && x.method === 'POST');
  assert.ok(soapCall, 'the SOAP endpoint was called');
  assert.match(soapCall.body, /<customer>Ann &amp; &lt;Co&gt;<\/customer>/, 'the parameter is XML-escaped in the envelope');

  step('tables of both data sets, preview');
  await dropTable('Orders', 40);
  await dropTable('Invoices', 200);
  let text = await previewText();
  for (const s of ['101', '103', 'INV-1', 'INV-2', 'Ann & <Co>']) assert.ok(text.some(t => t.includes(s)), `preview shows ${s}: ${text.join(' | ').slice(0, 400)}`);
  assert.ok(!text.some(t => t.includes('102')), 'the predicate left the open order out');
  const saved1 = await (await fetch(`${BASE}/api/reports/${id1}`)).json();
  assert.equal(saved1.dataSources.find(s => s.name === 'billing').type, 'soap');
  assert.deepEqual(saved1.dataSources.find(s => s.name === 'shop').namespaces, { s: 'urn:shop' });

  step('OData source: read $metadata, pick the entity set, fields, a filter and a sort');
  const id2 = await newReport('e2e odata');
  await p.getByRole('button', { name: '+ Add' }).nth(1).click();
  dlg = p.getByRole('dialog');
  await dlg.getByLabel('Name').fill('catalog');
  await dlg.getByLabel('Type').selectOption('odata');
  await dlg.getByLabel('URL').fill(`${M}/odata/`);
  await dlg.getByRole('button', { name: 'Read $metadata' }).click();
  await dlg.getByText('2 entity sets found').waitFor();
  const od = dlg.getByTestId('odata-editor');
  await od.getByLabel('Entity set').selectOption('Products');
  for (const f of ['Name', 'Price']) await od.getByLabel(f, { exact: true }).check();
  await od.getByRole('button', { name: '+ Filter' }).click();
  await od.getByLabel('Field', { exact: true }).first().selectOption('Price');
  await od.getByLabel('Operator').selectOption('gt');
  await od.getByLabel('Value', { exact: true }).fill('1');
  await od.getByRole('button', { name: '+ Sort' }).click();
  await dlg.getByRole('button', { name: 'Save' }).click();
  await addSet('Products', 'catalog', '$', 3);
  const odCall = seen.find(x => x.url.startsWith('/odata/Products?$select'));
  assert.ok(odCall, `OData query sent: ${seen.map(x => x.url).join(', ')}`);
  assert.match(decodeURIComponent(odCall.url), /\$select=Name,Price&\$filter=Price gt 1&\$orderby=ID/);
  assert.ok(seen.some(x => x.url === '/odata/Products?$skiptoken=2'), 'the next link was followed');
  await dropTable('Products', 40);
  text = await previewText();
  for (const s of ['Bolt', 'Nut', 'Gear']) assert.ok(text.some(t => t.includes(s)), `preview shows ${s}`);
  const saved2 = await (await fetch(`${BASE}/api/reports/${id2}`)).json();
  const src = saved2.dataSources[0];
  assert.equal(src.type, 'odata');
  assert.equal(src.entitySet, 'Products');
  assert.equal(src.types.Price, 'Edm.Decimal');
  assert.equal(saved2.dataSets[0].fields.find(f => f.name === 'Price').type, 'number');
  console.log('errors:', errs.length ? errs : 'none');
  assert.equal(errs.length, 0);
  console.log('PASS');
} catch (e) {
  await p.screenshot({ path: '/tmp/data-xml-fail.png' }).catch(() => {});
  throw e;
} finally {
  for (const id of ids) await fetch(`${BASE}/api/reports/${id}`, { method: 'DELETE', headers: { origin: BASE } }).catch(() => {});
  await b.close();
  mock.close();
}
