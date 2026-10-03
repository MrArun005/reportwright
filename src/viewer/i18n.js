// Viewer UI strings. Add a language by adding a table with the same keys.
const STRINGS = {
  en: {
    parameters: 'Parameters', documentMap: 'Document map', run: 'Run', running: 'Running…', runningReport: 'Running the report…',
    firstPage: 'First page', previousPage: 'Previous page', nextPage: 'Next page', lastPage: 'Last page', page: 'Page',
    zoomIn: 'Zoom in', zoomOut: 'Zoom out', fitWidth: 'Fit width', search: 'Search', previousMatch: 'Previous match', nextMatch: 'Next match',
    exporting: 'Exporting…', viewReport: 'View report', didNotRun: 'The report did not run.', true: 'True', false: 'False',
    commaSeparated: 'Values, separated by commas',
    pagesRows: '{pages} pages · {rows} rows · {ms} ms', warnings: '{n} warning(s)',
  },
  hi: {
    parameters: 'पैरामीटर', documentMap: 'दस्तावेज़ मानचित्र', run: 'चलाएँ', running: 'चल रहा है…', runningReport: 'रिपोर्ट चल रही है…',
    firstPage: 'पहला पृष्ठ', previousPage: 'पिछला पृष्ठ', nextPage: 'अगला पृष्ठ', lastPage: 'अंतिम पृष्ठ', page: 'पृष्ठ',
    zoomIn: 'ज़ूम इन', zoomOut: 'ज़ूम आउट', fitWidth: 'चौड़ाई में फ़िट', search: 'खोजें', previousMatch: 'पिछला मिलान', nextMatch: 'अगला मिलान',
    exporting: 'निर्यात हो रहा है…', viewReport: 'रिपोर्ट देखें', didNotRun: 'रिपोर्ट नहीं चली।', true: 'हाँ', false: 'नहीं',
    commaSeparated: 'मान, अल्पविराम से अलग',
    pagesRows: '{pages} पृष्ठ · {rows} पंक्तियाँ · {ms} ms', warnings: '{n} चेतावनी',
  },
};

export const LANGUAGES = Object.keys(STRINGS);

export function t(lang, key, vars) {
  const s = (STRINGS[lang] || STRINGS.en)[key] ?? STRINGS.en[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')) : s;
}
