// @ts-check
/**
 * SVG path data as PDF operators, exactly as pdf-lib 1.17.1 writes them (api/svgPath.js and drawSvgPath in
 * api/operations.js; MIT, Copyright (c) 2019 Andrew Dillon), so a path, a rounded box or an SVG picture drawn by the
 * paged writer is the same file content, operator for operator, as on pdf-lib's path (the parity gate needs the same
 * pixels). Kept faithfully, quirks included: an arc overwrites the last control point (px, py) and a quadratic curve
 * is written with "v". Text, not pdf-lib objects: nothing here loads pdf-lib.
 */

/** pdf-lib's numberToString: a number in decimal, never in exponent form @param {number} num */
export function pdfNum(num) {
  let s = String(num);
  if (Math.abs(num) < 1.0) {
    const e = parseInt(num.toString().split('e-')[1]);
    if (e) {
      const negative = num < 0;
      if (negative) num *= -1;
      num *= Math.pow(10, e - 1);
      s = '0.' + new Array(e).join('0') + num.toString().substring(2);
      if (negative) s = '-' + s;
    }
  } else {
    let e = parseInt(num.toString().split('+')[1]);
    if (e > 20) { e -= 20; num /= Math.pow(10, e); s = num.toString() + new Array(e + 1).join('0'); }
  }
  return s;
}
const op = (/** @type {string} */ name, /** @type {number[]} */ args) => (args.length ? args.map(pdfNum).join(' ') + ' ' : '') + name;

/** @type {Record<string, number>} */
const PARAMS = { A: 7, a: 7, C: 6, c: 6, H: 1, h: 1, L: 2, l: 2, M: 2, m: 2, Q: 4, q: 4, S: 4, s: 4, T: 2, t: 2, V: 1, v: 1, Z: 0, z: 0 };

/** @param {string} path @returns {{ cmd: string|undefined, args: number[] }[]} */
function parse(path) {
  /** @type {string|undefined} */
  let cmd;
  const ret = [];
  /** @type {number[]} */
  let args = [];
  let curArg = '', foundDecimal = false, params = 0;
  for (const c of path) {
    if (c in PARAMS) {
      params = PARAMS[c];
      if (cmd) {
        if (curArg.length > 0) args[args.length] = +curArg;
        ret[ret.length] = { cmd, args };
        args = []; curArg = ''; foundDecimal = false;
      }
      cmd = c;
    } else if ([' ', ','].includes(c) || (c === '-' && curArg.length > 0 && curArg[curArg.length - 1] !== 'e') || (c === '.' && foundDecimal)) {
      if (curArg.length === 0) continue;
      if (args.length === params) {
        ret[ret.length] = { cmd, args };
        args = [+curArg];
        if (cmd === 'M') cmd = 'L';
        if (cmd === 'm') cmd = 'l';
      } else args[args.length] = +curArg;
      foundDecimal = c === '.';
      curArg = ['-', '.'].includes(c) ? c : '';
    } else {
      curArg += c;
      if (c === '.') foundDecimal = true;
    }
  }
  if (curArg.length > 0) {
    if (args.length === params) {
      ret[ret.length] = { cmd, args };
      args = [+curArg];
      if (cmd === 'M') cmd = 'L';
      if (cmd === 'm') cmd = 'l';
    } else args[args.length] = +curArg;
  }
  ret[ret.length] = { cmd, args };
  return ret;
}

/**
 * The path operators (m, l, c, v, h) of SVG path data, one per line, in SVG user space.
 * @param {string} d @returns {string[]}
 */
