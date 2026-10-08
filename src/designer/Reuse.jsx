'use client';
// Phase 8 in the designer: master reports, report part libraries, stylesheets, themes and layers.
// Masters, libraries, stylesheets and themes are other saved reports, fetched here for display only:
// the engine reads them again on every render, so a change to them shows everywhere.
import { useEffect, useState } from 'react';
import { useDesigner, activeStore, useDesignerStore, findItem, walk, addItem, cloneWithIds, allNames, secOf, updateItem } from './store.js';
import { t } from '@/i18n/index.js';
import { TextInput, NumberInput, Select, ColorInput, Field, Check } from './ui.jsx';
import { THEME_COLORS, DEFAULT_THEME, findItemNamed } from '@/engine/reuse.js';
import { useFontFamilies } from './Fonts.jsx';
import CatHead from './CatHead.jsx';

export const MIME_PART = 'application/x-pw-part';
const S = () => useDesigner.getState();
export function useT() { const lang = useDesigner(s => s.lang); return (k, v) => t(lang, k, v); }
const apply = (fn, key) => S().apply(fn, key);
const server = () => S().embed?.server || '';
/** Embedded with no server (standalone): there are no saved reports to list or load. */
const noServer = () => !!S().embed && !S().embed.server;

/* ---------------------------------------------------------------- reports this one reuses */
const pending = new Map();
/** Fetch a report for display (a master, a library, a stylesheet, a theme); force: again, after it changed. */
export function fetchReused(id, force = false, api = activeStore()) {
  if (!id || typeof id !== 'string' || id.startsWith('=')) return Promise.resolve(null);
  const st = api.getState();
  if (!force && st.reused[id]) return Promise.resolve(st.reused[id]);
  // one fetch per server and report; each designer that asked gets it in its own store
  const server = st.embed?.server || '', key = `${server} ${id}`;
  const keep = (d) => { api.setState(s => ({ reused: { ...s.reused, [id]: d } })); return d; };
  if (pending.has(key)) return pending.get(key).then(keep);
  if (st.embed && !server) return Promise.resolve(null); // standalone: no saved reports
  const p = fetch(`${server}/api/reports/${encodeURIComponent(id)}`)
    .then(r => (r.ok ? r.json() : { __error: `HTTP ${r.status}` }))
    .catch(e => ({ __error: e.message }))
    .finally(() => pending.delete(key));
  pending.set(key, p);
  return p.then(keep);
}
/** A reused report's definition (null while it loads or when it did not load). */
export function useReused(id) {
  const api = useDesignerStore();
  const d = useDesigner(s => (id ? s.reused[id] : undefined));
  useEffect(() => { fetchReused(id, false, api); }, [id, api]);
  return d && !d.__error ? d : null;
}

let listCache = null;
/** Pick a saved report (not this one). */
export function ReportSelect({ value, onChange, exclude, ...rest }) {
  const [list, setList] = useState(listCache || []);
  useEffect(() => {
    if (noServer()) return;
    fetch(`${server()}/api/reports`).then(r => (r.ok ? r.json() : [])).then(l => { listCache = Array.isArray(l) ? l : []; setList(listCache); }).catch(() => {});
  }, []);
  const opts = list.filter(r => r.id !== exclude).map(r => ({ value: r.id, label: `${r.name} (${r.id})` }));
  if (value && !opts.some(o => o.value === value)) opts.unshift({ value, label: value });
  return <Select value={value || ''} onChange={onChange} options={opts} allowEmpty {...rest} />;
}

/** Named styles to pick from: the report's own, its stylesheet's and its master's. */
export function useStyleNames() {
  const def = useDesigner(s => s.def);
  const sheet = useReused(def.styles?.sheet);
  const master = useReused(def.master);
  return [...new Set([...Object.keys(master?.styles?.named || {}), ...Object.keys(sheet?.styles?.named || {}), ...Object.keys(def.styles?.named || {})])];
}

