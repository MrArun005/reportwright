'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** On/off for one schedule, through the Schedules page's API (/api/schedules checks the owner again). */
export default function ScheduleToggle({ id, on, label }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const flip = async () => {
    setBusy(true);
    const res = await fetch(`/api/schedules/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: !on }) }).catch(() => null);
    setBusy(false);
    if (res?.ok) return router.refresh();
    window.alert((await res?.json().catch(() => null))?.error || `HTTP ${res?.status ?? '—'}`); // ponytail: plain alert; the Schedules page has the full form
  };
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="switch" disabled={busy} onClick={flip}><i /></button>;
}
