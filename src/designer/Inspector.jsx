'use client';
import { useState } from 'react';
import { useDesigner, findItem, updateItem, deleteSelection, duplicateSelection, SECTIONS, PARTS,
  tableInsertColumn, tableDeleteColumn, tableInsertRow, tableDeleteRow, tableSetColumnWidth, tableMergeRight, tableSplit, tableSync, round } from './store.js';
import { ITEMS, stylePropsFor, TEXT_STYLE_PROPS } from '@/engine/items/index.js';
import { FONT_FAMILIES } from '@/engine/text/fonts.js';
import { PAGE_SIZES, fromPt, toPt } from '@/engine/units.js';
import { TextInput, NumberInput, Select, ColorInput, ExprInput, Field, Check } from './ui.jsx';
import ExpressionEditor from './ExpressionEditor.jsx';

export default function Inspector() {
  const sel = useDesigner(s => s.sel);
  const def = useDesigner(s => s.def);
  const [expr, setExpr] = useState(null); // {value, dataSet, onSave, title}
  const openExpr = (cfg) => setExpr(cfg);

  let body;
  if (sel.kind === 'items' && sel.ids.length > 1) body = <Multi ids={sel.ids} />;
  else if (sel.kind === 'items') {
    const f = findItem(def, sel.ids[0]);
    body = f ? <ItemProps item={f.item} section={f.section} openExpr={openExpr} /> : null;
  } else if (sel.kind === 'cell') {
    const f = findItem(def, sel.id);
    body = f ? <CellProps table={f.item} sel={sel} openExpr={openExpr} /> : null;
  } else if (sel.kind === 'section') body = <SectionProps section={sel.section} />;
  else body = <ReportProps />;

  return (
    <div data-testid="inspector">
      {body}
      {expr && <ExpressionEditor {...expr} onClose={() => setExpr(null)} />}
    </div>
  );
}

/* ---------------------------------------------------------------- shared */
function Geo({ label, value, onChange }) {
  const unit = useDesigner(s => s.unit);
  return (
    <Field label={`${label} (${unit})`}>
      <NumberInput value={round(fromPt(value ?? 0, unit) * 100) / 100} step={unit === 'pt' ? 1 : unit === 'in' ? 0.05 : 0.5} onChange={v => onChange(round(toPt(v, unit)))} />
    </Field>
  );
}

function PropEditor({ p, value, onChange, openExpr, dataSet }) {
  const def = useDesigner(s => s.def);
  switch (p.type) {
    case 'expr': return <Field label={p.label}><ExprInput value={value} onChange={onChange} onOpen={() => openExpr({ value, dataSet, onSave: onChange, title: p.label })} /></Field>;
    case 'number': return <Field label={p.label}><NumberInput value={value} onChange={onChange} /></Field>;
    case 'bool': return <Check label={p.label} checked={value} onChange={onChange} />;
    case 'select': return <Field label={p.label}><Select value={value} onChange={onChange} options={p.options} allowEmpty /></Field>;
    case 'color': return <Field label={p.label}><ColorInput value={value} onChange={onChange} /></Field>;
    case 'font': return <Field label={p.label}><Select value={value} onChange={onChange} options={Object.keys(FONT_FAMILIES)} allowEmpty /></Field>;
    case 'dataset': return <Field label={p.label}><Select value={value} onChange={onChange} options={(def.dataSets || []).map(d => d.name)} allowEmpty /></Field>;
    default: return <Field label={p.label}><TextInput value={value} onChange={v => onChange(v === '' ? undefined : v)} /></Field>;
  }
}

function groupBy(props) {
  const g = new Map();
  for (const p of props) { if (!g.has(p.category)) g.set(p.category, []); g.get(p.category).push(p); }
  return [...g];
}
const setOrDelete = (obj, k, v) => { if (v === undefined || v === '') delete obj[k]; else obj[k] = v; };

function StyleCats({ props, style, onSet, openExpr, dataSet, skipBox }) {
  return groupBy(props.filter(p => !(skipBox && p.category === 'Box'))).map(([cat, ps]) => (
    <div className="cat" key={cat}>
      <h5>{cat}</h5>
      <div className="grid2">
        {ps.map(p => <div key={p.key} style={p.type === 'color' || p.type === 'text' ? { gridColumn: '1 / -1' } : undefined}>
          <PropEditor p={p} value={style?.[p.key]} onChange={v => onSet(p.key, v)} openExpr={openExpr} dataSet={dataSet} />
        </div>)}
      </div>
    </div>
  ));
}

