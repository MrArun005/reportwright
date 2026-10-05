// REVIEW-ENGINE A7, A8 (JRXML: PAGE_NUMBER evaluation time, Java numeric semantics) and A6 (BIRT "All" aggregates).
import { describe, it, expect } from 'vitest';
import { importJrxml } from '../../src/importers/jrxml.js';
import { importBirt } from '../../src/importers/birt.js';
import { render } from '../../src/engine/index.js';
import { fontStore, texts } from '../helpers.js';

const jr = (body, { lang = 'java', fields = '', footer = '' } = {}) => `<jasperReport name="R" language="${lang}" pageWidth="595" pageHeight="842" columnWidth="555" leftMargin="20" rightMargin="20" topMargin="20" bottomMargin="20">
  ${fields}<detail><band height="16">${body}</band></detail>${footer}</jasperReport>`;
const tf = (expr, { x = 0, pattern, evalTime } = {}) => `<textField${pattern ? ` pattern="${pattern}"` : ''}${evalTime ? ` evaluationTime="${evalTime}"` : ''}><reportElement x="${x}" y="0" width="120" height="14"/><textFieldExpression><![CDATA[${expr}]]></textFieldExpression></textField>`;

describe('JRXML import', () => {
  it('$V{PAGE_NUMBER} is the current page unless evaluationTime is Report or Auto (ground truth: Jasper 7.0.8 prints the total for Auto)', async () => {
    const footer = `<pageFooter><band height="16">${tf('"Page " + $V{PAGE_NUMBER}', { evalTime: 'Page' })}${tf('" of " + $V{PAGE_NUMBER}', { x: 200, evalTime: 'Report' })}${tf('"auto " + $V{PAGE_NUMBER}', { x: 400, evalTime: 'Auto' })}</band></pageFooter>`;
    const r = importJrxml(jr(tf('$F{n}'), { fields: '<field name="n" class="java.lang.Integer"/>', footer }));
    const rows = Array.from({ length: 120 }, (_, n) => ({ n }));
    const out = await render(r.definition, { fontStore, sources: { JasperDataSource: rows } });
    expect(out.pages.length).toBeGreaterThan(1);
    const last = out.pages.length;
    out.pages.forEach((p, i) => expect(texts(p)).toEqual(expect.arrayContaining([`Page ${i + 1}`, `of ${last}`, `auto ${last}`])));
  });
  it('Java numbers: int / int truncates, (int) and intValue() truncate, Math.round is floor(x + 0.5), DecimalFormat is half even', async () => {
    const fields = '<field name="q" class="java.lang.Integer"/><field name="amt" class="java.math.BigDecimal"/><field name="neg" class="java.lang.Double"/>';
    const body = [
      tf('"q/2=" + ($F{q} / 2)'), tf('"int=" + (int) $F{amt}.doubleValue()', { x: 120 }), tf('"iv=" + $F{amt}.intValue()', { x: 240 }),
      tf('"round=" + Math.round($F{neg})', { x: 360 }), tf('$F{amt}', { x: 480, pattern: '#,##0.00' }),
    ].join('');
    const r = importJrxml(jr(body, { fields }));
    const out = await render(r.definition, { fontStore, sources: { JasperDataSource: [{ q: 7, amt: 2.675, neg: -2.5 }, { q: 8, amt: 10.125, neg: 2.5 }] } });
    // 2.675 is 2.67499999999999982… in binary: JDK 23's DecimalFormat (half even on the exact value) prints 2.67
    expect(texts(out.pages[0])).toEqual(['q/2=3', 'int=2', 'iv=2', 'round=-2', '2.67', 'q/2=4', 'int=10', 'iv=10', 'round=3', '10.12']);
  });
  it('DecimalFormat #,##0 on 2.5 shows 2; Groovy divides integers exactly', async () => {
    const fields = '<field name="q" class="java.lang.Integer"/><field name="x" class="java.lang.Double"/>';
    const j = importJrxml(jr(tf('$F{x}', { pattern: '#,##0' }), { fields }));
    expect(texts((await render(j.definition, { fontStore, sources: { JasperDataSource: [{ x: 2.5 }, { x: 3.5 }] } })).pages[0])).toEqual(['2', '4']);
    const g = importJrxml(jr(tf('$F{q} / 2'), { fields, lang: 'groovy' }));
    expect(texts((await render(g.definition, { fontStore, sources: { JasperDataSource: [{ q: 7 }] } })).pages[0])).toEqual(['3.5']);
  });
});

describe('BIRT import', () => {
  const P = (n, v) => `<property name="${n}">${v}</property>`;
  const X = (n, v) => `<expression name="${n}">${v}</expression>`;
  const sum = (name, on) => `<structure>${P('name', name)}${P('dataType', 'float')}${P('aggregateFunction', 'SUM')}${on ? `<simple-property-list name="aggregateOn"><value>${on}</value></simple-property-list>` : ''}<list-property name="arguments"><structure>${P('name', 'Expression')}${X('value', 'row["v"]')}</structure></list-property></structure>`;
  const data = (c) => `<cell><data>${P('resultSetColumn', c)}</data></cell>`;
  const design = `<report xmlns="http://www.eclipse.org/birt/2005/design" version="3.2.23">
  <data-sources><oda-data-source extensionID="org.eclipse.birt.report.data.oda.jdbc" name="DB"/></data-sources>
  <data-sets><oda-data-set extensionID="org.eclipse.birt.report.data.oda.jdbc.JdbcSelectDataSet" name="S">${P('dataSource', 'DB')}
    <list-property name="resultSet"><structure>${P('position', 1)}${P('name', 'g')}${P('dataType', 'string')}</structure><structure>${P('position', 2)}${P('name', 'v')}${P('dataType', 'float')}</structure></list-property>
    <xml-property name="queryText">select g, v from t</xml-property></oda-data-set></data-sets>
  <body><table>${P('dataSet', 'S')}
    <list-property name="boundDataColumns"><structure>${P('name', 'v')}${X('expression', 'dataSetRow["v"]')}</structure>${sum('G', 'G')}${sum('All', 'All')}${sum('None')}</list-property>
    <column/><column/><column/>
    <group>${P('groupName', 'G')}${X('keyExpr', 'row["g"]')}<footer><row>${data('G')}${data('All')}${data('None')}</row></footer></group>
    <detail><row>${data('All')}<cell/><cell/></row></detail>
  </table></body></report>`;
  it('an aggregate on "All" (or none) in a group footer or a detail row is the grand total', async () => {
    const r = importBirt(design);
    expect(r.error).toBeUndefined();
    const out = await render(r.definition, { fontStore, sources: { DB: [{ g: 'A', v: 1 }, { g: 'A', v: 2 }, { g: 'B', v: 10 }] } });
    expect(texts(out.pages[0])).toEqual(['13', '13', '3', '13', '13', '13', '10', '13', '13']);
  });
});
