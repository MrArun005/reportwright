// @ts-check
/**
 * Native, editable Excel charts (DrawingML c:chart) for the xlsx export. ExcelJS writes no charts, so the workbook it
 * wrote is opened again (fflate) and each chart sheet gets a drawing with one chart bound to the data on that sheet:
 * column, bar, line, area (clustered, stacked, 100%), pie, doughnut, scatter, bubble, radar, and combinations of
 * column / line / area with a secondary value axis. Each series carries its cached values, so a reader that does not
 * recalculate (LibreOffice, a previewer) still draws it.
 */
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';

/**
 * The one way report text gets into these parts, as a text node or an attribute value: characters XML 1.0 does not
 * allow (control characters, lone surrogates, U+FFFE/FFFF) are dropped, and & < > " ' are escaped.
 * @param {any} s
 */
export const esc = (s) => String(s ?? '')
  .replace(/[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const NS = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
/** A sheet reference, ready for a <c:f> text node: 'Name'!$A$1:$A$5, the name quoted with ' doubled, then escaped. */
const ref = (sheet, c1, r1, c2, r2) => esc(`'${String(sheet).replace(/'/g, "''")}'!$${col(c1)}$${r1}:$${col(c2)}$${r2}`);
const col = (c) => { let s = ''; for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const hex = (c) => (/^#[0-9a-f]{6}/i.test(String(c || '')) ? String(c).slice(1, 7).toUpperCase() : null); // only 6 hex digits reach the XML

/**
 * The cells a chart's data takes on its sheet, from row 1: a header row, then one row per category (or point).
 * @param {any} spec items[0].xchart (engine/items/chart.js nativeSpec)
 * @returns {any[][]}
 */
export function chartTable(spec) {
  if (spec.categories) {
    const head = ['', ...spec.series.map(s => s.name)];
    return [head, ...spec.categories.map((c, i) => [c, ...spec.series.map(s => s.values[i] ?? null)])];
  }
  // x/y series: X, Y (and Size) columns per series, side by side
  const n = Math.max(0, ...spec.series.map(s => s.x.length));
  const per = spec.type === 'bubble' ? 3 : 2;
  const head = spec.series.flatMap(s => [`${s.name} X`, s.name, ...(per === 3 ? [`${s.name} size`] : [])]);
  const rows = Array.from({ length: n }, (_, i) => spec.series.flatMap(s => [s.x[i] ?? null, s.y[i] ?? null, ...(per === 3 ? [s.size?.[i] ?? null] : [])]));
  return [head, ...rows];
}

const strCache = (vals) => `<c:strCache><c:ptCount val="${vals.length}"/>${vals.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('')}</c:strCache>`;
const numCache = (vals, fmt = 'General') => `<c:numCache><c:formatCode>${esc(fmt)}</c:formatCode><c:ptCount val="${vals.length}"/>${vals.map((v, i) => (typeof v !== 'number' || !Number.isFinite(v) ? '' : `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`)).join('')}</c:numCache>`;
const fill = (c, line) => { const h = hex(c); if (!h) return ''; return line ? `<c:spPr><a:ln w="22225"><a:solidFill><a:srgbClr val="${h}"/></a:solidFill></a:ln></c:spPr>` : `<c:spPr><a:solidFill><a:srgbClr val="${h}"/></a:solidFill></c:spPr>`; };
const title = (t) => (t ? `<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>${esc(t)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>` : '');

/**
 * The chart part (xl/charts/chartN.xml) for a spec whose data starts at A1 of `sheet`.
 * @param {any} spec @param {string} sheet
 */
export function chartXml(spec, sheet) {
  const t = spec.type;
  const fmt = spec.format && /[#0]/.test(spec.format) ? spec.format : 'General';
  let plot = '', axes = '';
  const AX = { cat: 500001, val: 500002, cat2: 500003, val2: 500004 };
  const axIds = (two) => `<c:axId val="${two ? AX.cat2 : AX.cat}"/><c:axId val="${two ? AX.val2 : AX.val}"/>`;
  if (spec.categories) {
    const n = spec.categories.length;
    const cat = `<c:cat><c:strRef><c:f>${ref(sheet, 1, 2, 1, n + 1)}</c:f>${strCache(spec.categories)}</c:strRef></c:cat>`;
    const ser = (s, i, kind) => {
      const c = i + 2;
      const line = kind === 'line' || kind === 'radar';
      return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:strRef><c:f>${ref(sheet, c, 1, c, 1)}</c:f>${strCache([s.name])}</c:strRef></c:tx>${t === 'pie' || t === 'donut' ? '' : fill(s.color, line)}${line ? '<c:marker><c:symbol val="none"/></c:marker>' : ''}${cat}<c:val><c:numRef><c:f>${ref(sheet, c, 2, c, n + 1)}</c:f>${numCache(s.values, fmt)}</c:numRef></c:val>${kind === 'line' ? '<c:smooth val="0"/>' : ''}</c:ser>`;
    };
    if (t === 'pie' || t === 'donut') {
      const s = spec.series[0];
      const pts = spec.categories.map((_, i) => `<c:dPt><c:idx val="${i}"/><c:bubble3D val="0"/>${fill(spec.colors?.[i] || PALETTE[i % PALETTE.length])}</c:dPt>`).join('');
      const one = ser(s, 0, 'pie').replace('<c:cat>', `${pts}<c:cat>`);
      plot = t === 'pie' ? `<c:pieChart><c:varyColors val="1"/>${one}<c:firstSliceAng val="0"/></c:pieChart>` : `<c:doughnutChart><c:varyColors val="1"/>${one}<c:firstSliceAng val="0"/><c:holeSize val="55"/></c:doughnutChart>`;
    } else if (t === 'radar') {
      plot = `<c:radarChart><c:radarStyle val="marker"/><c:varyColors val="0"/>${spec.series.map((s, i) => ser(s, i, 'radar')).join('')}${axIds(false)}</c:radarChart>`;
      axes = catAx(AX.cat, AX.val, 'b', false, null) + valAx(AX.val, AX.cat, 'l', false, fmt, null);
    } else {
      // one chart group per (kind, axis): a combination chart when series differ in kind or axis
      const groups = new Map();
      spec.series.forEach((s, i) => {
        const kind = t === 'bar' ? 'bar' : s.kind || t;
        const k = `${kind}|${s.secondary ? 2 : 1}`;
        if (!groups.has(k)) groups.set(k, { kind, two: !!s.secondary, list: [] });
        groups.get(k).list.push([s, i]);
      });
      const grouping = spec.stacked === 'percent' ? 'percentStacked' : spec.stacked ? 'stacked' : null;
      for (const gr of groups.values()) {
        const body = gr.list.map(([s, i]) => ser(s, i, gr.kind)).join('');
        if (gr.kind === 'column' || gr.kind === 'bar') plot += `<c:barChart><c:barDir val="${t === 'bar' ? 'bar' : 'col'}"/><c:grouping val="${grouping || 'clustered'}"/><c:varyColors val="0"/>${body}<c:gapWidth val="80"/>${grouping ? '<c:overlap val="100"/>' : ''}${axIds(gr.two)}</c:barChart>`;
        else if (gr.kind === 'line') plot += `<c:lineChart><c:grouping val="${grouping || 'standard'}"/><c:varyColors val="0"/>${body}<c:marker val="1"/>${axIds(gr.two)}</c:lineChart>`;
        else plot += `<c:areaChart><c:grouping val="${grouping || 'standard'}"/><c:varyColors val="0"/>${body}${axIds(gr.two)}</c:areaChart>`;
      }
      const horiz = t === 'bar';
      axes = catAx(AX.cat, AX.val, horiz ? 'l' : 'b', false, spec.xTitle) + valAx(AX.val, AX.cat, horiz ? 'b' : 'l', false, spec.stacked === 'percent' ? '0%' : fmt, spec.yTitle);
      if ([...groups.values()].some(g => g.two)) axes += catAx(AX.cat2, AX.val2, horiz ? 'r' : 't', true, null) + valAx(AX.val2, AX.cat2, horiz ? 't' : 'r', true, fmt, null);
    }
  } else {
    // scatter and bubble: X and Y (and size) columns per series
    const per = t === 'bubble' ? 3 : 2;
    const body = spec.series.map((s, i) => {
      const c = 1 + i * per, n = s.x.length;
      return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:strRef><c:f>${ref(sheet, c + 1, 1, c + 1, 1)}</c:f>${strCache([s.name])}</c:strRef></c:tx>${t === 'bubble' ? fill(s.color) : `<c:spPr><a:ln w="19050"><a:noFill/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="5"/>${fill(s.color)}</c:marker>`}`
        + `<c:xVal><c:numRef><c:f>${ref(sheet, c, 2, c, n + 1)}</c:f>${numCache(s.x)}</c:numRef></c:xVal><c:yVal><c:numRef><c:f>${ref(sheet, c + 1, 2, c + 1, n + 1)}</c:f>${numCache(s.y, fmt)}</c:numRef></c:yVal>`
        + (t === 'bubble' ? `<c:bubbleSize><c:numRef><c:f>${ref(sheet, c + 2, 2, c + 2, n + 1)}</c:f>${numCache(s.size || [])}</c:numRef></c:bubbleSize><c:bubble3D val="0"/>` : '<c:smooth val="0"/>') + '</c:ser>';
    }).join('');
    plot = t === 'bubble' ? `<c:bubbleChart><c:varyColors val="0"/>${body}<c:bubbleScale val="100"/>${axIds(false)}</c:bubbleChart>`
      : `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${body}${axIds(false)}</c:scatterChart>`;
    axes = valAx(AX.cat, AX.val, 'b', false, 'General', spec.xTitle) + valAx(AX.val, AX.cat, 'l', false, fmt, spec.yTitle);
  }
  const legend = spec.legend && (spec.series.length > 1 || t === 'pie' || t === 'donut') ? '<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>' : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<c:chartSpace ${NS}><c:roundedCorners val="0"/><c:chart>${title(spec.title)}<c:autoTitleDeleted val="${spec.title ? 0 : 1}"/><c:plotArea><c:layout/>${plot}${axes}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
}
const axTitle = (t) => (t ? title(t) : '');
function catAx(id, cross, pos, second, t) {
  return `<c:catAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="${second ? 1 : 0}"/><c:axPos val="${pos}"/>${axTitle(t)}<c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${cross}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`;
}
function valAx(id, cross, pos, second, fmt, t) {
  return `<c:valAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${pos}"/>${second ? '' : '<c:majorGridlines/>'}${axTitle(t)}<c:numFmt formatCode="${esc(fmt)}" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${cross}"/><c:crosses val="${second ? 'max' : 'autoZero'}"/><c:crossBetween val="between"/></c:valAx>`;
}
const PALETTE = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#475569'];

/** A drawing part with one chart anchored at (col, row) (0-based), cols × rows cells. */
const drawingXml = (c0, r0, cols, rows) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${c0}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r0}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${c0 + cols}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r0 + rows}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>`;
const rels = (list) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.join('')}</Relationships>`;
const rel = (id, type, target) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;

/**
 * Add the charts to a workbook ExcelJS wrote. Each chart: { sheet (its sheet's name), spec, at: { col, row } } with
 * its data at A1 of that sheet; the sheets have no drawing of their own.
 * @param {Uint8Array} bytes @param {{ sheet: string, spec: any, at: { col: number, row: number } }[]} charts
 * @returns {Uint8Array}
 */
export function addCharts(bytes, charts) {
  if (!charts.length) return bytes;
  const files = unzipSync(bytes);
  const read = (p) => (files[p] ? strFromU8(files[p]) : null);
  const write = (p, s) => { files[p] = strToU8(s); };
  // sheet name → its part, through workbook.xml and its relationships
  const wb = read('xl/workbook.xml') || '';
  const wbRels = read('xl/_rels/workbook.xml.rels') || '';
  const target = (rid) => { const m = new RegExp(`<Relationship[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(wbRels) || new RegExp(`<Relationship[^>]*Target="([^"]+)"[^>]*Id="${rid}"`).exec(wbRels); return m ? m[1].replace(/^\/?xl\//, '') : null; };
  const partOf = new Map();
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = /name="([^"]*)"/.exec(m[0])?.[1], rid = /r:id="([^"]*)"/.exec(m[0])?.[1];
    if (name != null && rid) partOf.set(name.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"), target(rid));
  }
  let types = read('[Content_Types].xml') || '';
  charts.forEach((c, i) => {
    const part = partOf.get(c.sheet);
    if (!part) return;
    const n = i + 1;
    const sheetPath = `xl/${part}`, file = part.split('/').pop();
    const relPath = `xl/worksheets/_rels/${file}.rels`;
    write(`xl/charts/chartPW${n}.xml`, chartXml(c.spec, c.sheet));
    write(`xl/drawings/drawingPW${n}.xml`, drawingXml(c.at.col, c.at.row, 9, 20));
    write(`xl/drawings/_rels/drawingPW${n}.xml.rels`, rels([rel('rId1', 'chart', `../charts/chartPW${n}.xml`)]));
    const old = read(relPath);
    const relEntry = rel('rIdPW1', 'drawing', `../drawings/drawingPW${n}.xml`);
    write(relPath, old ? old.replace('</Relationships>', `${relEntry}</Relationships>`) : rels([relEntry]));
    let ws = read(sheetPath) || '';
    if (!/xmlns:r=/.test(ws.slice(0, 600))) ws = ws.replace('<worksheet ', '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
    const before = ['<legacyDrawing', '<legacyDrawingHF', '<picture', '<oleObjects', '<controls', '<webPublishItems', '<tableParts', '<extLst', '</worksheet>'].map(t => ws.indexOf(t)).filter(k => k >= 0);
    const at = Math.min(...before);
    write(sheetPath, ws.slice(0, at) + '<drawing r:id="rIdPW1"/>' + ws.slice(at));
    types = types.replace('</Types>', `<Override PartName="/xl/charts/chartPW${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/><Override PartName="/xl/drawings/drawingPW${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
  });
  write('[Content_Types].xml', types);
  return zipSync(files, { level: 6 });
}