/* ---------------------------------------------------------------- report: master and stylesheet */
export function ReuseSection() {
  const T = useT();
  const def = useDesigner(s => s.def);
  const id = useDesigner(s => s.id);
  const master = useReused(def.master);
  const err = useDesigner(s => (def.master ? s.reused[def.master]?.__error : null));
  let hasPlaceholder = false;
  walk(def, (it) => { if (it.type === 'placeholder') hasPlaceholder = true; });
  const setMaster = (v) => apply(d => {
    if (!v) { delete d.master; return; }
    d.master = v;
    // ActiveReports: the master's page header and footer replace the content report's own
    for (const k of ['pageHeader', 'pageFooter']) d.sections[k] = { ...(d.sections[k] || {}), height: 0, items: [] };
  });
  return (
    <div className="cat" data-testid="reuse">
      <CatHead>{T('reuse')}</CatHead>
      <Field label={T('masterReport')} hint={T('masterHint')}>
        <ReportSelect value={def.master} exclude={id} onChange={setMaster} data-testid="master-picker" aria-label={T('masterReport')} />
      </Field>
      {def.master && (master
        ? <div className="hint">{T('masterUsing', { name: master.name || def.master })} <a href={`/designer/${encodeURIComponent(def.master)}`} target="_blank" rel="noreferrer">{T('open')}</a></div>
        : <div className={err ? 'err' : 'hint'}>{err ? T('reusedNotLoaded', { id: def.master, error: err }) : T('loading')}</div>)}
      {!def.master && <div className="hint">{hasPlaceholder ? T('masterIsMaster') : T('masterMakeHint')}</div>}
      <Field label={T('styleSheet')} hint={T('styleSheetHint')}>
        <ReportSelect value={def.styles?.sheet} exclude={id} aria-label={T('styleSheet')} data-testid="sheet-picker"
          onChange={v => apply(d => { d.styles ||= {}; if (v) d.styles.sheet = v; else delete d.styles.sheet; })} />
      </Field>
    </div>
  );
}

/* ---------------------------------------------------------------- report: theme */
export function ThemeSection() {
  const T = useT();
  const def = useDesigner(s => s.def);
  const id = useDesigner(s => s.id);
  const families = useFontFamilies();
  const src = def.theme;
  const [mode, setMode] = useState(!src ? 'own' : String(src).startsWith('=') ? 'expr' : 'report');
  const td = def.themeDef || {};
  const setTd = (fn, key) => apply(d => { d.themeDef ||= {}; fn(d.themeDef); }, key);
  const setSrc = (v) => apply(d => { if (v) d.theme = v; else delete d.theme; }, 'theme.src');
  const font = (k) => ({ ...DEFAULT_THEME.fonts[k], ...(td.fonts?.[k] || {}) });
  const setFont = (k, p, v) => setTd(x => { x.fonts ||= {}; x.fonts[k] ||= {}; if (v === undefined || v === '') delete x.fonts[k][p]; else x.fonts[k][p] = v; }, `theme.font.${k}.${p}`);
  const consts = Object.entries(td.constants || {});
  const [newConst, setNewConst] = useState('');
  return (
    <div className="cat" data-testid="theme">
      <CatHead>{T('theme')}</CatHead>
      <Field label={T('themeSource')}>
        <Select value={mode} aria-label={T('themeSource')} data-testid="theme-source"
          options={[{ value: 'own', label: T('themeOwn') }, { value: 'report', label: T('themeReport') }, { value: 'expr', label: T('themeExpr') }]}
          onChange={v => { setMode(v || 'own'); if (v === 'own' || !v) setSrc(undefined); }} />
      </Field>
      {mode === 'report' && <Field label={T('themeReportPick')}><ReportSelect value={src} exclude={id} onChange={setSrc} data-testid="theme-picker" aria-label={T('themeReportPick')} /></Field>}
      {mode === 'expr' && <Field label={T('themeExprLabel')} hint={T('themeExprHint')}><TextInput mono value={src || ''} onChange={v => setSrc(v ? (v.startsWith('=') ? v : `=${v}`) : undefined)} placeholder={'=IIf(Parameters.Dark, "dark-theme", "light-theme")'} data-testid="theme-expr" aria-label={T('themeExprLabel')} /></Field>}
      <div className="hint">{mode === 'own' ? T('themeOwnHint') : T('themeFallbackHint')}</div>
      <div className="grid2" data-testid="theme-colors">
        {THEME_COLORS.map(k => (
          <Field key={k} label={k}><ColorInput value={td.colors?.[k] ?? DEFAULT_THEME.colors[k]} onChange={v => setTd(x => { x.colors ||= {}; if (v) x.colors[k] = v; else delete x.colors[k]; }, `theme.color.${k}`)} /></Field>
        ))}
      </div>
      {['major', 'minor'].map(k => (
        <div className="grid2" key={k} data-testid={`theme-font-${k}`}>
          <Field label={T(k === 'major' ? 'themeMajorFont' : 'themeMinorFont')}><Select value={font(k).family} options={families} onChange={v => setFont(k, 'family', v)} /></Field>
          <Field label={T('themeFontSize')}><NumberInput value={font(k).size} onChange={v => setFont(k, 'size', v)} /></Field>
          <Field label={T('themeFontWeight')}><Select value={font(k).weight} options={['normal', '600', 'bold']} onChange={v => setFont(k, 'weight', v)} /></Field>
          <Field label={T('themeFontStyle')}><Select value={font(k).style} options={['normal', 'italic']} onChange={v => setFont(k, 'style', v)} /></Field>
        </div>
      ))}
      <div data-testid="theme-constants">
        {consts.map(([name, value]) => (
          <div className="expr-row" key={name}>
            <code style={{ minWidth: 70 }}>{name}</code>
            <TextInput value={value} onChange={v => setTd(x => { x.constants[name] = v; }, `theme.const.${name}`)} aria-label={name} />
            <button type="button" className="btn sm ghost danger" onClick={() => setTd(x => { delete x.constants[name]; })} aria-label={T('remove')}>✕</button>
          </div>
        ))}
        <div className="expr-row">
          <TextInput value={newConst} onChange={v => setNewConst(v.replace(/\W/g, ''))} placeholder={T('themeConstantName')} aria-label={T('themeConstantName')} data-testid="theme-const-name" />
          <button type="button" className="btn sm" disabled={!newConst || td.constants?.[newConst] != null} onClick={() => { setTd(x => { x.constants ||= {}; x.constants[newConst] = ''; }); setNewConst(''); }} data-testid="theme-const-add">{T('themeConstantAdd')}</button>
        </div>
      </div>
      <span className="hint">{T('themeHint')}</span>
    </div>
  );
}

