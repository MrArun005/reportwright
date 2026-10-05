// R3-A N2: JasperReports variables print as Jasper prints them (JasperValue). Expected values: JasperReports 7.0.8 on
// the same design and rows (tests/diff/truth/jrxml.json, cases jr-agg-*), restated here for the common patterns.
import { describe, it, expect } from 'vitest';
import { importJrxml } from '../../src/importers/jrxml.js';
import { render } from '../../src/engine/index.js';
import { fontStore } from '../helpers.js';

const line = (label, i, expr, attrs = '') => `<element kind="staticText" x="0" y="${i * 12}" width="90" height="12"><text><![CDATA[${label}]]></text></element><element kind="textField" x="100" y="${i * 12}" width="300" height="12"${attrs}><expression><![CDATA[${expr}]]></expression></element>`;
const band = (...ls) => `<band height="${ls.length * 12}">${ls.join('')}</band>`;
const jr = ({ vars, gh = [], gf = [], detail = [], summary = [] }) => `<jasperReport name="t" pageWidth="595" pageHeight="842" columnWidth="555" leftMargin="20" rightMargin="20" topMargin="20" bottomMargin="20">
<field name="g" class="java.lang.String"/><field name="n" class="java.lang.Integer"/>${vars}
<group name="G"><expression><![CDATA[$F{g}]]></expression><groupHeader>${band(...gh)}</groupHeader><groupFooter>${band(...gf)}</groupFooter></group>
<detail>${band(...detail)}</detail>${summary.length ? `<summary height="${summary.length * 12}">${summary.join('')}</summary>` : ''}</jasperReport>`;
const rows = [{ g: 'A', n: 1 }, { g: 'A', n: 2 }, { g: 'B', n: 4 }, { g: 'B', n: 8 }];
const lines = async (xml) => {
  const m = await render(importJrxml(xml).definition, { fontStore, sources: { JasperDataSource: rows } });
  const t = m.pages.flatMap(p => p.items.flatMap(i => i.lines || []).map(l => l.text));
  const out = [];
  for (let i = 0; i < t.length; i++) if (t[i].startsWith('@')) out.push(`${t[i]} ${t[i + 1]?.startsWith('@') ? '' : t[i + 1] ?? ''}`.trim());
  return out;
};

describe('N2: report-wide totals and running values', () => {
  it('detail: running across groups; REPORT_COUNT continues', async () => {
    const xml = jr({ vars: '<variable name="tot" class="java.lang.Integer" calculation="Sum"><expression><![CDATA[$F{n}]]></expression></variable>', detail: [line('@D', 0, '$V{tot}'), line('@C', 1, '$V{REPORT_COUNT}')] });
    expect((await lines(xml)).join(' | ')).toBe('@D 1 | @C 1 | @D 3 | @C 2 | @D 7 | @C 3 | @D 15 | @C 4');
  });
  it('group footer (Now): the running value at the end of the group; header: before the group', async () => {
    const xml = jr({ vars: '<variable name="tot" class="java.lang.Integer" calculation="Sum"><expression><![CDATA[$F{n}]]></expression></variable><variable name="gs" class="java.lang.Integer" calculation="Sum" resetType="Group" resetGroup="G"><expression><![CDATA[$F{n}]]></expression></variable>',
      gh: [line('@H', 0, '$V{tot}'), line('@HG', 1, '$V{gs}'), line('@HC', 2, '$V{G_COUNT}')], gf: [line('@F', 0, '$V{tot}'), line('@FC', 1, '$V{REPORT_COUNT}'), line('@FG', 2, '$V{gs}')] });
    expect((await lines(xml)).join(' | ')).toBe('@H null | @HG null | @HC 0 | @F 3 | @FC 2 | @FG 3 | @H 3 | @HG null | @HC 0 | @F 15 | @FC 4 | @FG 12');
  });
  it('evaluationTime Group in the header prints the group total; Report the grand total', async () => {
    const xml = jr({ vars: '<variable name="gs" class="java.lang.Integer" calculation="Sum" resetType="Group" resetGroup="G"><expression><![CDATA[$F{n}]]></expression></variable><variable name="tot" class="java.lang.Integer" calculation="Sum"><expression><![CDATA[$F{n}]]></expression></variable>',
      gh: [line('@H', 0, '$V{gs}', ' evaluationTime="Group" evaluationGroup="G"'), line('@R', 1, '$V{tot}', ' evaluationTime="Report"')] });
    expect((await lines(xml)).join(' | ')).toBe('@H 3 | @R 15 | @H 12 | @R 15');
  });
});