/* ---------------------------------------------------------------- item */
function ItemProps({ item, section, openExpr }) {
  const def = useDesigner(s => s.def);
  const spec = ITEMS[item.type];
  const [nameErr, setNameErr] = useState(null);
  const set = (k, v) => updateItem(item.id, it => setOrDelete(it, k, v), `${item.id}.${k}`);
  const setStyle = (k, v) => updateItem(item.id, it => { it.style ||= {}; setOrDelete(it.style, k, v); }, `${item.id}.style.${k}`);
  const rename = (v) => {
    const taken = SECTIONS.some(s => def.sections[s.key].items.some(i => i.id !== item.id && i.name === v));
    setNameErr(!/^[A-Za-z_][\w]*$/.test(v) ? 'Use letters, digits and _' : taken ? 'This name is in use' : null);
    if (/^[A-Za-z_][\w]*$/.test(v) && !taken) set('name', v);
  };
  const dataSet = item.dataSet;
  return (
    <>
      <div className="insp-head">
        <div style={{ minWidth: 0 }}>
          <TextInput value={item.name} onChange={rename} aria-label="Item name" />
          {nameErr && <div className="err">{nameErr}</div>}
        </div>
        <span className="ty">{spec?.label || item.type}</span>
      </div>
      <div className="cat">
        <h5>Position</h5>
        <div className="grid2">
          <Geo label="X" value={item.x} onChange={v => set('x', v)} />
          <Geo label="Y" value={item.y} onChange={v => set('y', v)} />
          {item.type !== 'table' && <Geo label="Width" value={item.w} onChange={v => set('w', Math.max(0, v))} />}
          {item.type !== 'table' && <Geo label="Height" value={item.h} onChange={v => set('h', Math.max(0, v))} />}
        </div>
        <div className="hint">In the {SECTIONS.find(s => s.key === section).label.toLowerCase()}.</div>
      </div>
      {groupBy(spec?.props || []).map(([cat, ps]) => (
        <div className="cat" key={cat}>
          <h5>{cat}</h5>
          {ps.map(p => <PropEditor key={p.key} p={p} value={item[p.key]} onChange={v => set(p.key, v)} openExpr={openExpr} dataSet={dataSet} />)}
        </div>
      ))}
      {item.type === 'table' && <TableProps table={item} />}
      <StyleCats props={stylePropsFor(item.type)} style={item.style} onSet={setStyle} openExpr={openExpr} dataSet={dataSet} />
      <div className="cat"><div className="btnrow">
        <button className="btn sm" onClick={duplicateSelection}>Duplicate <span className="kbd">⌘D</span></button>
        <button className="btn sm danger" onClick={deleteSelection}>Delete <span className="kbd">Del</span></button>
      </div></div>
    </>
  );
}

