'use client';
// Uploaded fonts: the family list for the font pickers, and a small dialog to upload or remove fonts.
import { useState } from 'react';
import { useDesigner } from './store.js';
import { Dialog, Field, Select, TextInput } from './ui.jsx';
import { BUNDLED_FAMILIES } from '@/engine/text/fonts.js';
import { customFonts } from '@/viewer/engineClient.js';

/** Bundled families, then the uploaded ones. */
export function useFontFamilies() {
  const fonts = useDesigner(s => s.fonts);
  return [...BUNDLED_FAMILIES, ...[...new Set(fonts.map(f => f.family))].sort()];
}

const refresh = async () => useDesigner.getState().setUi({ fonts: await customFonts(true) });

export function FontsDialog({ onClose }) {
  const fonts = useDesigner(s => s.fonts);
  const [file, setFile] = useState(null);
  const [family, setFamily] = useState('');
  const [weight, setWeight] = useState('');
  const [style, setStyle] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const upload = async () => {
    if (!file) return;
    setBusy(true); setMsg(null);
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('family', family.trim());
      if (weight) form.set('weight', weight);
      if (style) form.set('style', style);
      const r = await fetch('/api/fonts', { method: 'POST', body: form });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `Upload failed (HTTP ${r.status})`);
      await refresh();
      setMsg({ ok: `Added ${j.family} ${j.weight}${j.style === 'italic' ? ' italic' : ''}. Pick it in Font.` });
      setFile(null); setFamily(''); setWeight(''); setStyle('');
    } catch (e) { setMsg({ error: e.message }); } finally { setBusy(false); }
  };
  const remove = async (f) => {
    const r = await fetch(`/api/fonts/${f.id}`, { method: 'DELETE' });
    if (!r.ok) { setMsg({ error: (await r.json().catch(() => ({}))).error || `HTTP ${r.status}` }); return; }
    await refresh();
  };

  return (
    <Dialog title="Fonts" onClose={onClose} footer={<button className="btn" onClick={onClose}>Close</button>}>
      <div className="hint">Upload a TTF, OTF, WOFF or WOFF2 file (up to 20 MB) to use it in reports. PDFs embed only the characters a report uses. Hindi, Arabic and Hebrew work in every font: a bundled Noto font draws what the chosen font lacks. For Chinese, Japanese or Korean, upload a font that has those characters.</div>
      <Field label="Font file">
        <input className="input" type="file" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" aria-label="Font file"
          onChange={e => setFile(e.target.files?.[0] || null)} />
      </Field>
      <div className="grid2">
        <Field label="Family" hint="Empty: the name in the font"><TextInput value={family} onChange={setFamily} placeholder="e.g. Brand Sans" aria-label="Family" /></Field>
        <Field label="Weight" hint="Empty: from the font"><Select value={weight} onChange={v => setWeight(v || '')} allowEmpty options={['100', '200', '300', '400', '500', '600', '700', '800', '900']} aria-label="Weight" /></Field>
        <Field label="Style"><Select value={style} onChange={v => setStyle(v || '')} allowEmpty options={['normal', 'italic']} aria-label="Style" /></Field>
      </div>
      <div className="btnrow"><button className="btn primary" disabled={!file || busy} onClick={upload}>{busy ? 'Uploading…' : 'Upload font'}</button></div>
      {msg?.error && <div className="err" role="alert">{msg.error}</div>}
      {msg?.ok && <div className="hint" role="status">{msg.ok}</div>}
      {fonts.length > 0 && <h5 style={{ margin: '8px 0 0' }}>Uploaded</h5>}
      {fonts.map(f => (
        <div className="ver-row" key={f.id}>
          <span>{f.family} <span className="hint">· {f.weight}{f.style === 'italic' ? ' italic' : ''} · {(f.bytes / 1024).toFixed(0)} KB</span></span>
          <span className="btnrow"><button className="btn sm" onClick={() => remove(f)} aria-label={`Remove ${f.family} ${f.weight}`}>Remove</button></span>
        </div>
      ))}
    </Dialog>
  );
}
