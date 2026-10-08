import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readReportFile } from '../../src/designer/importFile.js';

const fixture = (p) => fs.readFileSync(path.join(import.meta.dirname, '..', 'fixtures', p), 'utf8');

describe('Designer import action', () => {
  it('a JasperReports .jrxml yields a definition with sections', () => {
    const r = readReportFile('jr6-table-TableReport.jrxml', fixture('jrxml/corpus/jr6-table-TableReport.jrxml'));
    expect(r.error).toBeUndefined();
    expect(r.definition.sections.body).toBeTruthy();
    expect(Array.isArray(r.warnings)).toBe(true);
  });
  it('a .pw.json definition is read as it is', () => {
    const def = { $schema: 'pagewright/report@1', name: 'x', sections: { body: { items: [] } } };
    expect(readReportFile('x.pw.json', JSON.stringify(def)).definition).toEqual(def);
  });
  it('an unknown file type and a JSON file that is not a report are errors, not definitions', () => {
    expect(readReportFile('notes.txt', 'hello').error).toMatch(/not a report file/);
    expect(readReportFile('data.json', '{"a":1}').error).toMatch(/not a report definition/);
    expect(readReportFile('bad.json', '{').error).toMatch(/not valid JSON/);
  });
  it('an XML file that is not a report design is an error', () => {
    const r = readReportFile('x.rdl', '<nope/>');
    expect(r.definition).toBeUndefined();
    expect(r.error).toBeTruthy();
  });
});
