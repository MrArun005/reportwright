'use client';
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { allNames, cloneWithIds, isContentKey, setMatrixShow } from './store.js';
import { useDesigner, findItem, updateItem, deleteSelection, duplicateSelection, sectionList, secOf, isBodyKey, addBodySection, removeBodySection, walk, tableParts, rowsOf, selCells,
  tableInsertColumn, tableDeleteColumn, tableInsertRow, tableDeleteRow, tableSetColumnWidth, tableMergeRight, tableSplit, tableMergeDown, tableSplitRows, tableSync, tableAddGroup, tableRemoveGroup, round, growToFit, uploadImages } from './store.js';
import { normalizeMatrix, isTablix } from '@/engine/items/pivot.js';
import { formatFor } from './tableGen.js';
import { t } from '@/i18n/index.js';
import { ITEMS, stylePropsFor, TEXT_STYLE_PROPS } from '@/engine/items/index.js';
import { useFontFamilies, FontsDialog } from './Fonts.jsx';
import { PAGE_SIZES, fromPt, toPt } from '@/engine/units.js';
import { TextInput, NumberInput, Select, ColorInput, ExprInput, Field, Check, FieldScope } from './ui.jsx';
import ExpressionEditor from './ExpressionEditor.jsx';
import CondFormat from './CondFormat.jsx';
import { applyCf, customProps, cfExpressions, pointAverage } from './cfRules.js';
import { checkFunctions, isDynamic } from '@/engine/expr/evaluate.js';
import { PALETTES } from '@/engine/items/chart-kit.js';
import { ReuseSection, ThemeSection, LayerField, PartInstance, PartValues, PublishPart, useStyleNames } from './Reuse.jsx';
import CatHead from './CatHead.jsx';
import { setExport } from './htmlExportProps.js';
import HX from '@/i18n/hx-admin.js';

/** The designer's UI language (set by the Designer) as a translate function. */
function useT() { const lang = useDesigner(s => s.lang); return (k, v) => t(lang, k, v); }
/** Like useT, with a fallback for keys no table has (a property label or option added without a translation yet). */
function useTk() { const lang = useDesigner(s => s.lang); return (k, fb) => { const s = t(lang, k); return s === k ? fb : s; }; }
/**
 * A property's label in the UI language: its labelKey, else p_<itemType>_<key> (a label special to one item type),
 * else p_<key>, else the English label in the item spec. Style properties use the item type "style".
 */
/** Shown when a property is not set: the value the engine uses then (so a select never reads "—" for the default). */
const DEFAULT_SHOWN = { chart: { chartType: 'column', legend: 'bottom' } };
const propLabel = (tk, spec, type) => (spec.labelKey ? tk(spec.labelKey, spec.label) : tk(`p_${type}_${spec.key}`, tk(`p_${spec.key}`, spec.label)));
/** Select options in the UI language: o_<propKey>_<value>, else the option's own label (or its value). */
const optLabels = (tk, key, options) => options.map(o => (typeof o === 'string' ? { value: o, label: tk(`o_${key}_${o}`, o) } : { ...o, label: tk(`o_${key}_${o.value}`, o.label) }));
/** A property category heading in the UI language. */
const catLabel = (tk, cat) => tk(`cat_${cat}`, cat);

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
    body = !f ? null : sel.cells?.length > 1 ? <CellsProps table={f.item} sel={sel} openExpr={openExpr} /> : <CellProps table={f.item} sel={sel} openExpr={openExpr} />;
  } else if (sel.kind === 'section') body = <SectionProps section={sel.section} />;
  else body = <ReportProps />;

  // the data set Fields.x reads in the selection: the item's (else the report's first), a cell's table's
  const one = sel.kind === 'items' && sel.ids.length === 1 ? findItem(def, sel.ids[0])?.item : sel.kind === 'cell' ? findItem(def, sel.id)?.item : null;
  const scope = one ? one.dataSet || def.dataSets?.[0]?.name || null : undefined;
  // A new selection gets fresh fields (keyed: no input carries over, so typing never lands in the last item's field)
  // and starts at the top of the panel, not at the last item's scroll position.
  const selKey = sel.kind === 'items' ? `i:${sel.ids.join(',')}` : sel.kind === 'cell' ? `c:${sel.id}:${sel.part}:${sel.row}:${sel.col}:${sel.cells?.length || 0}` : `${sel.kind}:${sel.section || ''}`;
  const ref = useRef(null);
  useLayoutEffect(() => {
    const pane = ref.current?.closest('.dright');
    if (pane) pane.scrollTop = 0;
  }, [selKey]);
  // Collapsible sections: every section heading is a toggle; the closed ones (by heading) stay closed for the session.
  const [closed, setClosed] = useState(() => new Set());
  useLayoutEffect(() => {
    for (const h of ref.current?.querySelectorAll('.cat > h5') || []) {
      const shut = closed.has(h.textContent);
      h.querySelector('button')?.setAttribute('aria-expanded', String(!shut));
      h.parentElement.toggleAttribute('data-collapsed', shut);
    }
  });
  // the heading's button is a native button: Enter and Space arrive as clicks
  const toggle = (e) => {
    const h = e.target.closest?.('.cat > h5');
    if (!h) return;
    const k = h.textContent;
    setClosed(c => { const n = new Set(c); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  };
  return (
    <div data-testid="inspector" ref={ref} onClick={toggle}>
      <FieldScope.Provider value={scope}><Fragment key={selKey}>{body}</Fragment></FieldScope.Provider>
      {expr && <ExpressionEditor {...expr} onClose={() => setExpr(null)} />}
    </div>
  );
}

/* ---------------------------------------------------------------- shared */
function Geo({ label, value, onChange, min, drawnOf }) {
  const unit = useDesigner(s => s.unit);
  const T = useT();
  // #9: a matrix draws wider than its box with its data: say so where the width is (the issues pane counts the drawn width)
  const drawn = useDesigner(s => (drawnOf ? s.extents?.[drawnOf]?.w || 0 : 0));
  const hint = drawn > (value ?? 0) + 0.5 ? T('ux_drawsWidth', { w: `${round(fromPt(drawn, unit) * 100) / 100} ${unit}` }) : undefined;
  return (
    <Field label={`${label} (${unit})`} hint={hint}>
      <NumberInput value={round(fromPt(value ?? 0, unit) * 100) / 100} min={min == null ? undefined : round(fromPt(min, unit) * 100) / 100} step={unit === 'pt' ? 1 : unit === 'in' ? 0.05 : 0.5} onChange={v => onChange(round(toPt(v, unit)))} />
    </Field>
  );
}

function PropEditor({ p: spec, value, onChange, openExpr, dataSet, item }) {
  const T = useT();
  const tk = useTk();
  const p = { ...spec, label: propLabel(tk, spec, item?.type || 'style'), ...(spec.options ? { options: optLabels(tk, spec.key, spec.options) } : {}) };
  const def = useDesigner(s => s.def);
  const families = useFontFamilies();
  switch (p.type) {
    case 'expr': return <Field label={p.label}><ExprInput value={value} onChange={onChange} onOpen={() => openExpr({ value, dataSet, onSave: onChange, title: p.label })} /></Field>;
    case 'html': return <Field label={p.label}><textarea className="input mono" rows={7} spellCheck={false} data-testid={`prop-${p.key}`} style={{ width: '100%', resize: 'vertical', fontSize: 11 }} value={value ?? ''} onChange={e => onChange(e.target.value === '' ? undefined : e.target.value)} /></Field>;
    case 'number': return p.expr ? <ExprOr p={p} value={value} onChange={onChange} openExpr={openExpr} dataSet={dataSet}><NumberInput value={value} onChange={onChange} /></ExprOr> : <Field label={p.label}><NumberInput value={value} onChange={onChange} /></Field>;
    case 'bool': return p.defaultOn ? <Check label={p.label} checked={value !== false} onChange={v => onChange(v ? undefined : false)} /> : <Check label={p.label} checked={value} onChange={onChange} />;
    case 'select': if (p.number) return <Field label={p.label}><Select value={value == null ? '' : String(value)} onChange={v => onChange(v == null ? undefined : Number(v))} options={p.options} allowEmpty /></Field>; // stored as a number
      return p.expr ? <ExprOr p={p} value={value} onChange={onChange} openExpr={openExpr} dataSet={dataSet}><Select value={value} onChange={onChange} options={p.options} allowEmpty /></ExprOr> : <Field label={p.label}><Select value={value} onChange={onChange} options={p.options} allowEmpty /></Field>;
    case 'palette': return <PaletteEditor label={p.label} value={value} onChange={onChange} />;
    case 'report': return <Field label={p.label}><ReportPicker value={value} onChange={onChange} /></Field>;
    case 'color': return <Field label={p.label}><ColorInput value={value} onChange={onChange} /></Field>;
    case 'font': return <Field label={p.label}><Select value={value} onChange={onChange} options={families} allowEmpty /></Field>;
    case 'dataset': return <Field label={p.label}><Select value={value} onChange={onChange} options={(def.dataSets || []).map(d => d.name)} allowEmpty /></Field>;
    case 'action': return <ActionEditor value={value} onChange={onChange} openExpr={openExpr} dataSet={dataSet} />;
    case 'stylename': return <Field label={p.label}><StyleNameSelect value={value} onChange={onChange} /></Field>;
    case 'overflowTarget': return <Field label={p.label}><OverflowTarget value={value} onChange={onChange} self={item?.name} /></Field>;
    case 'series': return <SeriesEditor value={value} onChange={onChange} openExpr={openExpr} dataSet={dataSet} chartType={item?.chartType || 'column'} />;
    case 'stacked': return <Field label={p.label}><Select value={value === 'percent' ? 'percent' : value ? 'stacked' : ''} options={[{ value: '', label: T('i_sideBySide') }, { value: 'stacked', label: T('i_stacked') }, { value: 'percent', label: T('i_stacked100') }]} onChange={v => onChange(v === 'percent' ? 'percent' : v ? true : undefined)} /></Field>;
    case 'axes': return <AxesEditor value={value} onChange={onChange} chartType={item?.chartType || 'column'} hasSecondary={(item?.series || []).some(sr => sr.axis === 'secondary')} />;
    case 'overlays': return <OverlaysEditor value={value} onChange={onChange} openExpr={openExpr} dataSet={dataSet} chartType={item?.chartType || 'column'} />;
    case 'params': return <ParamsEditor label={p.label} value={value} onChange={onChange} report={item?.report} openExpr={openExpr} dataSet={dataSet} />;
    default: return <Field label={p.label}><TextInput value={value} onChange={v => onChange(v === '' ? undefined : v)} /></Field>;
  }
}

function StyleNameSelect({ value, onChange }) {
  return <Select value={value} onChange={onChange} options={useStyleNames()} allowEmpty />;
}
/** The overflow placeholders of the report (a fixed table frame, or another placeholder, continues there). */
function OverflowTarget({ value, onChange, self }) {
  const def = useDesigner(s => s.def);
  const names = [];
  walk(def, (it) => { if (it.type === 'overflow' && it.name !== self) names.push(it.name); });
  return <Select value={value} onChange={onChange} options={names} allowEmpty data-testid="overflow-target" />;
}

/** A fixed value (the normal control) or an expression: a font size, weight or style can be =IIf(…). */
function ExprOr({ p, value, onChange, openExpr, dataSet, children }) {
  const T = useT();
  const [on, setOn] = useState(isDynamic(value));
  const label = T(on ? 'useFixed' : 'useExpr');
  return (
    <Field label={p.label}>
      <div className="expr-row">
        {on ? <ExprInput value={value} onChange={v => onChange(v || undefined)} onOpen={() => openExpr({ value, dataSet, onSave: onChange, title: p.label })} placeholder="=IIf(Fields.amount < 0, 'bold', 'normal')" /> : children}
        <button type="button" className="btn sm ghost" aria-pressed={on} title={label} aria-label={`${p.label}: ${label}`} onClick={() => { if (on || isDynamic(value)) onChange(undefined); setOn(!on); }}>{on ? '×' : '='}</button>
      </div>
    </Field>
  );
}

/** A named palette, or the report's own list of colours. */
function PaletteEditor({ label, value, onChange }) {
  const T = useT();
  const custom = Array.isArray(value);
  const [text, setText] = useState(custom ? value.join(', ') : '');
  const parse = (t) => t.split(/[\s,;]+/).map(x => x.trim()).filter(x => /^#[0-9a-f]{6}$/i.test(x));
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <Field label={label}>
        <Select value={custom ? '__custom' : value} allowEmpty options={[...Object.keys(PALETTES), { value: '__custom', label: T('paletteCustom') }]}
          onChange={v => { if (v === '__custom') { const list = parse(text); onChange(list.length ? list : [...PALETTES.default]); if (!list.length) setText(PALETTES.default.join(', ')); } else onChange(v); }} data-testid="chart-palette" />
      </Field>
      {custom && <Field label={T('paletteColours')} hint={T('paletteColoursHint')}>
        <TextInput value={text} mono onChange={t => { setText(t); const list = parse(t); if (list.length) onChange(list); }} data-testid="chart-palette-colours" />
      </Field>}
      {custom && <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }} aria-hidden="true">{value.map((c, i) => <span key={i} style={{ width: 14, height: 14, borderRadius: 3, background: c, border: '1px solid var(--line)' }} />)}</div>}
    </div>
  );
}