/* ---------------------------------------------------------------- layers */
const TARGETS = ['all', 'screen', 'print', 'export', 'design'];
export function LayersPanel() {
  const T = useT();
  const layers = useDesigner(s => s.def.layers) || [];
  const readOnly = useDesigner(s => s.readOnly);
  const [name, setName] = useState('');
  const set = (fn, key) => apply(d => { d.layers ||= []; fn(d.layers, d); if (!d.layers.length) delete d.layers; }, key);
  const rename = (i, v) => set((l, d) => {
    const old = l[i].name;
    if (!v || l.some((x, k) => k !== i && x.name === v)) return;
    l[i].name = v;
    walk(d, (it) => { if (it.layer === old) it.layer = v; });
  }, `layer${i}.name`);
  const remove = (i) => set((l, d) => { const old = l[i].name; l.splice(i, 1); walk(d, (it) => { if (it.layer === old) delete it.layer; }); });
  return (
    <div className="pane" data-testid="layers">
      <h4>{T('layers')}</h4>
      <div className="pane-body">
        {layers.map((l, i) => (
          <div key={i} className="layer-row" data-layer={l.name}>
            <TextInput value={l.name} onChange={v => rename(i, v.replace(/[^\w -]/g, ''))} aria-label={T('layerName')} readOnly={readOnly} />
            <Check label={T('layerVisible')} checked={l.visible !== false} onChange={v => set(x => { if (v) delete x[i].visible; else x[i].visible = false; })} />
            <Check label={T('layerLocked')} checked={!!l.locked} onChange={v => set(x => { if (v) x[i].locked = true; else delete x[i].locked; })} />
            <Select value={l.target || 'all'} aria-label={T('layerTarget')} options={TARGETS.map(k => ({ value: k, label: T(`layerTarget_${k}`) }))}
              onChange={v => set(x => { if (!v || v === 'all') delete x[i].target; else x[i].target = v; })} data-testid={`layer-target-${l.name}`} />
            {!readOnly && <button type="button" className="btn sm ghost danger" onClick={() => remove(i)} aria-label={`${T('remove')}: ${l.name}`}>✕</button>}
          </div>
        ))}
        {!readOnly && <div className="expr-row">
          <TextInput value={name} onChange={v => setName(v.replace(/[^\w -]/g, ''))} placeholder={T('layerNew')} aria-label={T('layerNew')} data-testid="layer-new" />
          <button type="button" className="btn sm" disabled={!name.trim() || layers.some(l => l.name === name.trim())} data-testid="layer-add"
            onClick={() => { set(l => { l.push({ name: name.trim() }); }); setName(''); }}>{T('layerAdd')}</button>
        </div>}
        <div className="hint">{T('layersHint')}</div>
      </div>
    </div>
  );
}
/** An item's layer in the designer: hidden (not drawn) or locked (drawn, not selectable). */
export function useLayerOf(item) {
  return useDesigner(s => (item.layer ? (s.def.layers || []).find(l => l.name === item.layer) : null));
}
export function LayerField({ item }) {
  const T = useT();
  const layers = useDesigner(s => s.def.layers) || [];
  if (!layers.length) return null;
  return (
    <Field label={T('layer')}>
      <Select value={item.layer} allowEmpty options={layers.map(l => l.name)} data-testid="item-layer" aria-label={T('layer')}
        onChange={v => updateItem(item.id, it => { if (v) it.layer = v; else delete it.layer; })} />
    </Field>
  );
}

