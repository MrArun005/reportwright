'use client';
import { useState } from 'react';
import { useDesigner, findItem, updateItem, deleteSelection, duplicateSelection, SECTIONS, walk, tableParts, rowsOf,
  tableInsertColumn, tableDeleteColumn, tableInsertRow, tableDeleteRow, tableSetColumnWidth, tableMergeRight, tableSplit, tableSync, tableAddGroup, tableRemoveGroup, round } from './store.js';
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
    case 'action': return <ActionEditor value={value} onChange={onChange} openExpr={openExpr} dataSet={dataSet} />;
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
    let taken = false; walk(def, (i) => { if (i.id !== item.id && i.name === v) taken = true; });
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
        <div className="hint">In the {SECTIONS.find(s => s.key === section).label.toLowerCase()}{findItem(def, item.id)?.parent ? `, inside ${findItem(def, item.id).parent.name}` : ''}.</div>
      </div>
      {groupBy(spec?.props || []).map(([cat, ps]) => (
        <div className="cat" key={cat}>
          <h5>{cat}</h5>
          {ps.map(p => <PropEditor key={p.key} p={p} value={item[p.key]} onChange={v => set(p.key, v)} openExpr={openExpr} dataSet={dataSet} />)}
        </div>
      ))}
      {item.type === 'table' && <TableProps table={item} openExpr={openExpr} />}
      {item.type === 'list' && <SortFilterEditor item={item} />}
      {(item.type === 'list' || item.type === 'container') && <div className="cat"><span className="hint">Drag tools and fields into the {item.type}. Items inside a list repeat for each record{item.groupBy ? ' (one row per group)' : ''}. A table inside a list can filter with =Parent.field.</span></div>}
      <StyleCats props={stylePropsFor(item.type)} style={item.style} onSet={setStyle} openExpr={openExpr} dataSet={dataSet} />
      <div className="cat"><div className="btnrow">
        <button className="btn sm" onClick={duplicateSelection}>Duplicate <span className="kbd">⌘D</span></button>
        <button className="btn sm danger" onClick={deleteSelection}>Delete <span className="kbd">Del</span></button>
      </div></div>
    </>
  );
}

function TableProps({ table, openExpr }) {
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
        {tableParts(table).map(({ part, label }) => (
          <div key={part} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{label} rows: <b>{(rowsOf(table, part) || []).length}</b></span>
            <button className="btn sm" onClick={() => tableInsertRow(table.id, part, (rowsOf(table, part) || []).length)}>Add</button>
          </div>
        ))}
        <div className="hint">Click a cell to edit its value and style.</div>
      </div>
      <GroupsEditor table={table} openExpr={openExpr} />
      <SortFilterEditor item={table} />
    </>
  );
}

function fieldsOf(def, dsName) { return (def.dataSets?.find(d => d.name === dsName)?.fields || []); }

