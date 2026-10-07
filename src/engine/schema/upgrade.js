// @ts-check
// Report definitions by $schema version. Each step takes a definition of one version to the next; readReport runs the
// chain on every stored definition, so an older file keeps working and a change of format is one function here.
// A definition from a newer ReportWright than this one is refused rather than half-read.
// Pure: it transforms the one definition it is given and reads nothing else (no storage, no other reports); the server
// runs it only on a report the reader may open (perms.readReportFor), so its errors are no oracle.
export const CURRENT = 'pagewright/report@1';

/** @type {Record<string, { to: string, up: (def: any) => any }>} from-version → the step to the next */
export const STEPS = {
  // the ReportWright name for the same format (the product was Pagewright until 0.9): read as it is
  'reportwright/report@1': { to: CURRENT, up: (d) => ({ ...d, $schema: CURRENT }) },
  // 'pagewright/report@1': { to: 'pagewright/report@2', up: (d) => ({ ...d, $schema: 'pagewright/report@2' }) },
};

/** A definition as this version reads it. @param {any} def */
export function upgrade(def) {
  if (!def || typeof def !== 'object') return def;
  let d = def;
  for (let i = 0; i < 20 && d.$schema && d.$schema !== CURRENT; i++) {
    const step = STEPS[d.$schema];
    if (!step) {
      const m = /^(?:page|report)wright\/report@(\d+)$/.exec(String(d.$schema));
      if (m && Number(m[1]) > Number(CURRENT.split('@')[1])) throw Object.assign(new Error(`This report was saved by a newer ReportWright (${d.$schema}). Upgrade this server to open it.`), { status: 409 });
      return d; // not a ReportWright schema name: left as it is (validate() reports it)
    }
    d = step.up(d);
  }
  return d;
}
