'use client';
import { useState } from 'react';
import { useDesigner, findItem, updateItem, deleteSelection, duplicateSelection, SECTIONS, walk, tableParts, rowsOf,
  tableInsertColumn, tableDeleteColumn, tableInsertRow, tableDeleteRow, tableSetColumnWidth, tableMergeRight, tableSplit, tableSync, tableAddGroup, tableRemoveGroup, round } from './store.js';
import { ITEMS, stylePropsFor, TEXT_STYLE_PROPS } from '@/engine/items/index.js';
import { useFontFamilies, FontsDialog } from './Fonts.jsx';
import { PAGE_SIZES, fromPt, toPt } from '@/engine/units.js';
import { TextInput, NumberInput, Select, ColorInput, ExprInput, Field, Check } from './ui.jsx';
import ExpressionEditor from './ExpressionEditor.jsx';
import { checkFunctions } from '@/engine/expr/evaluate.js';

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
  const families = useFontFamilies();
  switch (p.type) {
    case 'expr': return <Field label={p.label}><ExprInput value={value} onChange={onChange} onOpen={() => openExpr({ value, dataSet, onSave: onChange, title: p.label })} /></Field>;
    case 'html': return <Field label={p.label}><textarea className="input mono" rows={7} spellCheck={false} data-testid={`prop-${p.key}`} style={{ width: '100%', resize: 'vertical', fontSize: 11 }} value={value ?? ''} onChange={e => onChange(e.target.value === '' ? undefined : e.target.value)} /></Field>;
    case 'number': return <Field label={p.label}><NumberInput value={value} onChange={onChange} /></Field>;
    case 'bool': return <Check label={p.label} checked={value} onChange={onChange} />;
    case 'select': return <Field label={p.label}><Select value={value} onChange={onChange} options={p.options} allowEmpty /></Field>;
    case 'color': return <Field label={p.label}><ColorInput value={value} onChange={onChange} /></Field>;
    case 'font': return <Field label={p.label}><Select value={value} onChange={onChange} options={families} allowEmpty /></Field>;
    case 'dataset': return <Field label={p.label}><Select value={value} onChange={onChange} options={(def.dataSets || []).map(d => d.name)} allowEmpty /></Field>;
    case 'action': return <ActionEditor value={value} onChange={onChange} openExpr={openExpr} dataSet={dataSet} />;
    case 'stylename': return <Field label={p.label}><Select value={value} onChange={onChange} options={Object.keys(def.styles?.named || {})} allowEmpty /></Field>;
    case 'series': return <SeriesEditor value={value} onChange={onChange} openExpr={openExpr} dataSet={dataSet} />;
    case 'params': return <ParamsEditor label={p.label} value={value} onChange={onChange} />;
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
      {item.type === 'chart' && (
        <div className="cat">
          <button className="btn sm" data-testid="open-chart-gallery" onClick={() => useDesigner.getState().setUi({ wizard: { mode: 'edit', id: item.id } })}>Chart gallery and data preview…</button>
          <span className="hint">See every chart type drawn with your API data, then pick one.</span>
        </div>
      )}
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
          <Field label="Sort groups by (empty: the group value)"><ExprInput value={g.sortBy || ''} onChange={v => setG(i, 'sortBy', v)} onOpen={() => openExpr({ value: g.sortBy || '', dataSet: table.dataSet, onSave: v => setG(i, 'sortBy', v), title: 'Sort groups by, e.g. =Sum(Fields.amount)' })} /></Field>
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

function SeriesEditor({ value, onChange, openExpr, dataSet }) {
  const list = value || [];
  const set = (i, k, v) => onChange(list.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <span className="hint">Series: one value per category, usually an aggregate such as =Sum(Fields.amount).</span>
      {list.map((sr, i) => (
        <div className="group-card" key={i}>
          <div className="expr-row">
            <TextInput value={sr.name} onChange={v => set(i, 'name', v)} aria-label="Series name" placeholder="Name" />
            <input type="color" value={/^#[0-9a-f]{6}$/i.test(sr.color || '') ? sr.color : '#2563eb'} onChange={e => set(i, 'color', e.target.value)} aria-label="Series color" style={{ width: 26, height: 26, border: '1px solid var(--line)', borderRadius: 5, padding: 0 }} />
            <button className="btn sm ghost danger" onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label="Remove series">✕</button>
          </div>
          <ExprInput value={sr.value} onChange={v => set(i, 'value', v)} onOpen={() => openExpr({ value: sr.value, dataSet, onSave: v => set(i, 'value', v), title: `Series ${sr.name || i + 1}` })} placeholder="=Sum(Fields.amount)" />
        </div>
      ))}
      <div><button className="btn sm" onClick={() => onChange([...list, { name: `Series ${list.length + 1}`, value: '' }])}>Add series</button></div>
    </div>
  );
}

function ParamsEditor({ label, value, onChange }) {
  return (
    <Field label={`${label} (name=expression, one per line)`}>
      <textarea className="textarea" rows={3} value={Object.entries(value || {}).map(([k, v]) => `${k}=${v}`).join('\n')}
        onChange={e => onChange(Object.fromEntries(e.target.value.split('\n').map(l => l.split('=')).filter(x => x[0] && x.length > 1).map(([k, ...v]) => [k.trim(), v.join('=').trim()])))} />
    </Field>
  );
}

function VisualEditor({ cell, setCell, openExpr, dataSet }) {
  const v = cell.visual || null;
  const set = (patch) => { const n = { ...(v || {}), ...patch }; setCell('visual', n.type ? n : undefined); };
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <Field label="Cell shows"><Select value={v?.type || ''} options={[{ value: 'sparkline', label: 'Sparkline' }, { value: 'databar', label: 'Data bar' }, { value: 'bullet', label: 'Bullet' }]} allowEmpty onChange={t => (t ? set({ type: t }) : setCell('visual', undefined))} /></Field>
      {v?.type === 'sparkline' && <Field label="One point per"><ExprInput value={v.category} onChange={x => set({ category: x || undefined })} onOpen={() => openExpr({ value: v.category, dataSet, onSave: x => set({ category: x }), title: 'Point per' })} placeholder="=Fields.month" /></Field>}
      {v?.type && <Field label="Value"><ExprInput value={v.value} onChange={x => set({ value: x })} onOpen={() => openExpr({ value: v.value, dataSet, onSave: x => set({ value: x }), title: 'Value' })} placeholder="=Sum(Fields.amount)" /></Field>}
      {(v?.type === 'databar' || v?.type === 'bullet') && <Field label="Maximum"><ExprInput value={v.max} onChange={x => set({ max: x })} onOpen={() => openExpr({ value: v.max, dataSet, onSave: x => set({ max: x }), title: 'Maximum' })} placeholder='=Max(Fields.amount, "Table1")' /></Field>}
      {v?.type === 'bullet' && <Field label="Target"><ExprInput value={v.target} onChange={x => set({ target: x })} onOpen={() => {}} /></Field>}
      {v?.type && <Field label="Color (or =expression)"><ColorInput value={v.color} onChange={x => set({ color: x })} /></Field>}
    </div>
  );
}

function ActionEditor({ value, onChange, openExpr, dataSet }) {
  const a = value || { type: 'none' };
  const set = (patch) => { const n = { ...a, ...patch }; onChange(n.type === 'none' ? undefined : n); };
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <Field label="Action on click"><Select value={a.type} options={[{ value: 'none', label: 'None' }, { value: 'url', label: 'Open a URL' }, { value: 'report', label: 'Open another report (drill-through)' }, { value: 'params', label: 'Filter this report (set parameters)' }, { value: 'bookmark', label: 'Jump to a bookmark' }]} onChange={v => set({ type: v || 'none' })} /></Field>
      {a.type === 'url' && <Field label="URL"><ExprInput value={a.url} onChange={v => set({ url: v })} onOpen={() => openExpr({ value: a.url, dataSet, onSave: v => set({ url: v }), title: 'URL' })} /></Field>}
      {a.type === 'bookmark' && <Field label="Bookmark"><ExprInput value={a.target} onChange={v => set({ target: v })} onOpen={() => openExpr({ value: a.target, dataSet, onSave: v => set({ target: v }), title: 'Bookmark' })} /></Field>}
      {a.type === 'params' && <>
        <Field label="Set parameters (name=expression, one per line)" hint="Example: categories==Fields.category (after the first =, an expression starts with =). The report runs again with the new values.">
          <textarea className="textarea" rows={3} value={Object.entries(a.params || {}).map(([k, v]) => `${k}=${v}`).join('\n')}
            onChange={e => set({ params: Object.fromEntries(e.target.value.split('\n').map(l => l.split('=')).filter(x => x[0] && x.length > 1).map(([k, ...v]) => [k.trim(), v.join('=').trim()])) })} />
        </Field>
        <Check label="A second click on the same value clears the filter" checked={a.toggle !== false} onChange={v => set({ toggle: v ? undefined : false })} />
      </>}
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
        <h5>Visual</h5>
        <VisualEditor cell={cell} setCell={setCell} openExpr={openExpr} dataSet={table.dataSet} />
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
      <div className="cat"><PropEditor p={{ key: 'styleName', label: 'Named style', type: 'stylename' }} value={cell.styleName} onChange={v => setCell('styleName', v)} openExpr={openExpr} /></div>
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
          <button className="btn sm" onClick={() => align(its => { const v = Math.max(...its.map(i => i.y + i.h)); its.forEach(i => { i.y = round(v - i.h); }); })}>Bottom</button>
          <button className="btn sm" onClick={() => align(its => { const l = Math.min(...its.map(i => i.x)), r = Math.max(...its.map(i => i.x + i.w)); its.forEach(i => { i.x = round((l + r) / 2 - i.w / 2); }); })}>Centre</button>
          <button className="btn sm" onClick={() => align(its => { const w = Math.max(...its.map(i => i.w)); its.forEach(i => { if (i.type !== 'table') i.w = w; }); })}>Same width</button>
          <button className="btn sm" onClick={() => align(its => { const h = Math.max(...its.map(i => i.h)); its.forEach(i => { if (i.type !== 'table') i.h = h; }); })}>Same height</button>
        </div>
      </div>
      <div className="cat">
        <h5>Distribute</h5>
        <div className="btnrow">
          <button className="btn sm" disabled={items.length < 3} onClick={() => align(its => { const s2 = [...its].sort((a, b) => a.x - b.x); const total = s2[s2.length - 1].x + s2[s2.length - 1].w - s2[0].x; const gap = (total - s2.reduce((a, i) => a + i.w, 0)) / (s2.length - 1); let x = s2[0].x; s2.forEach(i => { i.x = round(x); x += i.w + gap; }); })}>Horizontally</button>
          <button className="btn sm" disabled={items.length < 3} onClick={() => align(its => { const s2 = [...its].sort((a, b) => a.y - b.y); const total = s2[s2.length - 1].y + s2[s2.length - 1].h - s2[0].y; const gap = (total - s2.reduce((a, i) => a + i.h, 0)) / (s2.length - 1); let y = s2[0].y; s2.forEach(i => { i.y = round(y); y += i.h + gap; }); })}>Vertically</button>
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
        {section === 'body' && <div className="grid2">
          <Field label="Columns" hint="Newspaper columns: the body fills each column, then the next."><NumberInput value={sec.columns?.count || 1} step={1} min={1} onChange={v => useDesigner.getState().apply(d => { const n = Math.max(1, Math.min(6, Math.round(v))); if (n === 1) delete d.sections.body.columns; else d.sections.body.columns = { gap: d.sections.body.columns?.gap ?? 18, count: n }; })} /></Field>
          {sec.columns?.count > 1 && <Field label="Gap (pt)"><NumberInput value={sec.columns.gap ?? 18} step={1} onChange={v => useDesigner.getState().apply(d => { d.sections.body.columns.gap = Math.max(0, v); }, 'colgap')} /></Field>}
        </div>}
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
  const families = useFontFamilies();
  const [fontsOpen, setFontsOpen] = useState(false);
  const set = (fn, key) => useDesigner.getState().apply(fn, key);
  const m = Array.isArray(def.page?.margins) ? def.page.margins : [36, 36, 36, 36];
  const base = def.styles?.base || {};
  return (
    <>
      <div className="insp-head"><b>Report</b><span className="ty">{def.$schema}</span></div>
      <div className="cat">
        <h5>Page</h5>
        <div className="grid2">
          <Field label="Size"><Select value={def.page?.size || 'A4'} options={[...Object.keys(PAGE_SIZES), 'Pageless']} onChange={v => set(d => { d.page.size = v; })} /></Field>
          {def.page?.size === 'Pageless'
            ? <Field label="Width"><NumberInput value={def.page?.width || 960} step={8} onChange={v => set(d => { d.page.width = Math.max(144, v); }, 'pageWidth')} /></Field>
            : <Field label="Orientation"><Select value={def.page?.orientation || 'portrait'} options={['portrait', 'landscape']} onChange={v => set(d => { d.page.orientation = v; })} /></Field>}
        </div>
        {def.page?.size === 'Pageless' && <div className="hint">One page that grows to fit the content (up to 200 inches). Good for dashboards and screen reports.</div>}
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
          <Field label="Font"><Select value={base.fontFamily} options={families} onChange={v => set(d => { d.styles ||= {}; d.styles.base ||= {}; d.styles.base.fontFamily = v; })} /></Field>
          <Field label="Size"><NumberInput value={base.fontSize ?? 9} onChange={v => set(d => { d.styles ||= {}; d.styles.base ||= {}; d.styles.base.fontSize = v; }, 'basesize')} /></Field>
          <div style={{ gridColumn: '1 / -1' }}><Field label="Color"><ColorInput value={base.color} onChange={v => set(d => { d.styles ||= {}; d.styles.base ||= {}; setOrDelete(d.styles.base, 'color', v); }, 'basecolor')} /></Field></div>
        </div>
        <div className="btnrow"><button className="btn sm" onClick={() => setFontsOpen(true)}>Upload a font…</button></div>
        {fontsOpen && <FontsDialog onClose={() => setFontsOpen(false)} />}
      </div>
      <ReportFunctions />
      <NamedStyles />
      <div className="cat"><span className="hint">Select an item, a cell or a band to edit it. Drag tools and fields from the left onto the page.</span></div>
    </>
  );
}

/** Report functions: reusable formulas in the expression language, called as Code.Name(…) or Name(…). */
function ReportFunctions() {
  const fns = useDesigner(s => s.def.functions) || [];
  const set = (fn, key) => useDesigner.getState().apply(d => { d.functions ||= []; fn(d.functions); if (!d.functions.length) delete d.functions; }, key);
  const errors = checkFunctions(fns);
  return (
    <div className="cat">
      <h5>Functions</h5>
      {fns.map((f, i) => (
        <div key={i} style={{ display: 'grid', gap: 4, marginBottom: 8 }}>
          <div className="grid2">
            <Field label="Name"><TextInput value={f.name} mono onChange={v => set(l => { l[i].name = v; }, `fn${i}.name`)} placeholder="Tax" /></Field>
            <Field label="Parameters"><TextInput value={(f.params || []).join(', ')} mono onChange={v => set(l => { l[i].params = v.split(',').map(x => x.trim()).filter(Boolean); }, `fn${i}.params`)} placeholder="amount, rate" /></Field>
          </div>
          <Field label="Body"><TextInput value={f.body} mono onChange={v => set(l => { l[i].body = v; }, `fn${i}.body`)} placeholder="=amount * 0.18" /></Field>
          <div className="btnrow"><button className="btn sm" type="button" onClick={() => set(l => { l.splice(i, 1); })}>Remove</button></div>
        </div>
      ))}
      {errors.map((e, i) => <div key={i} className="err">{e}</div>)}
      <div className="btnrow"><button className="btn sm" type="button" onClick={() => set(l => { l.push({ name: `Function${l.length + 1}`, params: ['x'], body: '=x' }); })}>Add a function</button></div>
      <span className="hint">Call one as Code.Name(…) or Name(…) in any expression. Parameters are names inside the body.</span>
    </div>
  );
}

const THEMES = {
  Slate: { accent: '#334155', base: { fontFamily: 'Inter', fontSize: 9, color: '#1e293b' } },
  Teal: { accent: '#0f766e', base: { fontFamily: 'Inter', fontSize: 9, color: '#134e4a' } },
  Indigo: { accent: '#4338ca', base: { fontFamily: 'Inter', fontSize: 9, color: '#1e1b4b' } },
  Mono: { accent: '#111827', base: { fontFamily: 'JetBrains Mono', fontSize: 8.5, color: '#111827' } },
};
function themeStyles(t) {
  const a = t.accent;
  return {
    base: t.base,
    named: {
      Title: { fontSize: 18, fontWeight: 'bold', color: a },
      Heading: { fontSize: 12, fontWeight: 'bold', color: a },
      Label: { fontSize: 8, color: '#6b7280' },
      Value: { fontWeight: '600' },
      TableHeader: { fontWeight: 'bold', color: '#ffffff', backgroundColor: a },
      Total: { fontWeight: 'bold', borderTop: `1 solid ${a}` },
      Muted: { fontSize: 7.5, color: '#6b7280' },
    },
  };
}

function NamedStyles() {
  const def = useDesigner(s => s.def);
  const named = def.styles?.named || {};
  const [newName, setNewName] = useState('');
  const setS = (name, k, v) => useDesigner.getState().apply(d => { d.styles ||= {}; d.styles.named ||= {}; d.styles.named[name] ||= {}; if (v === undefined || v === '') delete d.styles.named[name][k]; else d.styles.named[name][k] = v; }, `ns.${name}.${k}`);
  return (
    <div className="cat">
      <h5>Named styles and themes</h5>
      <Field label="Apply a theme (replaces the default text and named styles)">
        <Select value="" allowEmpty options={Object.keys(THEMES)} onChange={v => { if (v) useDesigner.getState().apply(d => { d.styles = themeStyles(THEMES[v]); }); }} />
      </Field>
      {Object.entries(named).map(([name, st]) => (
        <div className="style-card" key={name}>
          <b style={{ fontSize: 'var(--fs-sm)' }}>{name}</b>
          <NumberInput value={st.fontSize} step={0.5} onChange={v => setS(name, 'fontSize', v)} aria-label={`${name} size`} />
          <Select value={st.fontWeight} options={['normal', '600', 'bold']} allowEmpty onChange={v => setS(name, 'fontWeight', v)} />
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(st.color || '') ? st.color : '#000000'} onChange={e => setS(name, 'color', e.target.value)} aria-label={`${name} colour`} style={{ width: 26, height: 26, border: '1px solid var(--line)', borderRadius: 5, padding: 0 }} />
        </div>
      ))}
      <div className="expr-row">
        <TextInput value={newName} onChange={v => setNewName(v.replace(/\W/g, ''))} placeholder="New style name" aria-label="New style name" />
        <button className="btn sm" disabled={!newName || named[newName]} onClick={() => { setS(newName, 'fontSize', 9); setNewName(''); }}>Add</button>
      </div>
      <div className="hint">Items and cells pick a named style in their Text section. Their own style still wins.</div>
    </div>
  );
}
