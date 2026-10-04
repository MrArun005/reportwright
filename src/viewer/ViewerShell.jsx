'use client';
import Link from 'next/link';
import ReportViewer from './ReportViewer.jsx';
import ThemeToggle from '@/theme/ThemeToggle.jsx';
import { t, dirOf, pickLang } from '@/i18n/index.js';

export default function ViewerShell({ id, def, params }) {
  const { lang: langIn, ...rest } = params || {};
  const lang = pickLang(langIn);
  const q = lang === 'en' ? '' : `?lang=${encodeURIComponent(lang)}`;
  return (
    <div style={{ height: '100%', display: 'grid', gridTemplateRows: 'auto 1fr' }} dir={dirOf(lang)} lang={lang}>
      <div className="dtop">
        <Link href={`/${q}`} className="brand"><i />Pagewright</Link>
        <span style={{ fontWeight: 'var(--fw-strong)' }}>{def.name}</span>
        <div className="spacer" />
        <ThemeToggle />
        <Link className="btn sm" href={`/designer/${id}${q}`}>{t(lang, 'editInDesigner')}</Link>
      </div>
      <ReportViewer definition={def} reportId={id} params={rest} lang={lang} exportHtmlOptions={{ reportId: id }} />
    </div>
  );
}
