// @ts-check
/** Set or clear one key of a definition's `export` (the designer's Report properties); no empty object is left. @param {any} def @param {'html'|'drillLinks'} k @param {string} v */
export function setExport(def, k, v) {
  if (v) { def.export ||= {}; def.export[k] = v; } else if (def.export) { delete def.export[k]; if (!Object.keys(def.export).length) delete def.export; }
}