const reportLists = new Map(); // server → report list (designers on different servers must not share one: N17)
/** Report ids for drill-through and subreports: a list to pick from, still free text (an =expression works). */
function ReportPicker({ value, onChange }) {
  const [list, setList] = useState(() => reportLists.get(useDesigner.getState().embed?.server || '') || []);
  const listId = useState(() => `reports-${Math.random().toString(36).slice(2, 8)}`)[0];
  useEffect(() => {
    const embed = useDesigner.getState().embed;
    const server = embed?.server || '';
    if (reportLists.has(server) || (embed && !embed.server)) return; // standalone: no saved reports
    fetch(`${server}/api/reports`).then(r => (r.ok ? r.json() : [])).then(l => { const v = Array.isArray(l) ? l : []; reportLists.set(server, v); setList(v); }).catch(() => {});
  }, []);
  return (
    <>
      <TextInput value={value} onChange={v => onChange(v || undefined)} mono list={listId} placeholder="loan-statement" data-testid="report-picker" />
      <datalist id={listId}>{list.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</datalist>
    </>
  );
}

function groupBy(props) {
  const g = new Map();
  for (const p of props) { if (!g.has(p.category)) g.set(p.category, []); g.get(p.category).push(p); }
  return [...g];
}
const setOrDelete = (obj, k, v) => { if (v === undefined || v === '') delete obj[k]; else obj[k] = v; };

function StyleCats({ props, style, onSet, openExpr, dataSet, skipBox }) {
  const tk = useTk();
  return groupBy(props.filter(p => !(skipBox && p.category === 'Box'))).map(([cat, ps]) => (
    <div className="cat" key={cat}>
      <CatHead data-icon={cat}>{catLabel(tk, cat)}</CatHead>
      <div className="grid2">
        {ps.map(p => <div key={p.key} data-prop={p.key} style={p.type === 'color' || p.type === 'text' ? { gridColumn: '1 / -1' } : undefined}>
          <PropEditor p={p} value={style?.[p.key]} onChange={v => onSet(p.key, v)} openExpr={openExpr} dataSet={dataSet} />
        </div>)}
      </div>
    </div>
  ));
}

/* ---------------------------------------------------------------- item */
function ItemProps({ item, section, openExpr }) {
  const T = useT();
  const tk = useTk();
  const def = useDesigner(s => s.def);
  const spec = ITEMS[item.type];
  const [nameErr, setNameErr] = useState(null);
  // "Find a property": only the properties whose label (in the UI language) or key has the text
  const [find, setFind] = useState('');
  const q = find.trim().toLowerCase();
  const hit = (p, type) => !q || propLabel(tk, p, type).toLowerCase().includes(q) || p.key.toLowerCase().includes(q);
  const props = (spec?.props || []).filter(p => (!p.showIf || p.showIf(item)) && hit(p, item.type));
  // the pivot and group editors are not in the property list: their interactivity is found by these words too
  const words = (...ks) => !!q && ks.some(k => k.toLowerCase().includes(q));
  const pivotHit = item.type === 'matrix' && words(T('i_actionOnClick'), T('ux_headerAction'), T('ux_cellAction'), T('i_interactivity'), T('pivotCollapsible'), 'action', 'drill', 'click', 'link', 'bookmark');
  const groupHit = item.type === 'table' && words(T('i_groups'), T('i_drillToggle'), T('i_startCollapsed'), T('i_addGroup'), 'drill', 'group', 'collapse', 'toggle');
  // the item's own sort and filters (a pivot has filters only)
  const sortFilterHit = ['table', 'list', 'chart', 'matrix'].includes(item.type) && (item.type === 'matrix'
    ? words(T('sfFilterTitle'), T('dsAddFilter'), 'filter', 'filters')
    : words(T('sfTitle'), T('sfSortBy'), T('sfDirection'), T('dsAddFilter'), 'sort', 'sorting', 'filter', 'filters', 'order'));
  const styleProps = stylePropsFor(item.type).filter(p => hit(p, 'style'));
  const set = (k, v) => updateItem(item.id, it => setOrDelete(it, k, v), `${item.id}.${k}`);
  const setStyle = (k, v) => updateItem(item.id, it => { it.style ||= {}; setOrDelete(it.style, k, v); }, `${item.id}.style.${k}`);
  // position and size: an item placed below its band grows the band to fit, as dragging does
  const setGeo = (k, v) => updateItem(item.id, (it, d, _s, f) => { it[k] = v; growToFit(d, f); }, `${item.id}.${k}`);
  const rename = (v) => {
    let taken = false; walk(def, (i) => { if (i.id !== item.id && i.name === v) taken = true; });
    setNameErr(!/^[A-Za-z_][\w]*$/.test(v) ? T('i_nameChars') : taken ? T('i_nameTaken') : null);
    // a published report part follows its item's new name
    if (/^[A-Za-z_][\w]*$/.test(v) && !taken) useDesigner.getState().apply(d => { const f = findItem(d, item.id); if (!f) return; for (const p of d.parts || []) if (p.item === f.item.name) p.item = v; f.item.name = v; }, `${item.id}.name`);
  };
  const dataSet = item.dataSet;
  return (
    <>
      <div className="insp-head">
        <div style={{ minWidth: 0 }}>
          <TextInput value={item.name} onChange={rename} aria-label={T('i_itemName')} />
          {nameErr && <div className="err">{nameErr}</div>}
        </div>
        <span className="ty">{tk(`item_${item.type}`, spec?.label || item.type)}</span>
      </div>
      <div className="cat insp-find"><input type="search" className="input" value={find} onChange={e => setFind(e.target.value)} placeholder={T('i_findProperty')} aria-label={T('i_findProperty')} data-testid="find-property" /></div>
      {q && !props.length && !styleProps.length && !pivotHit && !groupHit && !sortFilterHit && <div className="cat"><span className="hint">{T('i_noPropMatch')}</span></div>}
      {pivotHit && <PivotEditor item={item} openExpr={openExpr} />}
      {groupHit && <GroupsEditor table={item} openExpr={openExpr} />}
      {sortFilterHit && <SortFilterEditor item={item} noSort={item.type === 'matrix'} />}
      {!q && item.type === 'chart' && (
        <div className="cat">
          <button className="btn sm" data-testid="open-chart-gallery" onClick={() => useDesigner.getState().setUi({ wizard: { mode: 'edit', id: item.id } })}>{T('i_chartGallery')}</button>
          <span className="hint">{T('i_chartGalleryHint')}</span>
        </div>
      )}
      {!q && <div className="cat">
        <CatHead data-icon="i_position">{T('i_position')}</CatHead>
        <div className="grid2">
          <Geo label="X" value={item.x} onChange={v => setGeo('x', Math.max(0, v))} />
          <Geo label="Y" value={item.y} onChange={v => setGeo('y', Math.max(0, v))} />
          {item.type !== 'table' && <Geo label={T('i_width')} value={item.w} drawnOf={item.id} min={item.type === 'line' ? 0 : 1} onChange={v => setGeo('w', Math.max(0, v))} />}
          {item.type !== 'table' && <Geo label={T('i_height')} value={item.h} min={item.type === 'line' ? 0 : 1} onChange={v => setGeo('h', Math.max(0, v))} />}
          {item.type === 'table' && <Field label={T('tableSize')} hint={T('tableSizeHint')}><TextInput value={`${round(item.w)} × ${round(item.h)} pt`} readOnly data-testid="table-size" /></Field>}
        </div>
        <div className="hint">{(() => { const band = sectionList(def).find(s => s.key === section)?.label || section, parent = findItem(def, item.id)?.parent; return parent ? T('i_whereParent', { band, parent: parent.name }) : T('i_where', { band }); })()}</div>
        <LayerField item={item} />
      </div>}
      {!q && (item.type === 'textbox' || item.type === 'chart') && (() => {
        const dsn = item.dataSet || def.dataSets?.[0]?.name || null;
        const at = item.type === 'chart'
          ? { subject: subjectOf(item.series?.[0]?.value), scope: dsn, avg: pointAverage(subjectOf(item.series?.[0]?.value), item.category, dsn) }
          : { subject: subjectOf(item.value), scope: dsn };
        const fields = fieldsOf(def, dsn).map(f => f.name);
        const apply = (cf) => updateItem(item.id, it => {
          if (it.type !== 'chart') { applyCf(it, cf, at); return; }
          const prev = it.cf ? cfExpressions(it.cf, at).style : {};
          const next = cfExpressions(cf, at).style;
          if (it.pointColor && it.pointColor === (prev.backgroundColor || prev.color)) delete it.pointColor;
          if (next.backgroundColor || next.color) it.pointColor = next.backgroundColor || next.color;
          if (cf.rules?.length) it.cf = cf; else delete it.cf;
        });
        return <div className="cat"><CatHead data-icon="cf_title">{T('cf_title')}</CatHead><div className="btnrow"><CfButton label={T(item.type === 'chart' ? 'cf_points' : 'cf_button')} title={T('cf_titleOf', { name: item.name })} target={item} at={at} kind={item.type === 'chart' ? 'chart' : 'text'} fields={fields} apply={apply} testid="cf-open" /></div></div>;
      })()}
      {!q && item.type === 'part' && <PartInstance item={item} />}
      {!q && item.partProps && typeof item.partProps === 'object' && <PartValues item={item} />}
      {!q && item.type === 'image' && <EmbeddedPicker item={item} onPick={v => set('src', v)} />}
      {groupBy(props).map(([cat, ps]) => (
        <div className="cat" key={cat}>
          <CatHead data-icon={cat}>{catLabel(tk, cat)}</CatHead>
          {ps.map(p => <PropEditor key={p.key} p={p} value={item[p.key] ?? DEFAULT_SHOWN[item.type]?.[p.key]} onChange={v => set(p.key, v)} openExpr={openExpr} dataSet={dataSet} item={item} />)}
        </div>
      ))}
      {!q && <>
      {item.type === 'table' && <TableProps table={item} openExpr={openExpr} />}
      {item.type === 'matrix' && <PivotEditor item={item} openExpr={openExpr} />}
      {(item.type === 'list' || item.type === 'chart') && <SortFilterEditor item={item} />}
      {item.type === 'matrix' && <SortFilterEditor item={item} noSort />}
      </>}
      {!q && (item.type === 'list' || item.type === 'container') && <div className="cat"><span className="hint">{T(item.groupBy ? 'i_nestHintGrouped' : 'i_nestHint', { type: tk(`item_${item.type}`, item.type).toLowerCase() })}</span></div>}
      <StyleCats props={styleProps} style={item.style} onSet={setStyle} openExpr={openExpr} dataSet={dataSet} />
      {!q && item.type !== 'part' && item.type !== 'placeholder' && <PublishPart item={item} />}
      <div className="cat"><div className="btnrow">
        <button className="btn sm" onClick={duplicateSelection}>{T('i_duplicate')} <span className="kbd">⌘D</span></button>
        <button className="btn sm danger" onClick={deleteSelection}>{T('i_delete')} <span className="kbd">Del</span></button>
      </div></div>
    </>
  );
}

function TableProps({ table, openExpr }) {
  const T = useT();
  return (
    <>
      <div className="cat">
        <CatHead data-icon="i_columns">{T('i_columns')}</CatHead>
        <div className="grid4">
          {table.columns.map((c, i) => (
            <Field key={i} label={`#${i + 1}`}><NumberInput value={c.width} step={1} onChange={v => tableSetColumnWidth(table.id, i, v, `${table.id}.col${i}`)} /></Field>
          ))}
        </div>
        <div className="btnrow">
          <button className="btn sm" onClick={() => tableInsertColumn(table.id, table.columns.length)}>{T('i_addColumn')}</button>
        </div>
        <div className="hint">{T('i_tableWidthHint', { w: round(table.columns.reduce((s, c) => s + c.width, 0)) })}</div>
      </div>
      <div className="cat">
        <CatHead data-icon="i_rows">{T('i_rows')}</CatHead>
        {tableParts(table).map(({ part, label }) => (
          <div key={part} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{T('i_partRows', { part: label })} <b>{(rowsOf(table, part) || []).length}</b></span>
            <button className="btn sm" onClick={() => tableInsertRow(table.id, part, (rowsOf(table, part) || []).length)}>{T('i_add')}</button>
          </div>
        ))}
        <div className="hint">{T('i_clickCell')}</div>
      </div>
      <GroupsEditor table={table} openExpr={openExpr} />
      <SortFilterEditor item={table} />
    </>
  );
}


/* ---------------------------------------------------------------- pivot (matrix) */
const LEGACY_MATRIX = ['rowGroup', 'columnGroup', 'value', 'valueFormat', 'rowSort', 'columnSort', 'rowTotals', 'columnTotals'];
/** Rows, columns and values of a matrix. The first edit turns the old single-group form into the array form (same look). */
function PivotEditor({ item, openExpr }) {
  const T = useT();
  const def = useDesigner(s => s.def);
  const fields = fieldsOf(def, item.dataSet);
  const spec = normalizeMatrix(item);
  const [pick, setPick] = useState({ rowGroups: '', columnGroups: '', values: '' });
  const edit = (fn, key) => updateItem(item.id, (it) => {
    if (!isTablix(it)) {
      const n = normalizeMatrix(it);
      Object.assign(it, { rowGroups: n.rowGroups, columnGroups: n.columnGroups, values: n.values });
      for (const k of LEGACY_MATRIX) delete it[k];
    }
    fn(it);
  }, key);
  const setK = (list, i, k, v) => edit(it => { const o = it[list][i]; if (v === undefined || v === '' || v === false) delete o[k]; else o[k] = v; }, `${item.id}.${list}${i}.${k}`);
  const move = (list, i, d) => edit(it => { const a = it[list]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; });
  const remove = (list, i) => edit(it => { it[list].splice(i, 1); });
  const usedNames = () => new Set([...spec.rowGroups, ...spec.columnGroups].map(g => g.name).filter(Boolean));
  const add = (list) => {
    const f = pick[list];
    if (!f) return;
    const type = fields.find(x => x.name === f)?.type;
    edit(it => {
      if (list === 'values') { it.values.push({ label: f, value: type === 'number' ? `=Sum(Fields.${f})` : `=Count(Fields.${f})`, format: type === 'number' ? 'N0' : undefined }); return; }
      const names = usedNames();
      let name = f.replace(/\W/g, '').replace(/^./, c => c.toUpperCase()) || 'Group', n = name, k = 2;
      while (names.has(n)) n = `${name}${k++}`;
      it[list].push({ name: n, expr: `=Fields.${f}`, sort: 'asc' });
    });
    setPick({ ...pick, [list]: '' });
  };
  const exprField = (list, i, k, v, title) => <ExprInput value={v || ''} onChange={x => setK(list, i, k, x)} onOpen={() => openExpr({ value: v || '', dataSet: item.dataSet, onSave: x => setK(list, i, k, x), title })} />;
  const tools = (list, i, n) => (
    <span className="btnrow" style={{ margin: 0 }}>
      <button className="btn sm ghost" disabled={i === 0} onClick={() => move(list, i, -1)} aria-label={T('moveUp')} title={T('moveUp')}>↑</button>
      <button className="btn sm ghost" disabled={i === n - 1} onClick={() => move(list, i, 1)} aria-label={T('moveDown')} title={T('moveDown')}>↓</button>
      <button className="btn sm ghost danger" onClick={() => remove(list, i)}>{T('pivotRemove')}</button>
    </span>
  );
  const adder = (list) => (
    <div className="expr-row">
      <Select value={pick[list]} options={fields.map(f => f.name)} allowEmpty onChange={v => setPick({ ...pick, [list]: v || '' })} aria-label={T('pivotAddField')} data-testid={`pivot-pick-${list}`} />
      <button className="btn sm" disabled={!pick[list]} onClick={() => add(list)} data-testid={`pivot-add-${list}`}>{T('pivotAdd')}</button>
    </div>
  );
  const totals = [{ value: 'none', label: T('totalNone') }, { value: 'before', label: T('totalBefore') }, { value: 'after', label: T('totalAfter') }];
  const groupList = (list, title) => (
    <div className="cat" data-testid={`pivot-${list}`}>
      <CatHead>{title}</CatHead>
      {spec[list].map((g, i) => (
        <div className="group-card" key={i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}><b>{i + 1}. {g.name || g.expr}</b>{tools(list, i, spec[list].length)}</div>
          <Field label={T('pivotGroupBy')}>{exprField(list, i, 'expr', g.expr, T('pivotGroupBy'))}</Field>
          <div className="grid2">
            <Field label={T('pivotName')}><TextInput value={g.name || ''} onChange={v => setK(list, i, 'name', v.replace(/\W/g, ''))} /></Field>
            <Field label={T('pivotSort')}><Select value={g.sort || ''} options={[{ value: 'asc', label: T('dsAsc') }, { value: 'desc', label: T('dsDesc') }]} allowEmpty onChange={v => setK(list, i, 'sort', v)} /></Field>
            <Field label={T('pivotTotal')}><Select value={g.total || 'none'} options={totals} onChange={v => setK(list, i, 'total', v === 'none' ? undefined : v)} /></Field>
            {list === 'rowGroups' && <Field label={T('pivotWidth')}><NumberInput value={g.width ?? item.rowHeaderWidth ?? 110} step={1} onChange={v => setK(list, i, 'width', Math.max(12, v))} /></Field>}
          </div>
          <Field label={T('pivotLabel')}>{exprField(list, i, 'label', g.label, T('pivotLabel'))}</Field>
          {list === 'rowGroups' && <Field label={T('pivotHeader')}><TextInput value={g.header || ''} onChange={v => setK(list, i, 'header', v)} /></Field>}
          {g.total && g.total !== 'none' && <Field label={T('pivotTotalLabel')}><TextInput value={g.totalLabel ?? ''} onChange={v => setK(list, i, 'totalLabel', v)} placeholder={T('i_total')} aria-label={`${T('pivotTotalLabel')} ${i + 1}`} /></Field>}
          {list === 'rowGroups' && i === spec[list].length - 1 && <>
            {/* the innermost row group can be recursive (an org chart): parent is the key of the row's parent */}
            <Field label={T('groupParent')} hint={T('groupParentHint')}>{exprField(list, i, 'parent', g.parent, T('groupParent'))}</Field>
            {g.parent && <div className="grid2">
              <Field label={T('groupIndent')}><NumberInput value={g.indent ?? 12} step={1} onChange={v => setK(list, i, 'indent', Math.max(0, Math.min(72, v)))} /></Field>
              <Field label={T('groupExpandLevels')}><NumberInput value={g.expandLevels ?? ''} step={1} onChange={v => setK(list, i, 'expandLevels', Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined)} /></Field>
            </div>}
          </>}
          {(i < spec[list].length - 1 || (list === 'rowGroups' && g.parent)) && <Check label={T('pivotCollapsible')} checked={g.collapsible} onChange={v => edit(it => { const o = it[list][i]; if (v) { o.collapsible = true; o.initiallyCollapsed = true; } else { delete o.collapsible; delete o.initiallyCollapsed; } }, `${item.id}.${list}${i}.collapsible`)} />} {/* starts closed, as a table's drill-down toggle does */}
          {g.collapsible && <Check label={T('pivotStartCollapsed')} checked={g.initiallyCollapsed} onChange={v => setK(list, i, 'initiallyCollapsed', v)} />}
          <div data-testid={`pivot-${list}${i}-action`}><ActionEditor label={T('ux_headerAction')} value={g.action} onChange={v => setK(list, i, 'action', v)} openExpr={openExpr} dataSet={item.dataSet} /></div>
          {g.total && g.total !== 'none' && <div data-testid={`pivot-${list}${i}-total-action`}><ActionEditor label={T('ux_totalAction')} value={g.totalAction} onChange={v => setK(list, i, 'totalAction', v)} openExpr={openExpr} dataSet={item.dataSet} /></div>}
        </div>
      ))}
      {adder(list)}
    </div>
  );
  const shows = [{ value: 'value', label: T('showValue') }, { value: 'percentOfTotal', label: T('showPctTotal') }, { value: 'percentOfRow', label: T('showPctRow') }, { value: 'percentOfColumn', label: T('showPctColumn') }];
  return (
    <>
      {groupList('rowGroups', T('pivotRows'))}
      {groupList('columnGroups', T('pivotColumns'))}
      <div className="cat" data-testid="pivot-values">
        <CatHead data-icon="pivotValues">{T('pivotValues')}</CatHead>
        {spec.values.map((v, i) => (
          <div className="group-card" key={i}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}><b>{i + 1}. {v.label || v.value}</b>{tools('values', i, spec.values.length)}</div>
            <Field label={T('pivotValue')}>{exprField('values', i, 'value', v.value, T('pivotValue'))}</Field>
            <div className="grid2">
              <Field label={T('pivotLabel')}><TextInput value={v.label || ''} onChange={x => setK('values', i, 'label', x)} /></Field>
              <Field label={T('pivotFormat')}><TextInput value={v.format || ''} onChange={x => setK('values', i, 'format', x)} placeholder="N0" /></Field>
              <Field label={T('pivotShow')}><Select value={v.show || 'value'} options={shows} onChange={x => edit(it => setMatrixShow(it.values[i], x), `${item.id}.values${i}.show`)} /></Field>
            </div>
            <div data-testid={`pivot-values${i}-action`}><ActionEditor label={T('ux_cellAction')} value={v.action} onChange={x => setK('values', i, 'action', x)} openExpr={openExpr} dataSet={item.dataSet} /></div>
            <Field label={T('cellBookmark')}>{exprField('values', i, 'bookmark', v.bookmark, T('cellBookmark'))}</Field>
          </div>
        ))}
        {adder('values')}
        <div className="hint">{T('pivotHint')}</div>
        <div className="hint">{T('ux_pivotActionHint')}</div>
      </div>
      <div className="cat" data-testid="pivot-styles">
        <CatHead data-icon="pivotStyles">{T('pivotStyles')}</CatHead>
        {MATRIX_STYLES.map(([k, labelKey, dflt]) => (
          <details className="group-card" key={k} data-testid={`pivot-${k}`}>
            <summary>{T(labelKey)}</summary>
            <div className="grid2">
              {MINI_STYLE.map(p => <div key={p.key} style={p.type === 'color' || p.type === 'text' ? { gridColumn: '1 / -1' } : undefined}>
                <PropEditor p={p} value={(item[k] || dflt)[p.key]} openExpr={openExpr} dataSet={item.dataSet}
                  onChange={v => edit(it => { it[k] ||= { ...dflt }; setOrDelete(it[k], p.key, v); }, `${item.id}.${k}.${p.key}`)} />
              </div>)}
            </div>
          </details>
        ))}
      </div>
    </>
  );
}
// the engine's defaults (items/index.js matrix): the first edit starts from them, so the look does not jump
const MATRIX_STYLES = [['headerStyle', 'pivotHeaderStyle', {}], ['cellStyle', 'pivotCellStyle', { borderBottom: '0.5 solid #e5e7eb' }], ['totalStyle', 'pivotTotalStyle', { fontWeight: 'bold', borderTop: '1 solid #94a3b8' }]];
const MINI_KEYS = ['fontWeight', 'fontSize', 'fontStyle', 'color', 'backgroundColor', 'textAlign', 'verticalAlign', 'border', 'borderTop', 'borderBottom'];
const MINI_STYLE = MINI_KEYS.map(k => TEXT_STYLE_PROPS.find(p => p.key === k)).filter(Boolean);
const ROW_KEYS = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'color', 'textAlign', 'verticalAlign', 'backgroundColor', 'padding', 'border', 'borderTop', 'borderBottom'];
const ROW_STYLE = ROW_KEYS.map(k => TEXT_STYLE_PROPS.find(p => p.key === k)).filter(Boolean);

