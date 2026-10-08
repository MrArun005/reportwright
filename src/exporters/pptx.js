// @ts-check
// Page model → PowerPoint (.pptx): one slide per page, the page drawn as native, editable shapes where it can be.
// Text is a text box at the engine's position (its own font, size, colour, weight, alignment; URL links stay links),
// boxes, ellipses and lines are shapes (fill, border, dash, rounded corners), and charts, pictures, maps, barcodes
// and in-cell visuals are pictures (SVG with a PNG fallback, as in the Word export). The slide size is the first
// page's (PowerPoint has one size per file). Written by hand with fflate, like the Word export.
import { zipSync, strToU8 } from 'fflate';
import { visualLines } from './regions.js';
import { figures, figurePicture, figureSvg, rasterize, hexOrNull, altOf, boxOf } from './figures.js';
import { alignOf } from './docx.js';
import { parseColor } from './color.js';
import { withDeadline } from './deadline.js';
import { officeFamily } from '../engine/text/fonts.js';
import { safeUrl } from '../engine/url.js';

const EMU = 12700; // per point
const e = (v) => Math.round(v * EMU);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, ''); // characters XML 1.0 cannot hold
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** A fill: solid colour (with its alpha), or none. */
function fill(c) {
  const p = parseColor(c);
  const h = hexOrNull(c) || (p ? [p.r, p.g, p.b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase() : null);
  if (!p || !h || p.a === 0) return '<a:noFill/>';
  return `<a:solidFill>${p.a < 1 ? `<a:srgbClr val="${h}"><a:alpha val="${Math.round(p.a * 100000)}"/></a:srgbClr>` : `<a:srgbClr val="${h}"/>`}</a:solidFill>`;
}
/** A line (outline) of a shape. */
function outline(it) {
  if (!it.stroke || !parseColor(it.stroke)) return '<a:ln><a:noFill/></a:ln>';
  const dash = it.dash ? `<a:prstDash val="${it.dash[0] <= 1.5 ? 'sysDot' : 'dash'}"/>` : '';
  return `<a:ln w="${e(Number(it.strokeWidth) || 1)}">${fill(it.stroke)}${dash}</a:ln>`;
}
const rot = (it) => (it.rotate ? ` rot="${Math.round(((it.rotate.a % 360) + 360) % 360 * 60000)}"` : '');

/**
 * @param {any} model render() output
 * @param {{ title?: string, author?: string, lang?: string, fontStore?: any, fetchImage?: (src: string) => Promise<Uint8Array|null>,
 *   rasterize?: (svg: string, w: number, h: number, scale: number) => Promise<Uint8Array|null> }} [opt]
 * @returns {Promise<Uint8Array>}
 */
export function exportPptx(model, opt = {}) {
  return withDeadline(pptxOf(model, opt), /** @type {any} */ (opt).timeoutMs);
}
/** @type {typeof exportPptx} */
async function pptxOf(model, opt) {
  const W = model.pages[0]?.width ?? model.width, H = model.pages[0]?.height ?? model.height;
  const lang = esc(opt.lang || 'en-US');
  /** @type {Record<string, Uint8Array>} */
  const files = {};
  let mediaN = 0;
  const slides = [];
  const picOpt = { fontStore: opt.fontStore, fetchImage: opt.fetchImage, rasterize: opt.rasterize };
  const ascentOf = (key) => { try { const f = opt.fontStore?.get(key); return f ? f.ascent / f.unitsPerEm : 0.93; } catch { return 0.93; } };

  for (const [pi, pg] of model.pages.entries()) {
    const rels = [`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`];
    const rel = (type, target, ext = false) => { const id = `rId${rels.length + 1}`; rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${esc(target)}"${ext ? ' TargetMode="External"' : ''}/>`); return id; };
    const media = (bytes, ext) => { const name = `image${++mediaN}.${ext}`; files[`ppt/media/${name}`] = bytes; return rel('image', `../media/${name}`); };
    let id = 1;
    const shapes = [];
    const items = pg.items.flatMap(i => (i.t === 'field' ? i.draw : [i]));
    const pics = new Map(); // first item index → figure; other indexes of a figure → null
    for (const f of figures(items)) {
      if (f.tag.k === 'shape' || f.tag.k === 'line') continue; // native shapes
      pics.set(f.at, f);
      for (let k = f.at + 1; k <= f.last; k++) pics.set(k, null);
    }
    // URL links: on the text box under them
    const href = new Map();
    items.forEach((it, i) => {
      if (it.t !== 'link' || it.action?.type !== 'url' || !safeUrl(it.action.href)) return;
      for (let k = i - 1; k >= 0 && k >= i - 8; k--) {
        const t = items[k];
        if (t.t === 'text' && t.clip && t.clip.x < it.x + it.w && it.x < t.clip.x + t.clip.w && t.clip.y < it.y + it.h && it.y < t.clip.y + t.clip.h) { href.set(t, it.action.href); break; }
      }
    });
    const picture = (pic, alt) => {
      const main = pic.png ? media(pic.png, 'png') : pic.jpeg ? media(pic.jpeg, 'jpeg') : pic.svg ? media(strToU8(pic.svg), 'svg') : null;
      if (!main) return '';
      const svg = pic.png && pic.svg ? media(strToU8(pic.svg), 'svg') : null;
      const n = ++id;
      const ext = svg ? `<a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}"><asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="${svg}"/></a:ext></a:extLst>` : '';
      return `<p:pic><p:nvPicPr><p:cNvPr id="${n}" name="Picture ${n}" descr="${esc(alt)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${main}">${ext}</a:blip><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${e(pic.x)}" y="${e(pic.y)}"/><a:ext cx="${Math.max(1, e(pic.w))}" cy="${Math.max(1, e(pic.h))}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
    };
    const sp = (name, x, y, w, h, geom, body, extra = '') => {
      const n = ++id;
      return `<p:sp><p:nvSpPr><p:cNvPr id="${n}" name="${name} ${n}"/><p:cNvSpPr${body ? ' txBox="1"' : ''}/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm${extra}><a:off x="${e(x)}" y="${e(y)}"/><a:ext cx="${Math.max(1, e(w))}" cy="${Math.max(1, e(h))}"/></a:xfrm>${geom}</p:spPr>${body || ''}</p:sp>`;
    };
    let skipDeco = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (pics.has(i)) {
        const f = pics.get(i);
        if (f) shapes.push(picture(await figurePicture(f, picOpt), altOf(f.tag)));
        continue;
      }
      if (skipDeco > 0 && it.t === 'line') { skipDeco--; continue; }
      skipDeco = 0;
      switch (it.t) {
        case 'rect': {
          if (!parseColor(it.fill) && !parseColor(it.stroke)) break;
          const r = Math.min(it.radius || 0, it.w / 2, it.h / 2);
          const geom = r > 0 ? `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${Math.round((r / Math.min(it.w, it.h)) * 100000)}"/></a:avLst></a:prstGeom>` : '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>';
          shapes.push(sp('Rectangle', it.x, it.y, it.w, it.h, `${geom}${fill(it.fill)}${outline(it)}`, '', rot(it)));
          break;
        }
        case 'ellipse':
          shapes.push(sp('Oval', it.cx - it.rx, it.cy - it.ry, 2 * it.rx, 2 * it.ry, `<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>${fill(it.fill)}${outline(it)}`, '', rot(it)));
          break;
        case 'line': {
          if (!parseColor(it.stroke)) break;
          const x = Math.min(it.x1, it.x2), y = Math.min(it.y1, it.y2);
          const flip = `${it.x2 < it.x1 ? ' flipH="1"' : ''}${it.y2 < it.y1 ? ' flipV="1"' : ''}`;
          const n = ++id;
          shapes.push(`<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${n}" name="Line ${n}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm${flip}><a:off x="${e(x)}" y="${e(y)}"/><a:ext cx="${e(Math.abs(it.x2 - it.x1))}" cy="${e(Math.abs(it.y2 - it.y1))}"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom>${outline(it)}</p:spPr></p:cxnSp>`);
          break;
        }
        case 'path': case 'image': {
          // a free path or a background picture: a picture of it
          const box = boxOf([it]);
          if (!box || box.w < 0.5 || box.h < 0.5) break;
          const fig = { items: [it], box, tag: { k: it.t === 'image' ? 'image' : 'shape' } };
          const pic = it.t === 'image' ? await figurePicture(fig, picOpt) : await (async () => { const svg = figureSvg(fig, opt.fontStore); return { svg, png: await rasterize(svg, box.w, box.h, picOpt), ...box }; })();
          shapes.push(picture(pic, it.t === 'image' ? 'Picture' : 'Shape'));
          break;
        }
        case 'text': {
          if (!it.lines?.length) break;
          const text = visualLines(it);
          if (!text.join('').trim()) break;
          const deco = String(it.deco || '');
          if (deco) skipDeco = it.lines.length * ((deco.includes('underline') ? 1 : 0) + (deco.includes('line-through') ? 1 : 0));
          const asc = ascentOf(it.font) * it.size;
          const ys = [...new Set(it.lines.map(l => l.y))].sort((a, b) => a - b);
          const gap = ys.length > 1 ? (ys[ys.length - 1] - ys[0]) / (ys.length - 1) : it.size * 1.25;
          const minX = Math.min(...it.lines.map(l => l.x)), maxX = Math.max(...it.lines.map(l => l.x + (l.w || 0)));
          const box = it.clip && !it.rich ? it.clip : { x: minX, y: ys[0] - asc, w: Math.max(1, maxX - minX), h: ys[ys.length - 1] - ys[0] + it.size * 1.3 };
          // insets put the first baseline where the engine put it
          const top = Math.max(0, ys[0] - asc - box.y);
          const algn = { left: 'l', right: 'r', center: 'ctr', both: 'just' }[it.rich ? 'left' : alignOf(it)] || 'l';
          const lIns = it.clip && !it.rich ? Math.max(0, (algn === 'l' || algn === 'just' ? minX - box.x : algn === 'ctr' ? 0 : 0)) : 0;
          const rIns = it.clip && !it.rich && algn === 'r' ? Math.max(0, box.x + box.w - maxX) : 0;
          const f = String(it.font || '');
          const family = officeFamily(f);
          const link = href.get(it);
          const hl = link ? `<a:hlinkClick r:id="${rel('hyperlink', link, true)}"/>` : '';
          const rpr = `<a:rPr lang="${lang}" sz="${Math.max(100, Math.round(it.size * 100))}" b="${/bold/i.test(f) ? 1 : 0}" i="${/italic|oblique/i.test(f) ? 1 : 0}"${deco.includes('underline') ? ' u="sng"' : ''}${deco.includes('line-through') ? ' strike="sngStrike"' : ''} dirty="0">${fill(it.color || '#000')}<a:latin typeface="${esc(family)}"/><a:cs typeface="${esc(family)}"/>${hl}</a:rPr>`;
          const paras = text.map(t => `<a:p><a:pPr algn="${algn}"><a:lnSpc><a:spcPts val="${Math.max(100, Math.round(gap * 100))}"/></a:lnSpc></a:pPr><a:r>${rpr}<a:t>${esc(t)}</a:t></a:r></a:p>`).join('');
          const body = `<p:txBody><a:bodyPr wrap="${it.clip && !it.rich && text.length > 1 ? 'square' : 'none'}" lIns="${e(lIns)}" tIns="${e(top)}" rIns="${e(rIns)}" bIns="0" anchor="t" rtlCol="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody>`;
          shapes.push(sp('Text', box.x, box.y, box.w, box.h, '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/>', body, rot(it)));
          break;
        }
      }
    }
    const xml = `${XML}<p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
    files[`ppt/slides/slide${pi + 1}.xml`] = strToU8(xml);
    files[`ppt/slides/_rels/slide${pi + 1}.xml.rels`] = strToU8(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`);
    slides.push(pi + 1);
  }

  const cx = Math.min(51206400, Math.max(914400, e(W))), cy = Math.min(51206400, Math.max(914400, e(H)));
  files['ppt/presentation.xml'] = strToU8(`${XML}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((n, i) => `<p:sldId id="${256 + i}" r:id="rId${n + 2}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="${cy}" cy="${cx}"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="${lang}"/></a:defPPr></p:defaultTextStyle></p:presentation>`);
  files['ppt/_rels/presentation.xml.rels'] = strToU8(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>${slides.map(n => `<Relationship Id="rId${n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${n}.xml"/>`).join('')}</Relationships>`);
  const emptyTree = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree>';
  files['ppt/slideMasters/slideMaster1.xml'] = strToU8(`${XML}<p:sldMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>${emptyTree}</p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="2400"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1200"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1200"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`);
  files['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = strToU8(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`);
  files['ppt/slideLayouts/slideLayout1.xml'] = strToU8(`${XML}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank">${emptyTree}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
  files['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = strToU8(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`);
  files['ppt/theme/theme1.xml'] = strToU8(THEME);
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  files['docProps/core.xml'] = strToU8(`${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(opt.title || model.name || 'Report')}</dc:title>${opt.author ? `<dc:creator>${esc(opt.author)}</dc:creator>` : ''}<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`);
  files['_rels/.rels'] = strToU8(`${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  files['[Content_Types].xml'] = strToU8(`${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="svg" ContentType="image/svg+xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slides.map(n => `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
  return zipSync(files, { level: 6 });
}

/** A plain Office theme: the colours, fonts and effect lists PowerPoint wants to find. */
const THEME = `${XML}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="ReportWright"><a:themeElements><a:clrScheme name="ReportWright"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2328"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="2563EB"/></a:accent1><a:accent2><a:srgbClr val="F59E0B"/></a:accent2><a:accent3><a:srgbClr val="16A34A"/></a:accent3><a:accent4><a:srgbClr val="DC2626"/></a:accent4><a:accent5><a:srgbClr val="7C3AED"/></a:accent5><a:accent6><a:srgbClr val="0891B2"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="ReportWright"><a:majorFont><a:latin typeface="Inter"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Inter"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="ReportWright"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
