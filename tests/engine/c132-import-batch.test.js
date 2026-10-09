// pw import <folder>: bulk import with cross-file references, a migration report, edit protection and path safety.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.join(import.meta.dirname, '..', '..');
const PW = path.join(ROOT, 'bin', 'pw.mjs');
const run = (args) => spawnSync(process.execPath, [PW, ...args], { encoding: 'utf8' });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-c132-'));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const NS = 'http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition';
const box = (name, value, top = '0in') => `<Textbox Name="${name}"><Paragraphs><Paragraph><TextRuns><TextRun><Value>${value}</Value></TextRun></TextRuns></Paragraph></Paragraphs><Top>${top}</Top><Left>0in</Left><Height>0.3in</Height><Width>3in</Width></Textbox>`;
const rdl = (items, sources = '') => `<?xml version="1.0" encoding="utf-8"?>
<Report xmlns="${NS}">${sources}
  <ReportSections><ReportSection><Body><Height>2in</Height><ReportItems>
    ${items}
  </ReportItems></Body><Width>6.5in</Width><Page><PageHeight>11in</PageHeight><PageWidth>8.5in</PageWidth></Page></ReportSection></ReportSections>
</Report>
`;
// a 1×1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==', 'base64');
const jrxml = (name, img) => `<?xml version="1.0" encoding="UTF-8"?>
<jasperReport xmlns="http://jasperreports.sourceforge.net/jasperreports" name="${name}" pageWidth="595" pageHeight="842" columnWidth="555" leftMargin="20" rightMargin="20" topMargin="20" bottomMargin="20">
  <template><![CDATA["styles.jrtx"]]></template>
  <title><band height="80">
    <image><reportElement x="0" y="0" width="40" height="40"/><imageExpression><![CDATA["${img}"]]></imageExpression></image>
    <staticText><reportElement x="100" y="0" width="300" height="20" style="Title"/><text><![CDATA[${name}]]></text></staticText>
    <textField><reportElement x="100" y="30" width="300" height="20"/><textFieldExpression><![CDATA[new java.util.Random().nextInt()]]></textFieldExpression></textField>
  </band></title>
</jasperReport>
`;

const IN = path.join(tmp, 'in'), OUT = path.join(tmp, 'out');
function corpus() {
  fs.mkdirSync(path.join(IN, 'nested', 'deeper'), { recursive: true });
  const w = (f, s) => fs.writeFileSync(path.join(IN, f), s);
  w('Master.rdl', rdl(`${box('Title', 'Master')}\n    ${box('Odd', '=Foo!Bar.Baz', '0.4in')}\n    <Subreport Name="Sub1"><ReportName>Detail</ReportName><Top>1in</Top><Left>0in</Left><Height>0.5in</Height><Width>3in</Width></Subreport>`,
    '<DataSources><DataSource Name="DS"><DataSourceReference>/Data Sources/Shared</DataSourceReference></DataSource></DataSources><DataSets><DataSet Name="Orders"><Query><DataSourceName>DS</DataSourceName><CommandText>SELECT 1 AS N</CommandText></Query><Fields><Field Name="N"><DataField>N</DataField></Field></Fields></DataSet></DataSets>'));
  w('Detail.rdl', rdl(box('Hello', 'Detail lines')));
  w('Shared.rds', '<?xml version="1.0"?><RptDataSource Name="Shared"><ConnectionProperties><Extension>ORACLE</Extension><ConnectString>Data Source=db;Initial Catalog=Sales</ConnectString></ConnectionProperties></RptDataSource>');
  w('broken.rdl', '<Report xmlns="' + NS + '"><ReportSections><unclosed>');
  w('<img onerror=alert(1)>.rdl', rdl(box('X', 'hostile name')));
  w('Invoice.jrxml', jrxml('Invoice', 'logo.png'));
  w('styles.jrtx', '<?xml version="1.0"?><jasperTemplate><style name="Title" fontSize="18" isBold="true" forecolor="#AA0000"/></jasperTemplate>');
  w('logo.png', PNG);
  w('nested/deeper/Other.jrxml', jrxml('Other', '../../logo.png'));
  w('nested/notes.txt', 'ignored');
  fs.symlinkSync('/etc', path.join(IN, 'etc-link'));
  fs.symlinkSync('/etc/hosts', path.join(IN, 'nested', 'hosts.rdl'));
}
corpus();
const report = () => JSON.parse(fs.readFileSync(path.join(OUT, 'import-report.json'), 'utf8'));
const bySource = (r, s) => r.files.find(f => f.source === s);