function fieldsOf(def, dsName) { return (def.dataSets?.find(d => d.name === dsName)?.fields || []); }

function GroupsEditor({ table, openExpr }) {
  const T = useT();
  const def = useDesigner(s => s.def);
  const fields = fieldsOf(def, table.dataSet);
  const [pick, setPick] = useState('');
  const [drill, setDrill] = useState(false);
  const setG = (i, k, v) => updateItem(table.id, t => { if (v === undefined || v === '' || v === false) delete t.groups[i][k]; else t.groups[i][k] = v; }, `${table.id}.g${i}.${k}`);
  const numericCols = () => (table.detail?.[0]?.cells || []).map((c, ci) => [ci, /^=Fields\.(\w+)$/.exec(c?.value || '')?.[1]]).filter(([, f]) => f && fields.find(x => x.name === f)?.type === 'number');
  return (
    <div className="cat">
      <CatHead data-icon="i_groups">{T('i_groups')}</CatHead>
      {(table.groups || []).map((g, i) => (
        <div className="group-card" key={i}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><b>{i + 1}. {g.name}</b>
            <button className="btn sm ghost danger" onClick={() => tableRemoveGroup(table.id, i)}>{T('i_remove')}</button></div>
          <div className="grid2">
            <Field label={T('i_groupName')}><TextInput value={g.name} onChange={v => setG(i, 'name', v.replace(/\W/g, ''))} /></Field>
            <Field label={T('i_sortGroups')}><Select value={g.sort || ''} options={[{ value: 'asc', label: T('dsAsc') }, { value: 'desc', label: T('dsDesc') }]} allowEmpty onChange={v => setG(i, 'sort', v)} /></Field>
          </div>
          <Field label={T('i_groupBy')}><ExprInput value={g.expr} onChange={v => setG(i, 'expr', v)} onOpen={() => openExpr({ value: g.expr, dataSet: table.dataSet, onSave: v => setG(i, 'expr', v), title: T('i_groupBy') })} /></Field>
          <Field label={T('i_sortGroupsBy')}><ExprInput value={g.sortBy || ''} onChange={v => setG(i, 'sortBy', v)} onOpen={() => openExpr({ value: g.sortBy || '', dataSet: table.dataSet, onSave: v => setG(i, 'sortBy', v), title: T('i_sortGroupsByTitle') })} /></Field>
          <Field label={T('i_pageBreak')}><Select value={g.pageBreak || ''} options={[{ value: 'between', label: T('i_pbBetween') }, { value: 'after', label: T('i_pbAfter') }]} allowEmpty onChange={v => setG(i, 'pageBreak', v)} /></Field>
          <Check label={T('i_keepGroup')} checked={g.keepTogether} onChange={v => setG(i, 'keepTogether', v)} />
          <Check label={T('groupRepeatHeader')} checked={g.repeatHeader} onChange={v => setG(i, 'repeatHeader', v)} />
          <Check label={T('i_drillToggle')} checked={g.collapsible} onChange={v => updateItem(table.id, t => { const x = t.groups[i]; if (v) { x.collapsible = true; x.initiallyCollapsed = true; } else { delete x.collapsible; delete x.initiallyCollapsed; } }, `${table.id}.g${i}.collapsible`)} />
          {g.collapsible && <Check label={T('i_startCollapsed')} checked={g.initiallyCollapsed} onChange={v => setG(i, 'initiallyCollapsed', v)} />}
          <Field label={T('groupParent')} hint={T('groupParentHint')}><ExprInput value={g.parent || ''} onChange={v => setG(i, 'parent', v)} onOpen={() => openExpr({ value: g.parent || '', dataSet: table.dataSet, onSave: v => setG(i, 'parent', v), title: T('groupParent') })} placeholder="=Fields.managerId" /></Field>
          {g.parent && <div className="grid2">
            <Field label={T('groupIndent')}><NumberInput value={g.indent || 0} step={1} onChange={v => setG(i, 'indent', Math.max(0, v) || undefined)} /></Field>
            {g.collapsible && <Field label={T('groupExpandLevels')}><NumberInput value={g.expandLevels ?? ''} step={1} onChange={v => setG(i, 'expandLevels', Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined)} /></Field>}
          </div>}
          <Check label={T('groupNewSection')} checked={g.newSection} onChange={v => setG(i, 'newSection', v)} />
        </div>
      ))}
      <div className="group-add" data-testid="group-add">
        <Field label={T('i_fieldToGroupBy')}>
          <div className="expr-row">
            <Select value={pick} options={fields.map(f => f.name)} allowEmpty onChange={v => setPick(v || '')} aria-label={T('i_fieldToGroupBy')} />
            <button className="btn sm" disabled={!pick} onClick={() => { tableAddGroup(table.id, pick, numericCols(), { drill }); setPick(''); }}>{T('i_addGroup')}</button>
          </div>
        </Field>
        <Check label={T('ux_addGroupDrill')} checked={drill} onChange={setDrill} />
      </div>
      <div className="hint">{T('i_groupScopeHint', { name: (table.groups || [])[0]?.name || 'Region' })}</div>
    </div>
  );
}