function GroupsEditor({ table, openExpr }) {
  const def = useDesigner(s => s.def);
  const fields = fieldsOf(def, table.dataSet);
  const [pick, setPick] = useState('');
  const setG = (i, k, v) => updateItem(table.id, t => { if (v === undefined || v === '' || v === false) delete t.groups[i][k]; else t.groups[i][k] = v; }, `${table.id}.g${i}.${k}`);
  const numericCols = () => (table.detail?.[0]?.cells || []).map((c, ci) => [ci, /^=Fields\.(\w+)$/.exec(c?.value || '')?.[1]]).filter(([, f]) => f && fields.find(x => x.name === f)?.type === 'number');
  return (
    <div className="cat">
      <h5>Groups</h5>
      {(table.groups || []).map((g, i) => (
        <div className="group-card" key={i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><b>{i + 1}. {g.name}</b>
            <button className="btn sm ghost danger" onClick={() => tableRemoveGroup(table.id, i)}>Remove</button></div>
          <div className="grid2">
            <Field label="Name (scope)"><TextInput value={g.name} onChange={v => setG(i, 'name', v.replace(/\W/g, ''))} /></Field>
            <Field label="Sort groups"><Select value={g.sort || ''} options={['asc', 'desc']} allowEmpty onChange={v => setG(i, 'sort', v)} /></Field>
          </div>
          <Field label="Group by"><ExprInput value={g.expr} onChange={v => setG(i, 'expr', v)} onOpen={() => openExpr({ value: g.expr, dataSet: table.dataSet, onSave: v => setG(i, 'expr', v), title: 'Group by' })} /></Field>
          <Field label="Page break"><Select value={g.pageBreak || ''} options={[{ value: 'between', label: 'Between groups' }, { value: 'after', label: 'After each group' }]} allowEmpty onChange={v => setG(i, 'pageBreak', v)} /></Field>
          <Check label="Keep the group on one page" checked={g.keepTogether} onChange={v => setG(i, 'keepTogether', v)} />
          <Check label="Drill-down: show a toggle" checked={g.collapsible} onChange={v => setG(i, 'collapsible', v)} />
          {g.collapsible && <Check label="Start collapsed" checked={g.initiallyCollapsed} onChange={v => setG(i, 'initiallyCollapsed', v)} />}
        </div>
      ))}
      <div className="expr-row">
        <Select value={pick} options={fields.map(f => f.name)} allowEmpty onChange={v => setPick(v || '')} aria-label="Field to group by" />
        <button className="btn sm" disabled={!pick} onClick={() => { tableAddGroup(table.id, pick, numericCols()); setPick(''); }}>Add group</button>
      </div>
      <div className="hint">Use the group name as a scope: Sum(Fields.amount, "{(table.groups || [])[0]?.name || 'Region'}").</div>
    </div>
  );
}

const OPS = ['=', '<>', '>', '>=', '<', '<=', 'in', 'like', 'contains'];
function SortFilterEditor({ item }) {
  const def = useDesigner(s => s.def);
  const fields = fieldsOf(def, item.dataSet).map(f => f.name);
  const set = (fn) => updateItem(item.id, fn, `${item.id}.sf`);
  const sort = item.sort?.[0];
  return (
    <div className="cat">
      <h5>Sort and filter (this item only)</h5>
      <div className="grid2">
        <Field label="Sort by"><Select value={sort?.by?.replace(/^=Fields\./, '') || ''} options={fields} allowEmpty onChange={v => set(t => { if (v) t.sort = [{ by: `=Fields.${v}`, dir: sort?.dir || 'asc' }]; else delete t.sort; })} /></Field>
        <Field label="Direction"><Select value={sort?.dir || 'asc'} options={['asc', 'desc']} onChange={v => set(t => { if (t.sort?.[0]) t.sort[0].dir = v; })} /></Field>
      </div>
      {(item.filters || []).map((f, i) => (
        <div className="rowx" key={i}>
          <TextInput mono value={f.expr} onChange={v => set(t => { t.filters[i].expr = v; })} aria-label="Filter expression" />
          <Select value={f.op || '='} options={OPS} onChange={v => set(t => { t.filters[i].op = v; })} />
          <TextInput mono value={f.value} onChange={v => set(t => { t.filters[i].value = v; })} aria-label="Filter value" />
          <button className="btn sm ghost danger" onClick={() => set(t => { t.filters.splice(i, 1); if (!t.filters.length) delete t.filters; })} aria-label="Remove filter">✕</button>
        </div>
      ))}
      <div><button className="btn sm" onClick={() => set(t => { t.filters ||= []; t.filters.push({ expr: fields[0] ? `=Fields.${fields[0]}` : '', op: '=', value: '' }); })}>Add filter</button></div>
      <div className="hint">Value can be text, a number, =Parameters.x, or =Parent.x inside a list.</div>
    </div>
  );
}

function ActionEditor({ value, onChange, openExpr, dataSet }) {
  const a = value || { type: 'none' };
  const set = (patch) => { const n = { ...a, ...patch }; onChange(n.type === 'none' ? undefined : n); };
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <Field label="Action on click"><Select value={a.type} options={[{ value: 'none', label: 'None' }, { value: 'url', label: 'Open a URL' }, { value: 'report', label: 'Open another report (drill-through)' }, { value: 'bookmark', label: 'Jump to a bookmark' }]} onChange={v => set({ type: v || 'none' })} /></Field>
      {a.type === 'url' && <Field label="URL"><ExprInput value={a.url} onChange={v => set({ url: v })} onOpen={() => openExpr({ value: a.url, dataSet, onSave: v => set({ url: v }), title: 'URL' })} /></Field>}
      {a.type === 'bookmark' && <Field label="Bookmark"><ExprInput value={a.target} onChange={v => set({ target: v })} onOpen={() => openExpr({ value: a.target, dataSet, onSave: v => set({ target: v }), title: 'Bookmark' })} /></Field>}
      {a.type === 'report' && <>
        <Field label="Report id"><TextInput value={a.report} onChange={v => set({ report: v })} mono placeholder="loan-statement" /></Field>
        <Field label="Parameters (name=expression, one per line)">
          <textarea className="textarea" rows={3} value={Object.entries(a.params || {}).map(([k, v]) => `${k}=${v}`).join('\n')}
            onChange={e => set({ params: Object.fromEntries(e.target.value.split('\n').map(l => l.split('=')).filter(x => x[0] && x.length > 1).map(([k, ...v]) => [k.trim(), v.join('=').trim()])) })} />
        </Field>
      </>}
    </div>
  );
}