/* ---------------------------------------------------------------- report parts */
const partDefaults = (p) => Object.fromEntries((p?.properties || []).filter(q => q?.name).map(q => [q.name, q.default ?? null]));
const byName = (a = [], b = []) => { const names = new Set(b.map(x => x?.name)); return [...a.filter(x => !names.has(x?.name)), ...b]; };

/** Insert a part from a library: linked (an instance) or a copy (independent items that keep PartProperties). */
export async function insertPart(library, part, { section = 'body', x = null, y = null, copy = false, parentId = null } = {}) {
  const l = await fetchReused(library);
  const p = (l?.parts || []).find(q => q.name === part);
  const src = p && findItemNamed(l, p.item);
  if (!src) return null;
  // what the part needs and this report lacks: data sources, data sets, parameters, named styles (as ActiveReports does)
  apply(d => {
    const ds = byName(l.dataSources, d.dataSources), dsets = byName(l.dataSets, d.dataSets), ps = byName(l.parameters, d.parameters);
    if (ds.length !== (d.dataSources || []).length) d.dataSources = ds;
    if (dsets.length !== (d.dataSets || []).length) d.dataSets = dsets;
    if (ps.length !== (d.parameters || []).length) d.parameters = ps;
    const named = l.styles?.named || {};
    for (const k of Object.keys(named)) if (!d.styles?.named?.[k]) { d.styles ||= {}; d.styles.named ||= {}; d.styles.named[k] = named[k]; }
  });
  if (x == null || y == null) {
    const items = secOf(S().def, section)?.items || [];
    x = 0; y = items.length ? Math.ceil(Math.max(...items.map(i => i.y + i.h)) + 8) : 0;
  }
  if (copy) {
    const c = cloneWithIds(src, allNames(S().def));
    delete c.layer;
    const { id: _i, name: _n, type, ...extra } = c;
    return addItem(type, section, x, y, { ...extra, partProps: { ...(src.partProps || {}), ...partDefaults(p) } }, parentId);
  }
  return addItem('part', section, x, y, { library, part, properties: {}, w: src.w, h: src.h }, parentId);
}

/** Turn a linked instance into an independent copy at the same place, keeping its property values. */
export function detachPart(id) {
  const f = findItem(S().def, id);
  const inst = f?.item;
  const l = inst && S().reused[inst.library];
  const p = (l?.parts || []).find(q => q.name === inst.part);
  const src = p && findItemNamed(l, p.item);
  if (!src) return;
  let newId = null;
  apply(d => {
    const g = findItem(d, id);
    if (!g) return;
    const c = cloneWithIds(src, allNames(d));
    Object.assign(c, { x: inst.x, y: inst.y, name: inst.name, partProps: { ...(src.partProps || {}), ...partDefaults(p), ...(inst.properties || {}) } });
    delete c.layer;
    if (inst.layer) c.layer = inst.layer;
    newId = c.id;
    g.list.splice(g.index, 1, c);
  });
  if (newId) S().select({ kind: 'items', ids: [newId] });
}