export const OPS = ['=', '<>', '>', '>=', '<', '<=', 'in', 'like', 'contains', 'Between', 'TopN', 'BottomN', 'TopPercent', 'BottomPercent'];
function SortFilterEditor({ item, noSort }) {
  const T = useT();
  const def = useDesigner(s => s.def);
  const fields = fieldsOf(def, item.dataSet).map(f => f.name);
  const set = (fn) => updateItem(item.id, fn, `${item.id}.sf`);
  const sort = item.sort?.[0];
  return (
    <div className="cat" data-testid="sort-filter">
      <CatHead>{T(noSort ? 'sfFilterTitle' : 'sfTitle')}</CatHead>
      {!noSort && <div className="grid2">
        <Field label={T('sfSortBy')}><Select value={sort?.by?.replace(/^=Fields\./, '') || ''} options={fields} allowEmpty onChange={v => set(t => { if (v) t.sort = [{ by: `=Fields.${v}`, dir: sort?.dir || 'asc' }]; else delete t.sort; })} aria-label={T('sfSortBy')} /></Field>
        <Field label={T('sfDirection')}><Select value={sort?.dir || 'asc'} options={[{ value: 'asc', label: T('dsAsc') }, { value: 'desc', label: T('dsDesc') }]} onChange={v => set(t => { if (t.sort?.[0]) t.sort[0].dir = v; })} aria-label={T('sfDirection')} /></Field>
      </div>}
      {(item.filters || []).map((f, i) => (
        <div className={`rowx${f.op === 'Between' ? ' between' : ''}`} key={i}>
          <TextInput mono value={f.expr} onChange={v => set(t => { t.filters[i].expr = v; })} aria-label={T('dsFilterField')} />
          <Select value={f.op || '='} options={OPS} onChange={v => set(t => { t.filters[i].op = v; })} aria-label={T('sfOperator')} />
          <TextInput mono value={f.value} onChange={v => set(t => { t.filters[i].value = v; })} aria-label={T('dsFilterValue')} placeholder={/^(top|bottom)/i.test(f.op || '') ? 'N' : undefined} />
          {f.op === 'Between' && <TextInput mono value={f.value2} onChange={v => set(t => { t.filters[i].value2 = v; })} aria-label={T('dsUpperValue')} placeholder={T('dsAnd')} />}
          <button className="btn sm ghost danger" onClick={() => set(t => { t.filters.splice(i, 1); if (!t.filters.length) delete t.filters; })} aria-label={T('dsRemoveFilter')}>✕</button>
        </div>
      ))}
      <div><button className="btn sm" onClick={() => set(t => { t.filters ||= []; t.filters.push({ expr: fields[0] ? `=Fields.${fields[0]}` : '', op: '=', value: '' }); })} data-testid="add-filter">{T('dsAddFilter')}</button></div>
      <div className="hint">{T('sfHint')}</div>
    </div>
  );
}

const FINANCIAL = new Set(['candlestick', 'ohlc']);
const COMBO = new Set(['column', 'bar', 'line', 'area', 'candlestick', 'ohlc']);
function SeriesEditor({ value, onChange, openExpr, dataSet, chartType }) {
  const T = useT();
  const list = value || [];
  const set = (i, k, v) => onChange(list.map((x, j) => { if (j !== i) return x; const n = { ...x, [k]: v }; if (v === undefined || v === '') delete n[k]; return n; }));
  const expr = (sr, i, key, label, placeholder) => (
    <Field label={label} key={key}><ExprInput value={sr[key]} onChange={v => set(i, key, v)} onOpen={() => openExpr({ value: sr[key], dataSet, onSave: v => set(i, key, v), title: `${sr.name || `Series ${i + 1}`}: ${label}` })} placeholder={placeholder} /></Field>
  );
  const fin = FINANCIAL.has(chartType);
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <span className="hint">{T('i_seriesHint')}{fin ? ` ${T('i_seriesHintFin')}` : ''}</span>
      {list.map((sr, i) => {
        const range = sr.low != null && sr.high != null && !fin;
        return (
          <div className="group-card" key={i} data-testid={`series-${i}`}>
            <div className="expr-row">
              <TextInput value={sr.name} onChange={v => set(i, 'name', v)} aria-label={T('i_seriesName')} placeholder={T('i_name')} />
              <input type="color" value={/^#[0-9a-f]{6}$/i.test(sr.color || '') ? sr.color : '#2563eb'} onChange={e => set(i, 'color', e.target.value)} aria-label={T('i_seriesColor')} style={{ width: 26, height: 26, border: '1px solid var(--line)', borderRadius: 5, padding: 0 }} />
              <button className="btn sm ghost danger" onClick={() => onChange(list.filter((_, j) => j !== i))} aria-label={T('i_removeSeries')}>✕</button>
            </div>
            {fin ? <>{expr(sr, i, 'open', T('i_open'), '=Sum(Fields.open)')}{expr(sr, i, 'high', T('i_high'), '=Max(Fields.high)')}{expr(sr, i, 'low', T('i_low'), '=Min(Fields.low)')}{expr(sr, i, 'close', T('i_close'), '=Sum(Fields.close)')}</>
              : range ? <>{expr(sr, i, 'low', T('i_fromLow'), '=Min(Fields.amount)')}{expr(sr, i, 'high', T('i_toHigh'), '=Max(Fields.amount)')}</>
                : <ExprInput value={sr.value} onChange={v => set(i, 'value', v)} onOpen={() => openExpr({ value: sr.value, dataSet, onSave: v => set(i, 'value', v), title: `Series ${sr.name || i + 1}` })} placeholder="=Sum(Fields.amount)" />}
            {chartType === 'bubble' && expr(sr, i, 'size', T('i_bubbleSize'), '=Fields.population')}
            {COMBO.has(chartType) && (
              <div className="grid2">
                <Field label={T('i_drawAs')}><Select value={sr.type} allowEmpty options={(chartType === 'bar' ? ['bar', 'line', 'area'] : ['column', 'line', 'area']).map(v => ({ value: v, label: T(`o_chartType_${v}`) }))} onChange={v => set(i, 'type', v)} aria-label={T('i_seriesType')} /></Field>
                <Field label={T('i_axis')}><Select value={sr.axis || 'primary'} options={[{ value: 'primary', label: T('axisPrimary') }, { value: 'secondary', label: T('axisSecondary') }]} onChange={v => set(i, 'axis', v === 'primary' ? undefined : v)} aria-label={T('i_seriesAxis')} /></Field>
                {['line', 'area'].includes(sr.type || chartType) && <Field label={T('seriesLine')}><Select value={sr.line} allowEmpty options={[{ value: 'straight', label: T('lineStraight') }, { value: 'smooth', label: T('lineSmooth') }, { value: 'step', label: T('lineStep') }]} onChange={v => set(i, 'line', v)} aria-label={`${T('seriesLine')} ${i + 1}`} /></Field>}
              </div>
            )}
            {COMBO.has(chartType) && !fin && <Check label={T('i_range')} checked={range} onChange={on => onChange(list.map((x, j) => {
              if (j !== i) return x;
              const n = { ...x };
              if (on) { n.low = x.value || ''; n.high = x.value || ''; delete n.value; } else { n.value = x.low || ''; delete n.low; delete n.high; }
              return n;
            }))} />}
          </div>
        );
      })}
      <div><button className="btn sm" onClick={() => onChange([...list, { name: `Series ${list.length + 1}`, value: '' }])}>{T('i_addSeries')}</button></div>
    </div>
  );
}

const optNum = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? undefined : Number(v));
function AxesEditor({ value, onChange, chartType, hasSecondary }) {
  const T = useT();
  const axes = value || {};
  const set = (ax, k, v) => {
    const a = { ...(axes[ax] || {}) };
    if (v === undefined || v === '') delete a[k]; else a[k] = v;
    const n = { ...axes, [ax]: a };
    if (!Object.keys(a).length) delete n[ax];
    onChange(Object.keys(n).length ? n : undefined);
  };
  const round = ['radar', 'polar', 'gauge'].includes(chartType);
  const list = round ? [['y', T(chartType === 'gauge' ? 'i_axScale' : 'i_axValues')]] : [['x', T(['scatter', 'bubble'].includes(chartType) ? 'i_axX' : 'i_axCategory')], ['y', T('i_axValue')], ...(hasSecondary ? [['y2', T('i_axSecondary')]] : [])];
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {list.map(([ax, label]) => {
        const a = axes[ax] || {};
        const valueAxis = ax !== 'x' || ['scatter', 'bubble'].includes(chartType);
        return (
          <div className="group-card" key={ax} data-testid={`axis-${ax}`}>
            <b style={{ fontSize: 11 }}>{label}</b>
            {!round && <Field label={T('i_title')}><TextInput value={a.title} onChange={v => set(ax, 'title', v)} aria-label={T('i_axisTitleAria', { axis: label })} /></Field>}
            {valueAxis && <>
              <div className="grid2">
                <Field label={T('i_minimum')}><TextInput value={a.min ?? ''} onChange={v => set(ax, 'min', optNum(v))} aria-label={T('i_axisMinAria', { axis: label })} placeholder={T('i_auto')} /></Field>
                <Field label={T('i_maximum')}><TextInput value={a.max ?? ''} onChange={v => set(ax, 'max', optNum(v))} aria-label={T('i_axisMaxAria', { axis: label })} placeholder={T('i_auto')} /></Field>
              </div>
              {chartType !== 'gauge' && <Field label={T('i_numberFormat')}><TextInput value={a.format} onChange={v => set(ax, 'format', v)} placeholder="N0, C0, P0, 0.0" aria-label={T('i_axisFormatAria', { axis: label })} /></Field>}
              {!round && <Check label={T('i_log')} checked={a.log} onChange={v => set(ax, 'log', v || undefined)} />}
            </>}
            {!valueAxis && <Field label={T('i_labelAngle')}><TextInput value={a.labelAngle ?? ''} onChange={v => set(ax, 'labelAngle', optNum(v))} aria-label={T('i_labelAngleAria')} /></Field>}
            {chartType !== 'gauge' && <Check label={T('i_gridLines')} checked={a.gridlines ?? (ax === 'y')} onChange={v => set(ax, 'gridlines', v === (ax === 'y') ? undefined : v)} />}
            {!round && <Check label={T('i_reversed')} checked={a.reversed} onChange={v => set(ax, 'reversed', v || undefined)} />}
          </div>
        );
      })}
      {!round && !hasSecondary && <span className="hint">{T('i_secondaryHint')}</span>}
    </div>
  );
}