/* ---------------------------------------------------------------- cell */
function CellProps({ table, sel, openExpr }) {
  const row = rowsOf(table, sel.part)?.[sel.row];
  const cell = row?.cells?.[sel.col];
  if (!row || !cell) return <div className="cat"><span className="hint">This cell no longer exists.</span></div>;
  const key = `${table.id}.${sel.part}.${sel.row}.${sel.col}`;
  const setCell = (k, v) => updateItem(table.id, t => setOrDelete(rowsOf(t, sel.part)[sel.row].cells[sel.col], k, v), `${key}.${k}`);
  const setCellStyle = (k, v) => updateItem(table.id, t => { const c = rowsOf(t, sel.part)[sel.row].cells[sel.col]; c.style ||= {}; setOrDelete(c.style, k, v); }, `${key}.s.${k}`);
  const setRow = (k, v) => updateItem(table.id, t => { setOrDelete(rowsOf(t, sel.part)[sel.row], k, v); tableSync(t); }, `${key}.r.${k}`);
  const setRowStyle = (k, v) => updateItem(table.id, t => { const r = rowsOf(t, sel.part)[sel.row]; r.style ||= {}; setOrDelete(r.style, k, v); }, `${key}.rs.${k}`);
  const partLabel = tableParts(table).find(p => p.part === sel.part)?.label || sel.part;
  return (
    <>
      <div className="insp-head"><b>{table.name} · cell</b><span className="ty">{partLabel} row {sel.row + 1}, col {sel.col + 1}</span></div>
      <div className="cat">
        <h5>Data</h5>
        <Field label="Value"><ExprInput value={cell.value} onChange={v => setCell('value', v)} onOpen={() => openExpr({ value: cell.value, dataSet: table.dataSet, onSave: v => setCell('value', v), title: `${table.name} · ${partLabel} cell` })} /></Field>
        <div className="hint">{sel.part === 'detail' ? 'Detail rows repeat once for each record. Fields.x is the current record.' : /^g/.test(sel.part) ? 'Group rows repeat once for each group. Sum(Fields.x) adds up the group.' : 'Aggregates such as Sum(Fields.x) use all the records of the table.'}</div>
      </div>
      <div className="cat">
        <h5>Interactivity</h5>
        {sel.part === 'header' && <Field label="Interactive sort: sort by" hint="Readers click the header to sort."><ExprInput value={cell.sortBy} onChange={v => setCell('sortBy', v || undefined)} onOpen={() => openExpr({ value: cell.sortBy, dataSet: table.dataSet, onSave: v => setCell('sortBy', v || undefined), title: 'Sort by' })} placeholder="=Fields.amount" /></Field>}
        <Field label="Bookmark"><ExprInput value={cell.bookmark} onChange={v => setCell('bookmark', v || undefined)} onOpen={() => openExpr({ value: cell.bookmark, dataSet: table.dataSet, onSave: v => setCell('bookmark', v || undefined), title: 'Bookmark' })} /></Field>
        <ActionEditor value={cell.action} onChange={v => setCell('action', v)} openExpr={openExpr} dataSet={table.dataSet} />
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
