// UI strings for batch 2 (Designer and viewer upgrade, accessibility, phone). Merged into each language by index.js.
// One row per key, in the order of LANGS; the same placeholders in every language.
const LANGS = ['en', 'hi', 'es', 'fr', 'de', 'ja', 'zh', 'pt-BR', 'ar'];
const ROWS = {
  b2_skipBlank: ['Skip when the parameter is blank', 'पैरामीटर खाली हो तो छोड़ें', 'Omitir si el parámetro está vacío', 'Ignorer si le paramètre est vide', 'Überspringen, wenn der Parameter leer ist', 'パラメーターが空のときはスキップ', '参数为空时跳过', 'Ignorar quando o parâmetro estiver vazio', 'تخطَّ عندما تكون المعلمة فارغة'],
};
export default Object.fromEntries(LANGS.map((l, i) => [l, Object.fromEntries(Object.entries(ROWS).map(([k, v]) => [k, v[i]]))]));