export function PartsPanel() {
  const T = useT();
  const libs = useDesigner(s => s.def.libraries) || [];
  const id = useDesigner(s => s.id);
  const readOnly = useDesigner(s => s.readOnly);
  const [pick, setPick] = useState('');
  return (
    <div className="pane" data-testid="parts-panel">
      <h4>{T('parts')}
        {libs.length > 0 && <button type="button" className="btn sm ghost" onClick={() => libs.forEach(l => fetchReused(l, true))} title={T('partsReloadHint')}>{T('partsReload')}</button>}
      </h4>
      <div className="pane-body">
        {libs.map(lib => <LibraryParts key={lib} lib={lib} readOnly={readOnly} />)}
        {!readOnly && <div className="expr-row">
          <ReportSelect value={pick} exclude={id} onChange={v => setPick(v || '')} data-testid="library-picker" aria-label={T('libraryPick')} />
          <button type="button" className="btn sm" disabled={!pick || libs.includes(pick)} data-testid="library-add"
            onClick={() => { apply(d => { (d.libraries ||= []).push(pick); }); setPick(''); }}>{T('libraryAdd')}</button>
        </div>}
        <div className="hint">{T('partsHint')}</div>
      </div>
    </div>
  );
}
function LibraryParts({ lib, readOnly }) {
  const T = useT();
  const d = useReused(lib);
  const err = useDesigner(s => s.reused[lib]?.__error);
  const remove = () => apply(x => { x.libraries = (x.libraries || []).filter(l => l !== lib); if (!x.libraries.length) delete x.libraries; });
  return (
    <div className="lib" data-library={lib}>
      <div className="trow"><b className="nm">{d?.name || lib}</b>{!readOnly && <button type="button" className="btn sm ghost danger act" onClick={remove} aria-label={`${T('remove')}: ${lib}`}>✕</button>}</div>
      {!d && <div className={err ? 'err' : 'hint'}>{err ? T('reusedNotLoaded', { id: lib, error: err }) : T('loading')}</div>}
      {d && <ul className="tree">
        {(d.parts || []).map(p => (
          <li key={p.name} className="trow part-chip" draggable={!readOnly} data-part={`${lib}/${p.name}`} title={p.description || T('partDragHint')}
            onDragStart={(e) => { e.dataTransfer.setData(MIME_PART, JSON.stringify({ library: lib, part: p.name })); e.dataTransfer.effectAllowed = 'copy'; }}>
            <span className="nm">{p.label || p.name}</span>
            {!readOnly && <span className="act" style={{ display: 'inline-flex', gap: 2 }}>
              <button type="button" className="btn sm ghost" onClick={() => insertPart(lib, p.name)} data-testid={`part-insert-${p.name}`}>{T('partInsert')}</button>
              <button type="button" className="btn sm ghost" onClick={() => insertPart(lib, p.name, { copy: true })} data-testid={`part-copy-${p.name}`} title={T('partCopyHint')}>{T('partCopy')}</button>
            </span>}
          </li>
        ))}
        {!(d.parts || []).length && <li className="subtle">{T('libraryNoParts')}</li>}
      </ul>}
    </div>
  );
}

/** A property value input by its type. */
function PropValue({ type, value, onChange, placeholder, label }) {
  if (type === 'number') return <NumberInput value={value ?? ''} onChange={onChange} placeholder={placeholder} aria-label={label} />;
  if (type === 'color') return <ColorInput value={value} onChange={onChange} />;
  if (type === 'boolean') return <Select value={value == null ? '' : String(value)} allowEmpty options={['true', 'false']} onChange={v => onChange(v == null ? undefined : v === 'true')} aria-label={label} />;
  return <TextInput value={value ?? ''} onChange={v => onChange(v === '' ? undefined : v)} placeholder={placeholder} aria-label={label} />;
}

/** Inspector for a linked part instance: its property values, detach, reload. */
export function PartInstance({ item }) {
  const T = useT();
  const l = useReused(item.library);
  const err = useDesigner(s => s.reused[item.library]?.__error);
  const p = (l?.parts || []).find(q => q.name === item.part);
  const setProp = (k, v) => updateItem(item.id, it => { it.properties ||= {}; if (v === undefined || v === '') delete it.properties[k]; else it.properties[k] = v; }, `${item.id}.pp.${k}`);
  return (
    <div className="cat" data-testid="part-instance">
      <CatHead>{T('partInstance')}</CatHead>
      <div className={err || (l && !p) ? 'err' : 'hint'}>{err ? T('reusedNotLoaded', { id: item.library, error: err }) : l && !p ? T('partMissing', { part: item.part, library: item.library }) : T('partLinked', { part: p?.label || item.part, library: l?.name || item.library })}</div>
      {(p?.properties || []).map(q => (
        <Field key={q.name} label={q.label || q.name}>
          <PropValue type={q.type} value={item.properties?.[q.name]} placeholder={q.default == null ? '' : String(q.default)} onChange={v => setProp(q.name, v)} label={q.label || q.name} />
        </Field>
      ))}
      <div className="btnrow">
        <button type="button" className="btn sm" disabled={!p} onClick={() => detachPart(item.id)} data-testid="part-detach" title={T('partDetachHint')}>{T('partDetach')}</button>
        <button type="button" className="btn sm ghost" onClick={() => fetchReused(item.library, true)}>{T('partsReload')}</button>
        <a className="btn sm ghost" href={`/designer/${encodeURIComponent(item.library)}`} target="_blank" rel="noreferrer">{T('partOpenLibrary')}</a>
      </div>
    </div>
  );
}