function TableProps({ table }) {
  return (
    <>
      <div className="cat">
        <h5>Columns</h5>
        <div className="grid4">
          {table.columns.map((c, i) => (
            <Field key={i} label={`#${i + 1}`}><NumberInput value={c.width} step={1} onChange={v => tableSetColumnWidth(table.id, i, v, `${table.id}.col${i}`)} /></Field>
          ))}
        </div>
        <div className="btnrow">
          <button className="btn sm" onClick={() => tableInsertColumn(table.id, table.columns.length)}>Add column</button>
        </div>
        <div className="hint">Total width {round(table.columns.reduce((s, c) => s + c.width, 0))} pt. Drag a column edge on the canvas to resize.</div>
      </div>
      <div className="cat">
        <h5>Rows</h5>
        {PARTS.map(p => (
          <div key={p} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{p[0].toUpperCase() + p.slice(1)} rows: <b>{(table[p] || []).length}</b></span>
            <button className="btn sm" onClick={() => tableInsertRow(table.id, p, (table[p] || []).length)}>Add</button>
          </div>
        ))}
        <div className="hint">Click a cell to edit its value and style.</div>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- cell */
function CellProps({ table, sel, openExpr }) {
  const row = table[sel.part]?.[sel.row];
  const cell = row?.cells?.[sel.col];
  if (!row || !cell) return <div className="cat"><span className="hint">This cell no longer exists.</span></div>;
  const key = `${table.id}.${sel.part}.${sel.row}.${sel.col}`;
  const setCell = (k, v) => updateItem(table.id, t => setOrDelete(t[sel.part][sel.row].cells[sel.col], k, v), `${key}.${k}`);
  const setCellStyle = (k, v) => updateItem(table.id, t => { const c = t[sel.part][sel.row].cells[sel.col]; c.style ||= {}; setOrDelete(c.style, k, v); }, `${key}.s.${k}`);
  const setRow = (k, v) => updateItem(table.id, t => { setOrDelete(t[sel.part][sel.row], k, v); tableSync(t); }, `${key}.r.${k}`);
  const setRowStyle = (k, v) => updateItem(table.id, t => { const r = t[sel.part][sel.row]; r.style ||= {}; setOrDelete(r.style, k, v); }, `${key}.rs.${k}`);
  const partLabel = { header: 'Header', detail: 'Detail', footer: 'Footer' }[sel.part];
  return (
    <>
      <div className="insp-head"><b>{table.name} · cell</b><span className="ty">{partLabel} row {sel.row + 1}, col {sel.col + 1}</span></div>
      <div className="cat">
        <h5>Data</h5>
        <Field label="Value"><ExprInput value={cell.value} onChange={v => setCell('value', v)} onOpen={() => openExpr({ value: cell.value, dataSet: table.dataSet, onSave: v => setCell('value', v), title: `${table.name} · ${partLabel} cell` })} /></Field>
        <div className="hint">{sel.part === 'detail' ? 'Detail rows repeat once for each record. Fields.x is the current record.' : 'Aggregates such as Sum(Fields.x) use all the records of the table.'}</div>
      </div>
      <div className="cat">
        <h5>Structure</h5>
        <div className="btnrow">
          <button className="btn sm" onClick={() => tableInsertColumn(table.id, sel.col)}>Column left</button>
          <button className="btn sm" onClick={() => tableInsertColumn(table.id, sel.col + (cell.colSpan || 1))}>Column right</button>
          <button className="btn sm danger" onClick={() => { tableDeleteColumn(table.id, sel.col); useDesigner.getState().select({ kind: 'items', ids: [table.id] }); }}>Delete column</button>
        </div>
        <div className="btnrow">
          <button className="btn sm" onClick={() => tableInsertRow(table.id, sel.part, sel.row)}>Row above</button>
          <button className="btn sm" onClick={() => tableInsertRow(table.id, sel.part, sel.row + 1)}>Row below</button>
          <button className="btn sm danger" onClick={() => { tableDeleteRow(table.id, sel.part, sel.row); useDesigner.getState().select({ kind: 'items', ids: [table.id] }); }}>Delete row</button>
        </div>
        <div className="btnrow">
          <button className="btn sm" onClick={() => tableMergeRight(table.id, sel.part, sel.row, sel.col)}>Merge right</button>
          <button className="btn sm" disabled={!(cell.colSpan > 1)} onClick={() => tableSplit(table.id, sel.part, sel.row, sel.col)}>Split</button>
        </div>
      </div>
      <div className="cat">
        <h5>Row</h5>
        <div className="grid2">
          <Field label="Height (pt)"><NumberInput value={row.height || 18} step={1} onChange={v => setRow('height', Math.max(6, v))} /></Field>
          <div style={{ gridColumn: '1 / -1' }}><PropEditor p={{ key: 'backgroundColor', label: 'Row background (color or =expression)', type: 'color' }} value={row.style?.backgroundColor} onChange={v => setRowStyle('backgroundColor', v)} openExpr={openExpr} /></div>
        </div>
      </div>
      <StyleCats props={TEXT_STYLE_PROPS} style={cell.style} onSet={setCellStyle} openExpr={openExpr} dataSet={table.dataSet} />
    </>
  );
}

/* ---------------------------------------------------------------- multi */
function Multi({ ids }) {
  const def = useDesigner(s => s.def);
  const items = ids.map(id => findItem(def, id)?.item).filter(Boolean);
  const align = (fn) => useDesigner.getState().apply(d => { const its = ids.map(id => findItem(d, id)?.item).filter(Boolean); fn(its); });
  return (
    <>
      <div className="insp-head"><b>{items.length} items</b></div>
      <div className="cat">
        <h5>Align</h5>
        <div className="btnrow">
          <button className="btn sm" onClick={() => align(its => { const v = Math.min(...its.map(i => i.x)); its.forEach(i => { i.x = v; }); })}>Left</button>
          <button className="btn sm" onClick={() => align(its => { const v = Math.max(...its.map(i => i.x + i.w)); its.forEach(i => { i.x = round(v - i.w); }); })}>Right</button>
          <button className="btn sm" onClick={() => align(its => { const v = Math.min(...its.map(i => i.y)); its.forEach(i => { i.y = v; }); })}>Top</button>
          <button className="btn sm" onClick={() => align(its => { const w = Math.max(...its.map(i => i.w)); its.forEach(i => { if (i.type !== 'table') i.w = w; }); })}>Same width</button>
        </div>
      </div>
      <div className="cat"><div className="btnrow">
        <button className="btn sm" onClick={duplicateSelection}>Duplicate</button>
        <button className="btn sm danger" onClick={deleteSelection}>Delete</button>
      </div></div>
    </>
  );
}

/* ---------------------------------------------------------------- section */
function SectionProps({ section }) {
  const sec = useDesigner(s => s.def.sections[section]);
  const label = SECTIONS.find(s => s.key === section).label;
  const set = (k, v) => useDesigner.getState().apply(d => setOrDelete(d.sections[section], k, v), `sec.${section}.${k}`);
  const minH = Math.max(0, ...sec.items.map(i => i.y + i.h));
  return (
    <>
      <div className="insp-head"><b>{label}</b><span className="ty">section</span></div>
      <div className="cat">
        <Field label="Height (pt)" hint={section === 'body' ? 'Design height only. The body grows with its data at run time.' : 'Fixed on every page. Use 0 to remove the band.'}>
          <NumberInput value={sec.height || 0} step={1} onChange={v => set('height', Math.max(minH, v))} />
        </Field>
        {section !== 'body' && <>
          <Check label="Print on the first page" checked={sec.printOnFirstPage !== false} onChange={v => set('printOnFirstPage', v ? undefined : false)} />
          <Check label="Print on the last page" checked={sec.printOnLastPage !== false} onChange={v => set('printOnLastPage', v ? undefined : false)} />
        </>}
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- report */
function ReportProps() {
  const def = useDesigner(s => s.def);
  const set = (fn, key) => useDesigner.getState().apply(fn, key);
  const m = Array.isArray(def.page?.margins) ? def.page.margins : [36, 36, 36, 36];
  const base = def.styles?.base || {};
  return (
    <>
      <div className="insp-head"><b>Report</b><span className="ty">{def.$schema}</span></div>
      <div className="cat">
        <h5>Page</h5>
        <div className="grid2">
          <Field label="Size"><Select value={def.page?.size || 'A4'} options={Object.keys(PAGE_SIZES)} onChange={v => set(d => { d.page.size = v; })} /></Field>
          <Field label="Orientation"><Select value={def.page?.orientation || 'portrait'} options={['portrait', 'landscape']} onChange={v => set(d => { d.page.orientation = v; })} /></Field>
        </div>
        <div className="grid4">
          {['Top', 'Right', 'Bottom', 'Left'].map((l, i) => (
            <Field key={l} label={l}><NumberInput value={m[i]} step={1} onChange={v => set(d => { const mm = Array.isArray(d.page.margins) ? d.page.margins : [36, 36, 36, 36]; mm[i] = Math.max(0, v); d.page.margins = mm; }, `margin${i}`)} /></Field>
          ))}
        </div>
        <div className="hint">Margins in points. Changing the page width does not move items.</div>
      </div>
      <div className="cat">
        <h5>Regional</h5>
        <div className="grid2">
          <Field label="Locale"><TextInput value={def.locale} onChange={v => set(d => { d.locale = v || undefined; }, 'locale')} placeholder="en-IN" /></Field>
          <Field label="Currency"><TextInput value={def.currency} onChange={v => set(d => { d.currency = v.toUpperCase() || undefined; }, 'currency')} placeholder="INR" /></Field>
        </div>
      </div>
      <div className="cat">
        <h5>Default text</h5>
        <div className="grid2">
          <Field label="Font"><Select value={base.fontFamily} options={Object.keys(FONT_FAMILIES)} onChange={v => set(d => { d.styles ||= {}; d.styles.base ||= {}; d.styles.base.fontFamily = v; })} /></Field>
          <Field label="Size"><NumberInput value={base.fontSize ?? 9} onChange={v => set(d => { d.styles ||= {}; d.styles.base ||= {}; d.styles.base.fontSize = v; }, 'basesize')} /></Field>
          <div style={{ gridColumn: '1 / -1' }}><Field label="Color"><ColorInput value={base.color} onChange={v => set(d => { d.styles ||= {}; d.styles.base ||= {}; setOrDelete(d.styles.base, 'color', v); }, 'basecolor')} /></Field></div>
        </div>
      </div>
      <div className="cat"><span className="hint">Select an item, a cell or a band to edit it. Drag tools and fields from the left onto the page.</span></div>
    </>
  );
}