export function svgPathOperators(d) {
  // current point, control point, subpath start (module state in pdf-lib; local here, the same values)
  let cx = 0, cy = 0, sx = 0, sy = 0;
  /** @type {number|null} */ let px = 0;
  /** @type {number|null} */ let py = 0;
  const bezier = (/** @type {number[]} */ a) => op('c', a);
  const quad = (/** @type {number[]} */ a) => op('v', a);
  /** pdf-lib's arcToSegments (it sets px, py as it goes) and segmentToBezier */
  const solveArc = (/** @type {number} */ x0, /** @type {number} */ y0, /** @type {number[]} */ coords) => {
    const [rx0, ry0, rot, large, sweep, ex, ey] = coords;
    const th = rot * (Math.PI / 180), sinTh = Math.sin(th), cosTh = Math.cos(th);
    let rx = Math.abs(rx0), ry = Math.abs(ry0);
    px = cosTh * (x0 - ex) * 0.5 + sinTh * (y0 - ey) * 0.5;
    py = cosTh * (y0 - ey) * 0.5 - sinTh * (x0 - ex) * 0.5;
    let pl = (px * px) / (rx * rx) + (py * py) / (ry * ry);
    if (pl > 1) { pl = Math.sqrt(pl); rx *= pl; ry *= pl; }
    const a00 = cosTh / rx, a01 = sinTh / rx, a10 = -sinTh / ry, a11 = cosTh / ry;
    const X0 = a00 * x0 + a01 * y0, Y0 = a10 * x0 + a11 * y0, X1 = a00 * ex + a01 * ey, Y1 = a10 * ex + a11 * ey;
    const dd = (X1 - X0) * (X1 - X0) + (Y1 - Y0) * (Y1 - Y0);
    let sfactorSq = 1 / dd - 0.25;
    if (sfactorSq < 0) sfactorSq = 0;
    let sfactor = Math.sqrt(sfactorSq);
    if (sweep === large) sfactor = -sfactor;
    const xc = 0.5 * (X0 + X1) - sfactor * (Y1 - Y0), yc = 0.5 * (Y0 + Y1) + sfactor * (X1 - X0);
    const th0 = Math.atan2(Y0 - yc, X0 - xc), th1 = Math.atan2(Y1 - yc, X1 - xc);
    let thArc = th1 - th0;
    if (thArc < 0 && sweep === 1) thArc += 2 * Math.PI;
    else if (thArc > 0 && sweep === 0) thArc -= 2 * Math.PI;
    const segments = Math.ceil(Math.abs(thArc / (Math.PI * 0.5 + 0.001)));
    const out = [];
    for (let i = 0; i < segments; i++) {
      const t0 = th0 + (i * thArc) / segments, t1 = th0 + ((i + 1) * thArc) / segments;
      const b00 = cosTh * rx, b01 = -sinTh * ry, b10 = sinTh * rx, b11 = cosTh * ry;
      const thHalf = 0.5 * (t1 - t0);
      const t = ((8 / 3) * Math.sin(thHalf * 0.5) * Math.sin(thHalf * 0.5)) / Math.sin(thHalf);
      const x1 = xc + Math.cos(t0) - t * Math.sin(t0), y1 = yc + Math.sin(t0) + t * Math.cos(t0);
      const x3 = xc + Math.cos(t1), y3 = yc + Math.sin(t1);
      const x2 = x3 + t * Math.sin(t1), y2 = y3 - t * Math.cos(t1);
      out.push(bezier([b00 * x1 + b01 * y1, b10 * x1 + b11 * y1, b00 * x2 + b01 * y2, b10 * x2 + b11 * y2, b00 * x3 + b01 * y3, b10 * x3 + b11 * y3]));
    }
    return out;
  };
  /** @type {Record<string, (a: number[]) => string | string[]>} */
  const run = {
    M: (a) => { cx = a[0]; cy = a[1]; px = py = null; sx = cx; sy = cy; return op('m', [cx, cy]); },
    m: (a) => { cx += a[0]; cy += a[1]; px = py = null; sx = cx; sy = cy; return op('m', [cx, cy]); },
    C: (a) => { cx = a[4]; cy = a[5]; px = a[2]; py = a[3]; return bezier([a[0], a[1], a[2], a[3], a[4], a[5]]); },
    c: (a) => { const r = bezier([a[0] + cx, a[1] + cy, a[2] + cx, a[3] + cy, a[4] + cx, a[5] + cy]); px = cx + a[2]; py = cy + a[3]; cx += a[4]; cy += a[5]; return r; },
    S: (a) => { if (px === null || py === null) { px = cx; py = cy; } const r = bezier([cx - (px - cx), cy - (py - cy), a[0], a[1], a[2], a[3]]); px = a[0]; py = a[1]; cx = a[2]; cy = a[3]; return r; },
    s: (a) => { if (px === null || py === null) { px = cx; py = cy; } const r = bezier([cx - (px - cx), cy - (py - cy), cx + a[0], cy + a[1], cx + a[2], cy + a[3]]); px = cx + a[0]; py = cy + a[1]; cx += a[2]; cy += a[3]; return r; },
    Q: (a) => { px = a[0]; py = a[1]; cx = a[2]; cy = a[3]; return quad([a[0], a[1], cx, cy]); },
    q: (a) => { const r = quad([a[0] + cx, a[1] + cy, a[2] + cx, a[3] + cy]); px = cx + a[0]; py = cy + a[1]; cx += a[2]; cy += a[3]; return r; },
    T: (a) => { if (px === null || py === null) { px = cx; py = cy; } else { px = cx - (px - cx); py = cy - (py - cy); } const r = quad([px, py, a[0], a[1]]); px = cx - (px - cx); py = cy - (py - cy); cx = a[0]; cy = a[1]; return r; },
    t: (a) => { if (px === null || py === null) { px = cx; py = cy; } else { px = cx - (px - cx); py = cy - (py - cy); } const r = quad([px, py, cx + a[0], cy + a[1]]); cx += a[0]; cy += a[1]; return r; },
    A: (a) => { const r = solveArc(cx, cy, a); cx = a[5]; cy = a[6]; return r; },
    a: (a) => { a[5] += cx; a[6] += cy; const r = solveArc(cx, cy, a); cx = a[5]; cy = a[6]; return r; },
    L: (a) => { cx = a[0]; cy = a[1]; px = py = null; return op('l', [cx, cy]); },
    l: (a) => { cx += a[0]; cy += a[1]; px = py = null; return op('l', [cx, cy]); },
    H: (a) => { cx = a[0]; px = py = null; return op('l', [cx, cy]); },
    h: (a) => { cx += a[0]; px = py = null; return op('l', [cx, cy]); },
    V: (a) => { cy = a[0]; px = py = null; return op('l', [cx, cy]); },
    v: (a) => { cy += a[0]; px = py = null; return op('l', [cx, cy]); },
    Z: () => { cx = sx; cy = sy; return 'h'; },
    z: () => { cx = sx; cy = sy; return 'h'; },
  };
  /** @type {string[]} */
  const out = [];
  for (const c of parse(d)) if (c.cmd && run[c.cmd]) { const r = run[c.cmd](c.args); if (Array.isArray(r)) { for (const x of r) out.push(x); } else out.push(r); }
  return out;
}