/** Inspector for a detached copy of a part: its property values. */
export function PartValues({ item }) {
  const T = useT();
  const set = (k, v) => updateItem(item.id, it => { it.partProps[k] = v === undefined ? null : v; }, `${item.id}.pv.${k}`);
  return (
    <div className="cat" data-testid="part-values">
      <CatHead>{T('partValues')}</CatHead>
      {Object.entries(item.partProps || {}).map(([k, v]) => (
        <Field key={k} label={k}><PropValue type={typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'string'} value={v} onChange={x => set(k, x)} label={k} /></Field>
      ))}
      <div className="hint">{T('partValuesHint')}</div>
    </div>
  );
}

/** In a library: publish this item as a report part, with properties its expressions read as PartProperties.<name>. */
const PROP_TYPES = ['string', 'number', 'color', 'boolean'];
export function PublishPart({ item }) {
  const T = useT();
  const parts = useDesigner(s => s.def.parts) || [];
  const i = parts.findIndex(p => p.item === item.name);
  const p = parts[i];
  const set = (fn, key) => apply(d => { d.parts ||= []; fn(d.parts); if (!d.parts.length) delete d.parts; }, key);
  const setP = (k, v) => set(l => { if (v === undefined || v === '') delete l[i][k]; else l[i][k] = v; }, `part${i}.${k}`);
  const setQ = (j, k, v) => set(l => { const q = l[i].properties[j]; if (v === undefined || v === '') delete q[k]; else q[k] = v; }, `part${i}.q${j}.${k}`);
  const [newProp, setNewProp] = useState('');
  return (
    <div className="cat" data-testid="publish-part">
      <CatHead>{T('reportPart')}</CatHead>
      <Check label={T('publishPart')} checked={!!p} onChange={on => set(l => {
        if (!on) { l.splice(i, 1); return; }
        let name = item.name, k = 2;
        while (l.some(x => x.name === name)) name = `${item.name}${k++}`;
        l.push({ name, item: item.name, label: item.name, properties: [] });
      })} />
      {p && <>
        <div className="grid2">
          <Field label={T('partName')}><TextInput value={p.name} onChange={v => { if (/^[A-Za-z_]\w*$/.test(v) && !parts.some((x, k) => k !== i && x.name === v)) setP('name', v); }} data-testid="part-name" aria-label={T('partName')} /></Field>
          <Field label={T('partLabel')}><TextInput value={p.label} onChange={v => setP('label', v)} data-testid="part-label" aria-label={T('partLabel')} /></Field>
        </div>
        <Field label={T('partDescription')}><TextInput value={p.description} onChange={v => setP('description', v)} aria-label={T('partDescription')} /></Field>
        <div data-testid="part-properties">
          {(p.properties || []).map((q, j) => (
            <div className="group-card" key={j}>
              <div className="grid2">
                <Field label={T('partPropName')}><TextInput value={q.name} mono readOnly aria-label={T('partPropName')} /></Field>
                <Field label={T('partPropType')}><Select value={q.type || 'string'} options={PROP_TYPES} onChange={v => setQ(j, 'type', v)} aria-label={T('partPropType')} /></Field>
                <Field label={T('partPropLabel')}><TextInput value={q.label} onChange={v => setQ(j, 'label', v)} aria-label={T('partPropLabel')} /></Field>
                <Field label={T('partPropDefault')}><PropValue type={q.type} value={q.default} onChange={v => setQ(j, 'default', v)} label={T('partPropDefault')} /></Field>
              </div>
              <button type="button" className="btn sm ghost danger" onClick={() => set(l => { l[i].properties.splice(j, 1); })}>{T('remove')}</button>
            </div>
          ))}
          <div className="expr-row">
            <TextInput value={newProp} onChange={v => setNewProp(v.replace(/\W/g, ''))} placeholder={T('partPropNew')} aria-label={T('partPropNew')} data-testid="part-prop-new" />
            <button type="button" className="btn sm" disabled={!newProp || (p.properties || []).some(q => q.name === newProp)} data-testid="part-prop-add"
              onClick={() => { set(l => { (l[i].properties ||= []).push({ name: newProp, type: 'string' }); }); setNewProp(''); }}>{T('partPropAdd')}</button>
          </div>
        </div>
        <div className="hint">{T('publishPartHint')}</div>
      </>}
    </div>
  );
}
