'use client';
import Link from 'next/link';
import ReportViewer from './ReportViewer.jsx';
import ThemeToggle from '@/theme/ThemeToggle.jsx';

export default function ViewerShell({ id, def, params }) {
  const { lang, ...rest } = params || {};
  return (
    <div style={{ height: '100%', display: 'grid', gridTemplateRows: 'auto 1fr' }}>
      <div className="dtop">
        <Link href="/" className="brand"><i />Pagewright</Link>
        <span style={{ fontWeight: 'var(--fw-strong)' }}>{def.name}</span>
        <div className="spacer" />
        <ThemeToggle />
        <Link className="btn sm" href={`/designer/${id}`}>Edit in designer</Link>
      </div>
      <ReportViewer definition={def} params={rest} lang={lang || 'en'} exportHtmlOptions={{ reportId: id }} />
    </div>
  );
}