/**
 * pdf-lib's page.drawSvgPath(d, o) as operator text: q, the opacity state, the placement (y flipped), the paint, the
 * path, the paint operator, Q. Colours are pdf-lib rgb() objects ({ red, green, blue }); gs: the graphics state's
 * name for the opacities, or undefined. A path pdf-lib's parser chokes on throws there too (the callers skip it).
 * @param {string} d
 * @param {{ x: number, y: number, gs?: string, color?: any, borderColor?: any, borderWidth?: number, borderLineCap?: number, borderDashArray?: number[] }} o
 */
export function drawSvgPathOps(d, o) {
  const rgbOp = (/** @type {any} */ c, /** @type {string} */ name) => op(name, [c.red, c.green, c.blue]);
  const path = svgPathOperators(d);
  const ops = ['q'];
  if (o.gs) ops.push(`/${o.gs} gs`);
  ops.push(op('cm', [1, 0, 0, 1, o.x, o.y]), '1 0 0 1 0 0 cm', '1 0 0 -1 0 0 cm');
  if (o.color) ops.push(rgbOp(o.color, 'rg'));
  if (o.borderColor) ops.push(rgbOp(o.borderColor, 'RG'));
  if (o.borderWidth) ops.push(op('w', [o.borderWidth]));
  if (o.borderLineCap) ops.push(op('J', [o.borderLineCap]));
  ops.push(`[${(o.borderDashArray ?? []).map(pdfNum).join(' ')}] 0 d`);
  for (const x of path) ops.push(x);
  ops.push(o.color && o.borderWidth ? 'B' : o.color ? 'f' : o.borderColor ? 'S' : 'h');
  ops.push('Q');
  return ops.join('\n') + '\n';
}
