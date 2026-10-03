'use client';
import { useEffect, useState } from 'react';
import { readPreference, applyPreference } from './theme.js';

const NEXT = { system: 'light', light: 'dark', dark: 'system' };
const LABEL = { system: 'Theme: follows the system', light: 'Theme: light', dark: 'Theme: dark' };

function Icon({ pref }) {
  if (pref === 'light') return <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M7 1v1.6M7 11.4V13M1 7h1.6M11.4 7H13M2.8 2.8l1.1 1.1M10.1 10.1l1.1 1.1M2.8 11.2l1.1-1.1M10.1 3.9l1.1-1.1" stroke="currentColor" strokeWidth="1.3" /></svg>;
  if (pref === 'dark') return <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M11.5 8.6A5 5 0 0 1 5.4 2.5a5 5 0 1 0 6.1 6.1z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>;
  return <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5.3" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M7 1.7a5.3 5.3 0 0 1 0 10.6z" fill="currentColor" /></svg>;
}

/** Cycles system → light → dark. Follows OS changes while on "system". */
export default function ThemeToggle({ className = 'btn sm ghost icon' }) {
  const [pref, setPref] = useState('system');
  useEffect(() => {
    setPref(readPreference());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { if (readPreference() === 'system') applyPreference('system'); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const cycle = () => { const p = NEXT[pref]; applyPreference(p); setPref(p); };
  return (
    <button type="button" className={`${className} theme-toggle`} onClick={cycle} title={LABEL[pref]} aria-label={LABEL[pref]} data-testid="theme-toggle">
      <Icon pref={pref} />
    </button>
  );
}
