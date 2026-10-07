import AuditLog from './AuditLog.jsx';
import { dirOf, pickLang } from '@/i18n/index.js';
import Shell from '@/home/Shell.jsx';
import { AUDIT_TYPES } from '@/server/audit.js';

export const metadata = { title: 'Audit log · ReportWright' };
export const dynamic = 'force-dynamic';

// Admins only (proxy.js). The events come from /api/audit, which checks again.
export default async function AuditPage({ searchParams }) {
  const lang = pickLang((await searchParams)?.lang);
  const days = Number(process.env.PW_AUDIT_RETENTION_DAYS) > 0 ? Number(process.env.PW_AUDIT_RETENTION_DAYS) : 365;
  return (
    <Shell lang={lang} active="audit">
      <main className="home" dir={dirOf(lang)} lang={lang}>
        <AuditLog lang={lang} types={[...AUDIT_TYPES]} retentionDays={days} />
      </main>
    </Shell>
  );
}