const OVERLAY_TYPES = ['trend', 'movingAverage', 'line', 'band'];
function OverlaysEditor({ value, onChange, openExpr, dataSet, chartType }) {
  const T = useT();
  const list = value || [];
  const set = (i, k, v) => onChange(list.map((x, j) => { if (j !== i) return x; const n = { ...x, [k]: v }; if (v === undefined || v === '') delete n[k]; return n; }));
  // on a gauge a band is one of its ranges
  const types = (chartType === 'gauge' ? OVERLAY_TYPES.slice(2) : ['scatter', 'bubble'].includes(chartType) ? OVERLAY_TYPES.filter(t => t !== 'movingAverage') : OVERLAY_TYPES)
    .map(v => ({ value: v, label: T(chartType === 'gauge' && v === 'band' ? 'i_ov_range' : `i_ov_${v}`) }));
  const numOrExpr = (o, i, k, label) => (
    <Field label={label} key={k}><ExprInput value={o[k] == null ? '' : String(o[k])} onChange={v => set(i, k, optNum(v) ?? (v || undefined))} onOpen={() => openExpr({ value: String(o[k] ?? ''), dataSet, onSave: v => set(i, k, optNum(v) ?? v), title: label })} placeholder={T('i_ovValuePh')} /></Field>
  );
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {list.map((o, i) => (
        <div className="group-card" key={i} data-testid={`overlay-${i}`}>
          <div className="expr-row">
            <Select value={o.type} options={types} onChange={v => set(i, 'type', v)} aria-label={T('i_overlayType')} />
            <ColorInput value={o.color} onChange={v => set(i, 'color', v)} />
            <button className="btn sm ghost danger" onClick={() => onChange(list.filter((_, j) => j !== i).length ? list.filter((_, j) => j !== i) : undefined)} aria-label={T('i_removeOverlay')}>✕</button>
          </div>
          {o.type === 'trend' && <div className="grid2">
            <Field label={T('i_fit')}><Select value={o.kind || 'linear'} options={[{ value: 'linear', label: T('i_fitLinear') }, { value: 'exp', label: T('i_fitExp') }, { value: 'poly', label: T('i_fitPoly') }]} onChange={v => set(i, 'kind', v === 'linear' ? undefined : v)} /></Field>
            {o.kind === 'poly' && <Field label={T('i_order')}><NumberInput value={o.order ?? 2} step={1} min={2} onChange={v => set(i, 'order', v)} /></Field>}
          </div>}
          {o.type === 'movingAverage' && <Field label={T('i_period')}><NumberInput value={o.period ?? 3} step={1} min={1} onChange={v => set(i, 'period', v)} /></Field>}
          {(o.type === 'trend' || o.type === 'movingAverage') && <Field label={T('i_ofSeries')}><NumberInput value={(o.series ?? 0) + 1} step={1} min={1} onChange={v => set(i, 'series', Math.max(0, v - 1) || undefined)} /></Field>}
          {o.type === 'line' && numOrExpr(o, i, 'value', T('i_at'))}
          {o.type === 'band' && <div className="grid2">{numOrExpr(o, i, 'from', T('i_from'))}{numOrExpr(o, i, 'to', T('i_to'))}</div>}
          {(o.type === 'line' || o.type === 'band') && chartType !== 'gauge' && <Field label={T('overlayAxis')}><Select value={o.axis || 'primary'} options={[{ value: 'primary', label: T('axisPrimary') }, { value: 'secondary', label: T('axisSecondary') }]} onChange={v => set(i, 'axis', v === 'primary' ? undefined : v)} aria-label={`${T('overlayAxis')} ${i + 1}`} /></Field>}
          {o.type === 'line' && <Check label={T('overlayShowValue')} checked={o.showValue !== false} onChange={v => set(i, 'showValue', v ? undefined : false)} />}
          {chartType !== 'gauge' && <Check label={T('overlayInLegend')} checked={o.legend !== false} onChange={v => set(i, 'legend', v ? undefined : false)} />}
          <Field label={T('i_label')}><TextInput value={o.label} onChange={v => set(i, 'label', v)} aria-label={T('i_overlayLabel')} /></Field>
        </div>
      ))}
      <div><button className="btn sm" onClick={() => onChange([...list, { type: chartType === 'gauge' ? 'band' : 'trend' }])} data-testid="add-overlay">{T('i_addOverlay')}</button></div>
    </div>
  );
}

/** A subreport's parameters: the same structured map as a drill-through, from the subreport's own parameters. */
/** "Conditional formatting…": opens the rules wizard for a text box, a cell, a row or a chart's points. */
function CfButton({ label, title, target, at, kind, fields, apply, testid }) {
  const T = useT();
  const [open, setOpen] = useState(false);
  const n = target?.cf?.rules?.length || 0;
  return (
    <>
      <button type="button" className="btn sm" onClick={() => setOpen(true)} data-testid={testid}>{label}{n ? ` (${T('cf_nRules', { n })})` : ''}</button>
      {open && <CondFormat title={title} cf={target.cf} fields={fields} thisValue={!!at.subject} kind={kind} custom={customProps(target, at)} onApply={apply} onClose={() => setOpen(false)} />}
    </>
  );
}
/** What "this value" is for the rules: an expression's own text (=Fields.x → Fields.x); a text template has none. */
const subjectOf = (v) => (typeof v === 'string' && v.startsWith('=') ? v.slice(1) : null);

function ParamsEditor({ label, value, onChange, report, openExpr, dataSet }) {
  const known = useReportParams(report);
  return <Field label={label}><ParamMap value={value} onChange={v => onChange(v || {})} known={known} openExpr={openExpr} dataSet={dataSet} testid="pmap-subreport" /></Field>;
}

/** A sparkline's points from a list field of the data set (one point per value). */
function ListFieldPick({ dataSet, value, onPick }) {
  const T = useT();
  const def = useDesigner(s => s.def);
  const lists = fieldsOf(def, dataSet).filter(f => f.type === 'list').map(f => f.name);
  if (!lists.length) return <div className="hint">{T('visListHint')}</div>;
  const cur = /^=Fields\.(\w+)$/.exec(String(value || ''))?.[1];
  return <Field label={T('visListField')}><Select value={lists.includes(cur) ? cur : ''} allowEmpty options={lists} onChange={f => onPick(f ? `=Fields.${f}` : undefined)} data-testid="sparkline-list-field" /></Field>;
}

function VisualEditor({ cell, setCell, openExpr, dataSet }) {
  const T = useT();
  const v = cell.visual || null;
  const set = (patch) => { const n = { ...(v || {}), ...patch }; setCell('visual', n.type ? n : undefined); };
  const E = (key, label, placeholder) => <Field label={label}><ExprInput value={v[key]} onChange={x => set({ [key]: x || undefined })} onOpen={() => openExpr({ value: v[key], dataSet, onSave: x => set({ [key]: x }), title: label })} placeholder={placeholder} /></Field>;
  const ty = v?.type;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <Field label={T('i_cellShows')}><Select value={ty || ''} options={['sparkline', 'databar', 'bullet', 'iconset', 'rangebar'].map(v => ({ value: v, label: T(`item_${v}`) }))} allowEmpty onChange={t => (t ? set({ type: t }) : setCell('visual', undefined))} /></Field>
      {ty === 'sparkline' && E('category', T('i_onePointPer'), '=Fields.month')}
      {ty && ty !== 'rangebar' && E('value', T('i_value'), '=Sum(Fields.amount)')}
      {ty === 'sparkline' && E('values', T('visValues'), '=Fields.history')}
      {ty === 'sparkline' && <ListFieldPick dataSet={dataSet} value={v.values} onPick={x => set({ values: x })} />}
      {ty === 'sparkline' && <>
        <Field label={T('i_style')}><Select value={v.style || 'line'} options={[{ value: 'line', label: T('i_slLine') }, { value: 'column', label: T('i_slColumns') }, { value: 'area', label: T('i_slArea') }, { value: 'winloss', label: T('i_slWinLoss') }]} onChange={x => set({ style: x })} /></Field>
        {E('bandLow', T('i_bandFrom'), '=0')}
        {E('bandHigh', T('i_bandTo'), '=100')}
        {(v.bandLow || v.bandHigh) && <Field label={T('visBandColor')}><ColorInput value={v.bandColor} onChange={x => set({ bandColor: x })} /></Field>}
        {v.style === 'winloss' && <Field label={T('visNegColor')}><ColorInput value={v.negColor} onChange={x => set({ negColor: x })} /></Field>}
      </>}
      {ty === 'databar' && <>
        <Check label={T('visShowValue')} checked={v.showValue !== false} onChange={x => set({ showValue: x ? undefined : false })} />
        {v.showValue !== false && <Field label={T('visFormat')}><TextInput value={v.format} onChange={x => set({ format: x || undefined })} placeholder="N0" mono aria-label={T('visFormat')} /></Field>}
      </>}
      {ty === 'iconset' && <>
        <Field label={T('i_icons')}><Select value={v.iconSet || 'trafficLights'} options={['trafficLights', 'arrows', 'symbols', 'flags', 'ratings'].map(x => ({ value: x, label: T(`o_iconSet_${x}`) }))} onChange={x => set({ iconSet: x })} /></Field>
        {E('lower', T('i_lowBelow'), '=33')}
        {E('upper', T('i_highFrom'), '=67')}
        <Check label={T('r4_iconReverse')} checked={v.reverse === true} onChange={x => set({ reverse: x ? true : undefined })} />
      </>}
      {ty === 'rangebar' && <>{E('low', T('i_from'), '=Fields.min')}{E('high', T('i_to'), '=Fields.max')}{E('min', T('i_scaleMin'), '=0')}</>}
      {(ty === 'databar' || ty === 'bullet' || ty === 'rangebar') && E('max', T('i_maximum'), '=Max(Fields.amount, "Table1")')}
      {ty === 'bullet' && E('target', T('i_target'))}
      {ty && ty !== 'iconset' && <Field label={T('i_colorOrExpr')}><ColorInput value={v.color} onChange={x => set({ color: x })} /></Field>}
    </div>
  );
}

/** A report's parameters, for the drill-through mapping: { name, required, prompt }[] (null while loading or unknown). */
const reportParams = new Map();
function useReportParams(id) {
  const srv = () => useDesigner.getState().embed?.server || '';
  const [list, setList] = useState(() => reportParams.get(`${srv()} ${id}`) ?? null);
  useEffect(() => {
    if (!id || isDynamic(id)) { setList(null); return; }
    const key = `${srv()} ${id}`;
    if (reportParams.has(key)) { setList(reportParams.get(key)); return; }
    let alive = true;
    const embed = useDesigner.getState().embed;
    if (embed && !embed.server) { setList(null); return; } // standalone: no saved reports
    const server = embed?.server || '';
    fetch(`${server}/api/reports/${encodeURIComponent(id)}`).then(r => (r.ok ? r.json() : null)).then(r => {
      const d = r?.definition || r;
      const ps = d && typeof d === 'object' ? (d.parameters || []).map(p => ({ name: p.name, required: !!p.required && p.default == null, prompt: p.prompt })) : null;
      if (ps) reportParams.set(key, ps);
      if (alive) setList(ps);
    }).catch(() => { if (alive) setList(null); });
    return () => { alive = false; };
  }, [id]);
  return list;
}

