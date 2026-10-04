'use client';
import { useEffect, useState } from 'react';
import { fontFaceCss } from '@/exporters/svg.js';
import { ALL_FONT_KEYS } from '@/engine/text/fonts.js';
import { t } from '@/i18n/index.js';

/** Report fonts for the inline page thumbnails (declared once). */
export function ReportFonts() {
  return <style dangerouslySetInnerHTML={{ __html: fontFaceCss(ALL_FONT_KEYS, '/fonts') }} />;
}

/** First page of a report, drawn by the same engine as the viewer. */
export default function Thumb({ id, name, lang }) {
  const [state, setState] = useState({ svg: null, pages: 0, failed: false });
  useEffect(() => {
    let live = true;
    fetch(`/api/reports/${encodeURIComponent(id)}/thumb`)
      .then(r => (r.ok ? r.text().then(svg => ({ svg, pages: Number(r.headers.get('x-pagewright-pages')) || 0 })) : Promise.reject()))
      .then(s => live && setState({ ...s, failed: false }))
      .catch(() => live && setState({ svg: null, pages: 0, failed: true }));
    return () => { live = false; };
  }, [id]);
  return (
    <div className="thumb" aria-label={t(lang, 'firstPageOf', { name })} role="img">
      {state.svg
        ? <div className="sheet" dangerouslySetInnerHTML={{ __html: state.svg }} />
        : <div className={`sheet blank${state.failed ? ' failed' : ''}`}>{state.failed ? t(lang, 'noPreview') : ''}</div>}
      {state.pages > 0 && <span className="pages">{state.pages === 1 ? t(lang, 'pageOne') : t(lang, 'pageMany', { n: state.pages })}</span>}
    </div>
  );
}
