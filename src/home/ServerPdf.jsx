'use client';
// The home card's "Server PDF" link: the server renders in the reader's time zone (src/viewer/timeZone.js).
import { useEffect, useState } from 'react';
import { withTimeZone } from '@/viewer/timeZone.js';

export default function ServerPdf({ id, title, children }) {
  const base = `/api/reports/${encodeURIComponent(id)}/pdf`;
  const [href, setHref] = useState(base); // the server render has no browser zone; set after mount
  useEffect(() => setHref(withTimeZone(base)), [base]);
  return <a className="btn sm ghost" href={href} target="_blank" rel="noreferrer" title={title}>{children}</a>;
}