/**
 * Parameters to pass (a drill-through, or "Filter this report"): one row per parameter of the target report, each mapped
 * to an expression. A name the target does not have is flagged; a required one left unmapped too. Free names still work
 * when the target's parameters are unknown (an =expression report, or one that did not load).
 */
function ParamMap({ value, onChange, known, openExpr, dataSet, testid }) {
  const T = useT();
  const map = value || {};
  const [extra, setExtra] = useState('');
  const knownNames = new Set((known || []).map(p => p.name));
  const names = [...(known || []).map(p => p.name), ...Object.keys(map).filter(k => !knownNames.has(k))];
  const set = (k, v, keep) => { const n = { ...map }; if (v === undefined || (v === '' && !keep)) delete n[k]; else n[k] = v; onChange(Object.keys(n).length ? n : undefined); };
  return (
    <div className="pmap" data-testid={testid}>
      {!names.length && <span className="hint">{T(known ? 'ux_pmapNoParams' : 'ux_pmapUnknown')}</span>}
      {names.map(k => {
        const kp = (known || []).find(p => p.name === k);
        const v = map[k] ?? '';
        const bad = known && !kp ? T('ux_pmapNotAParam') : kp?.required && v === '' ? T('ux_pmapRequired') : null;
        return (
          <div className="pmap-row" key={k} data-param={k}>
            <span className={`pmap-name${bad ? ' bad' : ''}`} title={kp?.prompt || k}>{k}{kp?.required ? ' *' : ''}</span>
            <ExprInput value={v} onChange={x => set(k, x, !kp)} onOpen={() => openExpr({ value: v, dataSet, onSave: x => set(k, x, !kp), title: k })} placeholder={T('ux_pmapNotPassed')} />
            {!kp && <button type="button" className="btn sm ghost danger" onClick={() => set(k, undefined)} aria-label={T('ux_pmapRemove', { name: k })}>✕</button>}
            {bad && <span className="err pmap-err">{bad}</span>}
          </div>
        );
      })}
      <div className="expr-row">
        <TextInput value={extra} onChange={v => setExtra(v.replace(/\W/g, ''))} placeholder={T('ux_pmapOther')} aria-label={T('ux_pmapOther')} />
        <button type="button" className="btn sm" disabled={!extra || names.includes(extra)} onClick={() => { set(extra, '', true); setExtra(''); }}>{T('i_add')}</button>
      </div>
    </div>
  );
}

function ActionEditor({ value, onChange, openExpr, dataSet, label }) {
  const T = useT();
  const def = useDesigner(s => s.def);
  const itemNames = []; walk(def, (it) => { if (it.name) itemNames.push(it.name); });
  const a = value || { type: 'none' };
  const set = (patch) => { const n = { ...a, ...patch }; onChange(n.type === 'none' ? undefined : n); };
  const target = useReportParams(a.type === 'report' ? a.report : null);
  const own = (def.parameters || []).map(p => ({ name: p.name, prompt: p.prompt }));
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <Field label={label || T('i_actionOnClick')}><Select value={a.type} options={[{ value: 'none', label: T('i_actNone') }, { value: 'url', label: T('i_actUrl') }, { value: 'report', label: T('i_actReport') }, { value: 'params', label: T('i_actParams') }, { value: 'bookmark', label: T('i_actBookmark') }, { value: 'toggleItem', label: T('actionToggleItem') }]} onChange={v => set({ type: v || 'none' })} /></Field>
      {a.type === 'toggleItem' && <Field label={T('actionToggleTarget')} hint={T('actionToggleHint')}><Select value={a.target} allowEmpty options={itemNames} onChange={v => set({ target: v })} data-testid="toggle-target" /></Field>}
      {a.type === 'url' && <Field label={T('i_url')}><ExprInput value={a.url} onChange={v => set({ url: v })} onOpen={() => openExpr({ value: a.url, dataSet, onSave: v => set({ url: v }), title: T('i_url') })} /></Field>}
      {a.type === 'bookmark' && <Field label={T('jumpToBookmark')}><ExprInput value={a.target} onChange={v => set({ target: v })} onOpen={() => openExpr({ value: a.target, dataSet, onSave: v => set({ target: v }), title: T('jumpToBookmark') })} /></Field>}
      {a.type === 'params' && <>
        <Field label={T('ux_setParams')}><ParamMap value={a.params} onChange={v => set({ params: v })} known={own} openExpr={openExpr} dataSet={dataSet} testid="pmap-params" /></Field>
        <Check label={T('i_toggleClears')} checked={a.toggle !== false} onChange={v => set({ toggle: v ? undefined : false })} />
      </>}
      {a.type === 'report' && <>
        <Field label={T('drillReport')}><ReportPicker value={a.report} onChange={v => set({ report: v })} /></Field>
        <Field label={T('ux_pmapTitle')}><ParamMap value={a.params} onChange={v => set({ params: v })} known={target} openExpr={openExpr} dataSet={dataSet} testid="pmap-report" /></Field>
      </>}
    </div>
  );
}

