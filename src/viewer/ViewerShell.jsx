'use client';
import Link from 'next/link';
import ReportViewer from './ReportViewer.jsx';

export default function ViewerShell({ id, def, params }) {
  const { lang, ...rest } = params || {};
  return (
    <div style={{ height: '100%', display: 'grid', gridTemplateRows: 'auto 1fr' }}>
      <div className="dtop">
        <Link href="/" className="brand"><i />Pagewright</Link>
        <span style={{ fontWeight: 600 }}>{def.name}</span>
        <div className="spacer" />
        <Link className="btn sm" href={`/designer/${id}`}>Edit in designer</Link>
      </div>
      <ReportViewer definition={def} reportId={id} params={rest} lang={lang || 'en'} />
    </div>
  );
}
