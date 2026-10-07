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
    <div className="vshell" dir={dirOf(lang)} lang={lang}>
      <header className="dtop">
        <Link href={`/${q}`} className="brand"><i />ReportWright</Link>
        <span className="dtop-sep" aria-hidden="true" />
        <h1 className="dtop-title">{def.name}</h1>
        <div className="spacer" />
        <ThemeToggle />
        {canEdit && <Link className="btn sm" href={`/designer/${id}${q}`}>{t(lang, 'editInDesigner')}</Link>}
      </header>
      <main className="vshell-main">
        <ReportViewer definition={def} reportId={id} params={rest} lang={lang} exportHtmlOptions={{ reportId: id }} onExported={exported} urlState />
      </main>
    </div>
    );
}