describe('pw import <folder>', () => {
  it('imports every good file, reports the bad one, resolves references across the batch and copies the image once', () => {
    const r1 = run(['import', IN, '-o', OUT, '--recursive']);
    expect(r1.status, r1.stderr).toBe(2); // some failed
    const r = report();
    expect(r).toMatchObject({ tool: 'pw import', schema: 1, options: { recursive: true, force: false, verify: false } });
    expect(r.summary).toMatchObject({ reports: 6, imported: 5, failed: 1, images: 1 });
    for (const f of r.files) {
      expect(f).toEqual(expect.objectContaining({ source: expect.any(String), format: expect.any(String), output: expect.any(String), status: expect.stringMatching(/^(imported|failed)$/),
        stats: expect.objectContaining({ items: expect.any(Number), mapped: expect.any(Number), approximated: expect.any(Number), dropped: expect.any(Number) }),
        items: expect.any(Array), expressions: expect.any(Array), notes: expect.any(Array), references: expect.any(Array) }));
    }
    const bad = bySource(r, 'broken.rdl');
    expect(bad.status).toBe('failed');
    expect(bad.error).toMatch(/not readable XML/);
    // the shared data source and the subreport
    const master = bySource(r, 'Master.rdl');
    expect(master.references).toEqual(expect.arrayContaining([
      { kind: 'shared data source', ref: '/Data Sources/Shared', resolved: 'Shared.rds' },
      expect.objectContaining({ kind: 'subreport', ref: 'detail', resolved: 'Detail.rdl', output: 'detail.pw.json' })]));
    const mdef = JSON.parse(fs.readFileSync(path.join(OUT, 'master.pw.json'), 'utf8'));
    expect(mdef.dataSources[0]).toMatchObject({ type: 'sql', connection: 'ds' });
    expect(master.notes.join('\n')).toMatch(/Data source "DS" is a\b.*ORACLE/i); // the provider from the .rds, not "treated as SQL Server"
    expect(master.notes.join('\n')).not.toMatch(/connection is not in the file/);
    // an expression that is not translated, with its line and column
    const ex = master.expressions.find(e => e.item === 'Odd');
    expect(ex).toMatchObject({ expression: '=Foo!Bar.Baz', line: 5, column: 5 });
    // the style template and the image
    const inv = bySource(r, 'Invoice.jrxml');
    expect(inv.references).toEqual(expect.arrayContaining([{ kind: 'style template', ref: 'styles.jrtx', resolved: 'styles.jrtx' },
      { kind: 'image', ref: 'logo.png', resolved: 'logo.png', output: 'logo.png' }]));
    expect(JSON.stringify(inv.notes)).not.toMatch(/style template/);
    expect(inv.expressions[0]).toMatchObject({ expression: 'new java.util.Random().nextInt()', line: 7 });
    const idef = fs.readFileSync(path.join(OUT, 'invoice.pw.json'), 'utf8');
    expect(idef).toMatch(/#AA0000/i);
    const other = bySource(r, 'nested/deeper/Other.jrxml');
    expect(other.output).toBe('nested/deeper/other.pw.json');
    expect(other.references).toEqual(expect.arrayContaining([{ kind: 'image', ref: '../../logo.png', resolved: 'logo.png', output: 'logo.png' }]));
    expect(fs.readFileSync(path.join(OUT, 'nested/deeper/other.pw.json'), 'utf8')).toContain('"src": "../../logo.png"');
    const pngs = fs.readdirSync(OUT, { recursive: true }).filter(f => String(f).endsWith('.png'));
    expect(pngs).toEqual(['logo.png']);
    // the links: /etc and /etc/hosts are refused, never read
    expect(r.refused.map(x => x.path).sort()).toEqual(['etc-link', 'nested/hosts.rdl']);
    expect(r.refused[0].reason).toMatch(/outside the input folder/);
    expect(fs.readdirSync(OUT, { recursive: true }).map(String).some(f => /etc|hosts/.test(f))).toBe(false);
    // the HTML escapes names from the files
    const html = fs.readFileSync(path.join(OUT, 'import-report.html'), 'utf8');
    expect(html).toContain('&lt;img onerror=alert(1)&gt;.rdl');
    expect(html).not.toContain('<img onerror');
    expect(html).toContain('=Foo!Bar.Baz');
  });

  it('keeps an output the user edited unless --force', () => {
    const f = path.join(OUT, 'detail.pw.json');
    const edited = fs.readFileSync(f, 'utf8').replace('Detail lines', 'Edited by hand');
    fs.writeFileSync(f, edited);
    fs.writeFileSync(path.join(IN, 'Master.rdl'), fs.readFileSync(path.join(IN, 'Master.rdl'), 'utf8').replace('>Master<', '>Master v2<'));
    expect(run(['import', IN, '-o', OUT, '--recursive']).status).toBe(2);
    let r = report();
    expect(bySource(r, 'Detail.rdl')).toMatchObject({ status: 'imported', write: 'skipped-edited' });
    expect(bySource(r, 'Master.rdl').write).toBe('refreshed');
    expect(bySource(r, 'Invoice.jrxml').write).toBe('unchanged');
    expect(fs.readFileSync(f, 'utf8')).toBe(edited);
    expect(run(['import', IN, '-o', OUT, '--recursive', '--force']).status).toBe(2);
    r = report();
    expect(bySource(r, 'Detail.rdl').write).toBe('overwritten');
    expect(fs.readFileSync(f, 'utf8')).toContain('Detail lines');
  });

  it('--verify renders the imported reports and compares them with the outputs they replace', () => {
    const v = path.join(tmp, 'verify');
    fs.mkdirSync(v);
    fs.copyFileSync(path.join(IN, 'Detail.rdl'), path.join(v, 'Detail.rdl'));
    fs.writeFileSync(path.join(v, 'Second.rdl'), rdl(box('A', 'Second report')));
    const out = path.join(tmp, 'verify-out');
    expect(run(['import', v, '-o', out, '--verify']).status).toBe(0);
    let r = JSON.parse(fs.readFileSync(path.join(out, 'import-report.json'), 'utf8'));
    expect(r.files.map(f => f.verify)).toEqual([expect.objectContaining({ status: 'ok', pages: 1, note: expect.stringMatching(/no earlier output/) }), expect.objectContaining({ status: 'ok', pages: 1 })]);
    fs.writeFileSync(path.join(v, 'Second.rdl'), rdl(box('A', 'Second report, changed')));
    expect(run(['import', v, '-o', out, '--verify', '--report', path.join(tmp, 'rep', 'r.json')]).status).toBe(0);
    r = JSON.parse(fs.readFileSync(path.join(tmp, 'rep', 'r.json'), 'utf8'));
    expect(r.files[1].verify).toMatchObject({ status: 'changed' });
    expect(r.files[1].verify.diff.join('\n')).toMatch(/\+ Second report, changed/);
    expect(fs.existsSync(path.join(tmp, 'rep', 'r.html'))).toBe(true);
  });

  it('exits 1 when nothing could be imported, and caps the file count', () => {
    const e = path.join(tmp, 'empty');
    fs.mkdirSync(e);
    fs.writeFileSync(path.join(e, 'bad.jrxml'), 'not xml');
    expect(run(['import', e, '-o', path.join(tmp, 'empty-out')]).status).toBe(1);
    const r = run(['import', IN, '-o', path.join(tmp, 'capped'), '--max-files', '2']);
    const rep = JSON.parse(fs.readFileSync(path.join(tmp, 'capped', 'import-report.json'), 'utf8'));
    expect(rep.refused.some(x => /more than 2 files/.test(x.reason))).toBe(true);
    expect(rep.summary.reports).toBeLessThanOrEqual(2);
    expect(r.status).toBe(0);
  });
});

describe('pw --version', () => {
  it('prints the CLI and engine versions', () => {
    const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    for (const flag of ['--version', '-v']) {
      const r = run([flag]);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe(`pw ${version} (reportwright), engine ${version}`);
    }
    expect(run(['--help']).stderr).toContain('pw --version');
  });
});
