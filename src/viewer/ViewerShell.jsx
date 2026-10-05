'use client';
import Link from 'next/link';
import ReportViewer from './ReportViewer.jsx';
import ThemeToggle from '@/theme/ThemeToggle.jsx';
import { t, dirOf, pickLang } from '@/i18n/index.js';

// the browser makes exports itself: it tells the server so they are in the audit log (fire and forget)
const exported = (format, report, parameters) => {
  if (!report) return;
  fetch('/api/audit/export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ report, format, parameters }) }).catch(() => {});
};

export default function ViewerShell({ id, def, params, canEdit = true }) {
  const { lang: langIn, _drill: _d, ...rest } = params || {}; // _drill: the drill-through levels (ReportViewer urlState)
  const lang = pickLang(langIn);
  const q = lang === 'en' ? '' : `?lang=${encodeURIComponent(lang)}`;
  return (
    <div style={{ height: '100%', display: 'grid', gridTemplateRows: 'auto 1fr' }} dir={dirOf(lang)} lang={lang}>
      <div className="dtop">
        <Link href={`/${q}`} className="brand"><i />Pagewright</Link>
        <span style={{ fontWeight: 'var(--fw-strong)' }}>{def.name}</span>
        <div className="spacer" />
        <ThemeToggle />
        {canEdit && <Link className="btn sm" href={`/designer/${id}${q}`}>{t(lang, 'editInDesigner')}</Link>}
      </div>
      <ReportViewer definition={def} reportId={id} params={rest} lang={lang} exportHtmlOptions={{ reportId: id }} onExported={exported} urlState />
    </div>
  );
}