/* ---------------------------------------------------------------- cell */
function CellProps({ table, sel, openExpr }) {
  const T = useT();
  const def = useDesigner(s => s.def);
  const row = rowsOf(table, sel.part)?.[sel.row];
  const cell = row?.cells?.[sel.col];
  if (!row || !cell) return <div className="cat"><span className="hint">{T('i_cellGone')}</span></div>;
  const key = `${table.id}.${sel.part}.${sel.row}.${sel.col}`;
  const setCell = (k, v) => updateItem(table.id, t => setOrDelete(rowsOf(t, sel.part)[sel.row].cells[sel.col], k, v), `${key}.${k}`);
  const setCellStyle = (k, v) => updateItem(table.id, t => { const c = rowsOf(t, sel.part)[sel.row].cells[sel.col]; c.style ||= {}; setOrDelete(c.style, k, v); }, `${key}.s.${k}`);
  const setRow = (k, v) => updateItem(table.id, t => { setOrDelete(rowsOf(t, sel.part)[sel.row], k, v); tableSync(t); }, `${key}.r.${k}`);
  const setRowStyle = (k, v) => updateItem(table.id, t => { const r = rowsOf(t, sel.part)[sel.row]; r.style ||= {}; setOrDelete(r.style, k, v); }, `${key}.rs.${k}`);
  const partLabel = tableParts(table).find(p => p.part === sel.part)?.label || sel.part;
  // a total typed by hand (=Sum(Fields.x) in a header, group or footer row) takes its column's number format, as the
  // wizards' totals do: the detail cell's, else the field's own (tableGen formatFor)
  const setValue = (v) => {
    const f = sel.part !== 'detail' && !cell.style?.format && /^=(Sum|Avg|Min|Max|RunningValue)\(Fields\.(\w+)/.exec(v || '')?.[2];
    if (!f) { setCell('value', v); return; }
    const fd = fieldsOf(def, table.dataSet).find(x => x.name === f);
    const fmt = table.detail?.[0]?.cells?.[sel.col]?.style?.format || (fd && formatFor(fd, useDesigner.getState().sample?.dataSets?.[table.dataSet], { currency: def.currency }));
    updateItem(table.id, t => { const c = rowsOf(t, sel.part)[sel.row].cells[sel.col]; c.value = v; if (fmt) c.style = { ...(c.style || {}), format: fmt, textAlign: c.style?.textAlign || 'right' }; }, `${key}.value`);
  };
  return (
    <>
      <div className="insp-head"><b>{T('i_cellOf', { name: table.name })}</b><span className="ty">{T('i_cellPos', { part: partLabel, row: sel.row + 1, col: sel.col + 1 })}</span></div>
      <div className="cat">
        <CatHead data-icon="i_data">{T('i_data')}</CatHead>
        <Field label={T('i_value')}><ExprInput value={cell.value} onChange={setValue} onOpen={() => openExpr({ value: cell.value, dataSet: table.dataSet, onSave: setValue, title: T('i_cellTitle', { name: table.name, part: partLabel }) })} /></Field>
        <div className="hint">{T(sel.part === 'detail' ? 'i_cellHintDetail' : /^g/.test(sel.part) ? 'i_cellHintGroup' : 'i_cellHintAll')}</div>
      </div>
      <div className="cat">
        <CatHead data-icon="i_visual">{T('i_visual')}</CatHead>
        <VisualEditor cell={cell} setCell={setCell} openExpr={openExpr} dataSet={table.dataSet} />
      </div>
      <div className="cat">
        <CatHead data-icon="i_interactivity">{T('i_interactivity')}</CatHead>
        {sel.part === 'header' && <Field label={T('i_interactiveSort')} hint={T('i_interactiveSortHint')}><ExprInput value={cell.sortBy} onChange={v => setCell('sortBy', v || undefined)} onOpen={() => openExpr({ value: cell.sortBy, dataSet: table.dataSet, onSave: v => setCell('sortBy', v || undefined), title: T('sfSortBy') })} placeholder="=Fields.amount" /></Field>}
        <Field label={T('cellBookmark')}><ExprInput value={cell.bookmark} onChange={v => setCell('bookmark', v || undefined)} onOpen={() => openExpr({ value: cell.bookmark, dataSet: table.dataSet, onSave: v => setCell('bookmark', v || undefined), title: T('cellBookmark') })} /></Field>
        <ActionEditor value={cell.action} onChange={v => setCell('action', v)} openExpr={openExpr} dataSet={table.dataSet} />
      </div>
      <div className="cat" data-testid="cell-cf">
        <CatHead data-icon="cf_title">{T('cf_title')}</CatHead>
        <div className="btnrow">
          <CfButton label={T('cf_button')} title={T('cf_titleCell', { name: table.name })} target={cell} at={{ subject: subjectOf(cell.value), scope: table.dataSet }} kind="cell" fields={fieldsOf(def, table.dataSet).map(f => f.name)} testid="cf-open"
            apply={(cf) => updateItem(table.id, t => applyCf(rowsOf(t, sel.part)[sel.row].cells[sel.col], cf, { subject: subjectOf(cell.value), scope: table.dataSet }, { visuals: true }))} />
          <CfButton label={T('cf_rowButton')} title={T('cf_titleRow', { name: table.name })} target={row} at={{ subject: null, scope: table.dataSet }} kind="text" fields={fieldsOf(def, table.dataSet).map(f => f.name)} testid="cf-row-open"
            apply={(cf) => updateItem(table.id, t => applyCf(rowsOf(t, sel.part)[sel.row], cf, { subject: null, scope: table.dataSet }))} />
        </div>
      </div>
      <div className="cat">
        <CatHead data-icon="i_structure">{T('i_structure')}</CatHead>
        <div className="btnrow">
          <button className="btn sm" onClick={() => tableInsertColumn(table.id, sel.col)}>{T('i_colLeft')}</button>
          <button className="btn sm" onClick={() => tableInsertColumn(table.id, sel.col + (cell.colSpan || 1))}>{T('i_colRight')}</button>
          <button className="btn sm danger" onClick={() => { tableDeleteColumn(table.id, sel.col); useDesigner.getState().select({ kind: 'items', ids: [table.id] }); }}>{T('i_delColumn')}</button>
        </div>
        <div className="btnrow">
          <button className="btn sm" onClick={() => tableInsertRow(table.id, sel.part, sel.row)}>{T('i_rowAbove')}</button>
          <button className="btn sm" onClick={() => tableInsertRow(table.id, sel.part, sel.row + 1)}>{T('i_rowBelow')}</button>
          <button className="btn sm danger" onClick={() => { tableDeleteRow(table.id, sel.part, sel.row); useDesigner.getState().select({ kind: 'items', ids: [table.id] }); }}>{T('i_delRow')}</button>
        </div>
        <div className="btnrow">
          <button className="btn sm" onClick={() => tableMergeRight(table.id, sel.part, sel.row, sel.col)}>{T('i_mergeRight')}</button>
          <button className="btn sm" disabled={!(cell.colSpan > 1)} onClick={() => tableSplit(table.id, sel.part, sel.row, sel.col)}>{T('i_split')}</button>
          <button className="btn sm" disabled={sel.row + (cell.rowSpan || 1) >= (rowsOf(table, sel.part) || []).length} onClick={() => tableMergeDown(table.id, sel.part, sel.row, sel.col)}>{T('mergeDown')}</button>
          <button className="btn sm" disabled={!(cell.rowSpan > 1)} onClick={() => tableSplitRows(table.id, sel.part, sel.row, sel.col)}>{T('splitRows')}</button>
        </div>
      </div>
      <div className="cat" data-testid="row-props">
        <CatHead data-icon="rowTitle">{T('rowTitle')}</CatHead>
        <div className="grid2">
          <Field label={T('i_heightPt')}><NumberInput value={row.height || 18} step={1} onChange={v => setRow('height', Math.max(6, v))} /></Field>
          <Check label={T('rowCanGrow')} checked={row.canGrow !== false} onChange={v => setRow('canGrow', v ? undefined : false)} />
        </div>
        <Field label={T('rowHidden')} hint={T('rowHiddenHint')}><ExprInput value={row.hidden} onChange={v => setRow('hidden', v || undefined)} onOpen={() => openExpr({ value: row.hidden, dataSet: table.dataSet, onSave: v => setRow('hidden', v || undefined), title: T('rowHidden') })} placeholder="=Fields.amount = 0" /></Field>
        <div className="grid2">
          {ROW_STYLE.map(p => <div key={p.key} style={p.type === 'color' || p.type === 'text' ? { gridColumn: '1 / -1' } : undefined}>
            <PropEditor p={p} value={row.style?.[p.key]} onChange={v => setRowStyle(p.key, v)} openExpr={openExpr} dataSet={table.dataSet} />
          </div>)}
        </div>
        <div className="hint">{T('rowStyleHint')}</div>
        <div className="btnrow"><button type="button" className="btn sm" data-testid="row-clear-cell-styles" title={T('rowClearCellStylesHint')}
          onClick={() => updateItem(table.id, t => { for (const c of rowsOf(t, sel.part)[sel.row].cells || []) if (c?.style) { const keep = Object.fromEntries(Object.entries(c.style).filter(([k]) => k === 'format' || k === 'textAlign')); if (Object.keys(keep).length) c.style = keep; else delete c.style; } })}>{T('rowClearCellStyles')}</button></div>
      </div>
      <div className="cat"><PropEditor p={{ key: 'styleName', label: 'Named style', type: 'stylename' }} value={cell.styleName} onChange={v => setCell('styleName', v)} openExpr={openExpr} /></div>
      <StyleCats props={TEXT_STYLE_PROPS} style={cell.style} onSet={setCellStyle} openExpr={openExpr} dataSet={table.dataSet} />
    </>
  );
}

/** Several table cells: the style properties they share (a blank field: the cells differ), set for all of them at once. */
function CellsProps({ table, sel, openExpr }) {
  const T = useT();
  const list = selCells(sel);
  const cells = list.map(c => rowsOf(table, c.part)?.[c.row]?.cells?.[c.col]).filter(Boolean);
  const common = {};
  for (const p of TEXT_STYLE_PROPS) { const vs = cells.map(c => c.style?.[p.key]); if (vs.every(v => v === vs[0]) && vs[0] !== undefined) common[p.key] = vs[0]; }
  const forAll = (fn, key) => updateItem(table.id, t => { for (const c of list) { const x = rowsOf(t, c.part)?.[c.row]?.cells?.[c.col]; if (x) fn(x); } }, key);
  const setStyle = (k, v) => forAll(x => { x.style ||= {}; setOrDelete(x.style, k, v); if (!Object.keys(x.style).length) delete x.style; }, `${table.id}.cells.${k}`);
  return (
    <>
      <div className="insp-head"><b>{T('ux_nCells', { n: cells.length, name: table.name })}</b></div>
      <div className="cat"><span className="hint">{T('ux_cellsHint')}</span>
        <div className="btnrow">
          <button className="btn sm" onClick={() => forAll(x => { x.value = ''; })}>{T('ux_clearCells')}</button>
          <button className="btn sm" onClick={() => forAll(x => { delete x.style; })}>{T('ux_clearCellStyles')}</button>
        </div>
      </div>
      <StyleCats props={TEXT_STYLE_PROPS} style={common} onSet={setStyle} openExpr={openExpr} dataSet={table.dataSet} />
    </>
  );
}

/* ---------------------------------------------------------------- multi */
function Multi({ ids }) {
  const T = useT();
  const def = useDesigner(s => s.def);
  const items = ids.map(id => findItem(def, id)?.item).filter(Boolean);
  const align = (fn) => useDesigner.getState().apply(d => { const its = ids.map(id => findItem(d, id)?.item).filter(Boolean); fn(its); });
  return (
    <>
      <div className="insp-head"><b>{T('i_nItems', { n: items.length })}</b></div>
      <div className="cat">
        <CatHead data-icon="i_align">{T('i_align')}</CatHead>
        <div className="btnrow">
          <button className="btn sm" onClick={() => align(its => { const v = Math.min(...its.map(i => i.x)); its.forEach(i => { i.x = v; }); })}>{T('i_left')}</button>
          <button className="btn sm" onClick={() => align(its => { const v = Math.max(...its.map(i => i.x + i.w)); its.forEach(i => { i.x = round(v - i.w); }); })}>{T('i_right')}</button>
          <button className="btn sm" onClick={() => align(its => { const v = Math.min(...its.map(i => i.y)); its.forEach(i => { i.y = v; }); })}>{T('i_top')}</button>
          <button className="btn sm" onClick={() => align(its => { const v = Math.max(...its.map(i => i.y + i.h)); its.forEach(i => { i.y = round(v - i.h); }); })}>{T('i_bottom')}</button>
          <button className="btn sm" onClick={() => align(its => { const l = Math.min(...its.map(i => i.x)), r = Math.max(...its.map(i => i.x + i.w)); its.forEach(i => { i.x = round((l + r) / 2 - i.w / 2); }); })}>{T('i_centre')}</button>
          <button className="btn sm" onClick={() => align(its => { const w = Math.max(...its.map(i => i.w)); its.forEach(i => { if (i.type !== 'table') i.w = w; }); })}>{T('i_sameWidth')}</button>
          <button className="btn sm" onClick={() => align(its => { const h = Math.max(...its.map(i => i.h)); its.forEach(i => { if (i.type !== 'table') i.h = h; }); })}>{T('i_sameHeight')}</button>
        </div>
      </div>
      <div className="cat">
        <CatHead data-icon="i_distribute">{T('i_distribute')}</CatHead>
        <div className="btnrow">
          <button className="btn sm" disabled={items.length < 3} onClick={() => align(its => { const s2 = [...its].sort((a, b) => a.x - b.x); const total = s2[s2.length - 1].x + s2[s2.length - 1].w - s2[0].x; const gap = (total - s2.reduce((a, i) => a + i.w, 0)) / (s2.length - 1); let x = s2[0].x; s2.forEach(i => { i.x = round(x); x += i.w + gap; }); })}>{T('i_horizontally')}</button>
          <button className="btn sm" disabled={items.length < 3} onClick={() => align(its => { const s2 = [...its].sort((a, b) => a.y - b.y); const total = s2[s2.length - 1].y + s2[s2.length - 1].h - s2[0].y; const gap = (total - s2.reduce((a, i) => a + i.h, 0)) / (s2.length - 1); let y = s2[0].y; s2.forEach(i => { i.y = round(y); y += i.h + gap; }); })}>{T('i_vertically')}</button>
        </div>
      </div>
      <div className="cat"><div className="btnrow">
        <button className="btn sm" onClick={duplicateSelection}>{T('i_duplicate')}</button>
        <button className="btn sm danger" onClick={deleteSelection}>{T('i_delete')}</button>
      </div></div>
    </>
  );
}

/* ---------------------------------------------------------------- section */
function SectionProps({ section }) {
  const T = useT();
  const def = useDesigner(s => s.def);
  const sec = secOf(def, section);
  const label = sectionList(def).find(s => s.key === section)?.label || section;
  const isBody = isBodyKey(section);
  const multi = Array.isArray(def.sections.body);
  const apply = (fn, key) => useDesigner.getState().apply(d => fn(secOf(d, section), d), key);
  const set = (k, v) => apply(x => setOrDelete(x, k, v), `sec.${section}.${k}`);
  const minH = Math.max(0, ...sec.items.map(i => i.y + i.h));
  const pg = sec.page || {};
  const setPage = (k, v) => apply(x => { x.page ||= {}; if (v === undefined || v === '') delete x.page[k]; else x.page[k] = v; if (!Object.keys(x.page).length) delete x.page; }, `sec.${section}.page.${k}`);
  return (
    <>
      <div className="insp-head"><b>{label}</b><span className="ty">{T('i_section')}</span></div>
      <div className="cat">
        {isBody && multi && <Field label={T('sectionName')}><TextInput value={sec.name || ''} onChange={v => set('name', v || undefined)} /></Field>}
        <Field label={T('i_heightPt')} hint={T(isBody ? 'i_bodyHeightHint' : 'i_bandHeightHint')}>
          <NumberInput value={sec.height || 0} step={1} onChange={v => set('height', Math.max(minH, v))} />
        </Field>
        {isBody && <SectionBands sec={sec} apply={apply} />}
        {isBody && <div className="grid2">
          <Field label={T('i_columns')} hint={T('i_newspaperHint')}><NumberInput value={sec.columns?.count || 1} step={1} min={1} onChange={v => apply(x => { const n = Math.max(1, Math.min(6, Math.round(v))); if (n === 1) delete x.columns; else x.columns = { gap: x.columns?.gap ?? 18, count: n }; })} /></Field>
          {sec.columns?.count > 1 && <Field label={T('i_gapPt')}><NumberInput value={sec.columns.gap ?? 18} step={1} onChange={v => apply(x => { x.columns.gap = Math.max(0, v); }, 'colgap')} /></Field>}
        </div>}
        {isContentKey(section) && <div className="hint">{T('placeholderHint')}</div>}
        {!isBody && !isContentKey(section) && <>
          <Check label={T('i_printFirst')} checked={sec.printOnFirstPage !== false} onChange={v => set('printOnFirstPage', v ? undefined : false)} />
          <Check label={T('i_printLast')} checked={sec.printOnLastPage !== false} onChange={v => set('printOnLastPage', v ? undefined : false)} />
        </>}
      </div>
      {isBody && <div className="cat" data-testid="body-sections">
        <CatHead data-icon="bodySections">{T('bodySections')}</CatHead>
        {multi && <>
          <div className="grid2">
            <Field label={T('sectionPageSize')}><Select value={pg.size || ''} options={Object.keys(PAGE_SIZES)} allowEmpty onChange={v => setPage('size', v || undefined)} /></Field>
            <Field label={T('sectionOrientation')}><Select value={pg.orientation || ''} options={[{ value: 'portrait', label: T('i_portrait') }, { value: 'landscape', label: T('i_landscape') }]} allowEmpty onChange={v => setPage('orientation', v || undefined)} /></Field>
          </div>
          <div className="hint">{T('sectionPageHint')}</div>
        </>}
        <div className="btnrow">
          <button className="btn sm" onClick={addBodySection} data-testid="add-body-section">{T('addSection')}</button>
          {multi && def.sections.body.length > 1 && <button className="btn sm danger" onClick={() => removeBodySection(section)}>{T('removeSection')}</button>}
        </div>
        <div className="hint">{T('sectionHint')}</div>
      </div>}
    </>
  );
}

/** A body section's page header and footer: the report's (shared), its own (a band of its own), or none. */
function SectionBands({ sec, apply }) {
  const T = useT();
  const modeOf = (k) => (sec[k] && typeof sec[k] === 'object' ? (sec[k].hidden ? 'none' : 'own') : 'shared');
  const setMode = (k, mode) => apply((x, d) => {
    if (mode === 'shared') delete x[k];
    else if (mode === 'none') x[k] = { hidden: true };
    else if (!x[k] || x[k].hidden) {
      // its own band starts as a copy of the shared one (new ids and names), so it is an override, not a blank
      const src = d.sections[k] || {};
      const used = allNames(d);
      x[k] = { height: Number(src.height) > 0 ? src.height : 36, items: (src.items || []).map(it => cloneWithIds(it, used)) };
    }
  });
  const opts = [{ value: 'shared', label: T('secBandShared') }, { value: 'own', label: T('secBandOwn') }, { value: 'none', label: T('secBandNone') }];
  return (
    <>
      <div className="grid2">
        <Field label={T('band_pageHeader')}><Select value={modeOf('pageHeader')} options={opts} onChange={v => setMode('pageHeader', v || 'shared')} aria-label={T('band_pageHeader')} data-testid="sec-header-mode" /></Field>
        <Field label={T('band_pageFooter')}><Select value={modeOf('pageFooter')} options={opts} onChange={v => setMode('pageFooter', v || 'shared')} aria-label={T('band_pageFooter')} data-testid="sec-footer-mode" /></Field>
      </div>
      <div className="hint">{T('secBandHint')}</div>
    </>
  );
}

/* ---------------------------------------------------------------- report */
/** Report properties → HTML export: writes `export: { html, drillLinks }`; "Use server default" removes the key. */
function HtmlExportProps({ def, set }) {
  const lang = useDesigner(s => s.lang);
  const T = (k) => HX[lang]?.[k] || HX.en[k]; // hx-admin.js: not in the embeddable viewer's first load
  return (
    <div className="cat" data-testid="report-html-export">
      <CatHead data-icon="i_regional">{T('hx_title')}</CatHead>
      <div className="grid2">
        <Field label={T('hx_mode')}><Select value={def.export?.html || ''} options={[{ value: '', label: T('hx_serverDefault') }, { value: 'interactive', label: T('hx_interactiveOpt') }, { value: 'tables', label: T('hx_tablesOpt') }, { value: 'static', label: T('hx_printOpt') }]}
          onChange={v => set(d => { setExport(d, 'html', v); }, 'exportHtml')} /></Field>
        <Field label={T('hx_drill')}><Select value={def.export?.drillLinks || ''} options={[{ value: '', label: T('hx_serverDefault') }, { value: 'inline', label: T('hx_inline') }, { value: 'new-tab', label: T('hx_newTab') }, { value: 'off', label: T('hx_off') }]}
          onChange={v => set(d => { setExport(d, 'drillLinks', v); }, 'exportDrill')} /></Field>
      </div>
    </div>
  );
}

function ReportProps() {
  const T = useT();
  const def = useDesigner(s => s.def);
  const families = useFontFamilies();
  const [fontsOpen, setFontsOpen] = useState(false);
  const set = (fn, key) => useDesigner.getState().apply(fn, key);
  const m = Array.isArray(def.page?.margins) ? def.page.margins : [36, 36, 36, 36];
  const base = def.styles?.base || {};
  return (
    <>
      <div className="insp-head"><b>{T('i_report')}</b><span className="ty">{def.$schema}</span></div>
      <div className="cat">
        <CatHead data-icon="i_page">{T('i_page')}</CatHead>
        <div className="grid2">
          <Field label={T('i_size')}><Select value={def.page?.size || 'A4'} options={[...Object.keys(PAGE_SIZES), { value: 'Pageless', label: T('i_pageless') }]} onChange={v => set(d => { d.page.size = v; })} /></Field>
          {def.page?.size === 'Pageless'
            ? <Field label={T('i_width')}><NumberInput value={def.page?.width || 960} step={8} onChange={v => set(d => { d.page.width = Math.max(144, v); }, 'pageWidth')} /></Field>
            : <Field label={T('i_orientation')}><Select value={def.page?.orientation || 'portrait'} options={[{ value: 'portrait', label: T('i_portrait') }, { value: 'landscape', label: T('i_landscape') }]} onChange={v => set(d => { d.page.orientation = v; })} /></Field>}
        </div>
        {def.page?.size === 'Pageless' && <div className="hint">{T('i_pagelessHint')}</div>}
        <div className="grid4 nums">
          {['i_top', 'i_right', 'i_bottom', 'i_left'].map((l, i) => (
            <Field key={l} label={T(l)}><NumberInput value={m[i]} step={1} onChange={v => set(d => { const mm = Array.isArray(d.page.margins) ? d.page.margins : [36, 36, 36, 36]; mm[i] = Math.max(0, v); d.page.margins = mm; }, `margin${i}`)} /></Field>
          ))}
        </div>
        <div className="hint">{T('i_marginsHint')}</div>
      </div>
      <ReuseSection />
      <div className="cat">
        <CatHead data-icon="i_regional">{T('i_regional')}</CatHead>
        <div className="grid2">
          <Field label={T('i_locale')}><TextInput value={def.locale} onChange={v => set(d => { d.locale = v || undefined; }, 'locale')} placeholder="en-US" /></Field>
          <Field label={T('i_currency')}><TextInput value={def.currency} onChange={v => set(d => { d.currency = v.toUpperCase() || undefined; }, 'currency')} placeholder="USD" /></Field>
          <div style={{ gridColumn: '1 / -1' }}><Field label={T('i_nonFinite')}><Select value={def.nonFinite || ''} options={[{ value: '', label: T('i_nonFiniteSsrs') }, { value: 'blank', label: T('i_nonFiniteBlank') }, { value: 'error', label: '#Error' }]} onChange={v => set(d => { d.nonFinite = v || undefined; }, 'nonFinite')} /></Field></div>
        </div>
      </div>
      <div className="cat">
        <CatHead data-icon="i_defaultText">{T('i_defaultText')}</CatHead>
        <div className="grid2">
          <Field label={T('i_font')}><Select value={base.fontFamily} options={families} onChange={v => set(d => { d.styles ||= {}; d.styles.base ||= {}; d.styles.base.fontFamily = v; })} /></Field>
          <Field label={T('i_size')}><NumberInput value={base.fontSize ?? 9} onChange={v => set(d => { d.styles ||= {}; d.styles.base ||= {}; d.styles.base.fontSize = v; }, 'basesize')} /></Field>
          <div style={{ gridColumn: '1 / -1' }}><Field label={T('i_color')}><ColorInput value={base.color} onChange={v => set(d => { d.styles ||= {}; d.styles.base ||= {}; setOrDelete(d.styles.base, 'color', v); }, 'basecolor')} /></Field></div>
        </div>
        <div className="btnrow"><button className="btn sm" onClick={() => setFontsOpen(true)}>{T('i_uploadFont')}</button></div>
        {fontsOpen && <FontsDialog onClose={() => setFontsOpen(false)} />}
      </div>
      <HtmlExportProps def={def} set={set} />
      <ReportImages />
      <ReportFunctions />
      <ThemeSection />
      <NamedStyles />
      <div className="cat"><span className="hint">{T('i_reportHint')}</span></div>
    </>
  );
}

/** Images kept in the report (images: { name: data URI }), used as embedded:name by images and backgrounds. */
function ReportImages() {
  const T = useT();
  const images = useDesigner(s => s.def.images) || {};
  const [err, setErr] = useState(null);
  const set = (fn) => useDesigner.getState().apply(d => { d.images ||= {}; fn(d.images); if (!Object.keys(d.images).length) delete d.images; });
  const upload = async (files) => { setErr(null); const r = await uploadImages(files, T); if (r.err) setErr(r.err); };
  return (
    <div className="cat" data-testid="report-images">
      <CatHead data-icon="images">{T('images')}</CatHead>
      {Object.entries(images).map(([name, uri]) => (
        <div key={name} className="trow" style={{ gap: 8 }}>
          <img src={typeof uri === 'string' && uri.startsWith('data:image/') ? uri : undefined} alt="" style={{ width: 28, height: 28, objectFit: 'contain', border: '1px solid var(--line)', borderRadius: 4 }} />
          <span className="nm"><code>embedded:{name}</code></span>
          <button type="button" className="btn sm ghost danger" onClick={() => set(m => { delete m[name]; })} aria-label={T('imageRemove', { name })}>✕</button>
        </div>
      ))}
      <label className="btn sm" style={{ justifySelf: 'start' }}>{T('imageUpload')}
        <input type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" multiple hidden onChange={e => { upload([...e.target.files]); e.target.value = ''; }} data-testid="image-upload" />
      </label>
      {err && <div className="err">{err}</div>}
      <span className="hint">{T('imagesHint')}</span>
    </div>
  );
}

/** Pick one of the report's images for an image item (src embedded:name). */
/** The image of an image item: upload a file here, or pick one of the report's images (thumbnails). */
function EmbeddedPicker({ item, onPick }) {
  const T = useT();
  const images = useDesigner(s => s.def.images) || {};
  const names = Object.keys(images);
  const cur = /^embedded:(.+)$/.exec(String(item.src || ''))?.[1];
  const [err, setErr] = useState(null);
  const upload = async (files) => { setErr(null); const r = await uploadImages(files, T); if (r.err) setErr(r.err); if (r.names[0]) onPick(`embedded:${r.names[0]}`); };
  return (
    <div className="cat" data-testid="image-source">
      <CatHead data-icon="ux_imageCat">{T('ux_imageCat')}</CatHead>
      <label className="btn sm primary" style={{ justifySelf: 'start' }}>{T('ux_imageUploadHere')}
        <input type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" hidden onChange={e => { upload([...e.target.files]); e.target.value = ''; }} data-testid="item-image-upload" />
      </label>
      {err && <div className="err">{err}</div>}
      {names.length > 0 && <div className="img-picks" role="radiogroup" aria-label={T('embeddedImage')}>
        {names.map(n => <button type="button" key={n} role="radio" aria-checked={cur === n} className={`img-pick${cur === n ? ' sel' : ''}`} onClick={() => onPick(`embedded:${n}`)} title={n}>
          <img src={typeof images[n] === 'string' && images[n].startsWith('data:image/') ? images[n] : undefined} alt="" /><span>{n}</span>
        </button>)}
      </div>}
      <Field label={T('embeddedImage')} hint={T('ux_imageHint')}>
        <Select value={cur} allowEmpty options={names} onChange={v => onPick(v ? `embedded:${v}` : undefined)} data-testid="embedded-picker" />
      </Field>
    </div>
  );
}

/** Report functions: reusable formulas in the expression language, called as Code.Name(…) or Name(…). */
function ReportFunctions() {
  const T = useT();
  const fns = useDesigner(s => s.def.functions) || [];
  const set = (fn, key) => useDesigner.getState().apply(d => { d.functions ||= []; fn(d.functions); if (!d.functions.length) delete d.functions; }, key);
  const errors = checkFunctions(fns);
  return (
    <div className="cat">
      <CatHead data-icon="i_functions">{T('i_functions')}</CatHead>
      {fns.map((f, i) => (
        <div key={i} style={{ display: 'grid', gap: 4, marginBottom: 8 }}>
          <div className="grid2">
            <Field label={T('i_name')}><TextInput value={f.name} mono onChange={v => set(l => { l[i].name = v; }, `fn${i}.name`)} placeholder="Tax" /></Field>
            <Field label={T('i_parameters')}><TextInput value={(f.params || []).join(', ')} mono onChange={v => set(l => { l[i].params = v.split(',').map(x => x.trim()).filter(Boolean); }, `fn${i}.params`)} placeholder="amount, rate" /></Field>
          </div>
          <Field label={T('i_body')}><TextInput value={f.body} mono onChange={v => set(l => { l[i].body = v; }, `fn${i}.body`)} placeholder="=amount * 0.18" /></Field>
          <div className="btnrow"><button className="btn sm" type="button" onClick={() => set(l => { l.splice(i, 1); })}>{T('i_remove')}</button></div>
        </div>
      ))}
      {errors.map((e, i) => <div key={i} className="err">{e}</div>)}
      <div className="btnrow"><button className="btn sm" type="button" onClick={() => set(l => { l.push({ name: `Function${l.length + 1}`, params: ['x'], body: '=x' }); })}>{T('i_addFunction')}</button></div>
      <span className="hint">{T('i_functionsHint')}</span>
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
  const T = useT();
  const styleNames = useStyleNames();
  const def = useDesigner(s => s.def);
  const named = def.styles?.named || {};
  const [newName, setNewName] = useState('');
  const setS = (name, k, v) => useDesigner.getState().apply(d => { d.styles ||= {}; d.styles.named ||= {}; d.styles.named[name] ||= {}; if (v === undefined || v === '') delete d.styles.named[name][k]; else d.styles.named[name][k] = v; }, `ns.${name}.${k}`);
  return (
    <div className="cat">
      <CatHead data-icon="i_namedStyles">{T('i_namedStyles')}</CatHead>
      <Field label={T('i_applyTheme')}>
        <Select value="" allowEmpty options={Object.keys(THEMES)} onChange={v => { if (v) useDesigner.getState().apply(d => { d.styles = themeStyles(THEMES[v]); }); }} />
      </Field>
      {Object.entries(named).map(([name, st]) => (
        <div className="style-card" key={name}>
          <b style={{ fontSize: 'var(--fs-sm)' }}>{name}</b>
          <NumberInput value={st.fontSize} step={0.5} onChange={v => setS(name, 'fontSize', v)} aria-label={T('i_styleSizeOf', { name })} />
          <Select value={st.fontWeight} options={['normal', '600', 'bold'].map(v => ({ value: v, label: T(`o_fontWeight_${v}`) }))} allowEmpty onChange={v => setS(name, 'fontWeight', v)} />
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(st.color || '') ? st.color : '#000000'} onChange={e => setS(name, 'color', e.target.value)} aria-label={T('i_styleColourOf', { name })} style={{ width: 26, height: 26, border: '1px solid var(--line)', borderRadius: 5, padding: 0 }} />
          <Select value={st.parent} allowEmpty options={styleNames.filter(n => n !== name)} onChange={v => setS(name, 'parent', v)} aria-label={T('styleParentOf', { name })} title={T('styleParent')} data-testid={`style-parent-${name}`} />
        </div>
      ))}
      <div className="expr-row">
        <TextInput value={newName} onChange={v => setNewName(v.replace(/\W/g, ''))} placeholder={T('i_newStyleName')} aria-label={T('i_newStyleName')} />
        <button className="btn sm" disabled={!newName || named[newName]} onClick={() => { setS(newName, 'fontSize', 9); setNewName(''); }}>{T('i_add')}</button>
      </div>
      <div className="hint">{T('i_namedStylesHint')}</div>
    </div>
  );
}
