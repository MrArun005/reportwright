// @font-face rules for the app interface: IBM Plex Sans, Plex Mono, Plex Sans Devanagari (OFL).
// app/globals.css holds the same rules with base ''. The embed bundle calls this with the server URL.
const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
const DEVANAGARI = 'U+0900-097F,U+1CD0-1CF9,U+200C-200D,U+20A8,U+20B9,U+20F0,U+25CC,U+A830-A839,U+A8E0-A8FF';

const face = (family, file, weight, range, base) =>
  `@font-face{font-family:"${family}";src:url("${base}/fonts/ui/${file}.woff2") format("woff2");font-weight:${weight};font-style:normal;font-display:swap;unicode-range:${range}}`;

export function uiFontCss(base = '') {
  const out = [];
  for (const w of [400, 500, 600]) {
    out.push(face('PW UI', `ibm-plex-sans-latin-${w}-normal`, w, LATIN, base));
    out.push(face('PW UI', `ibm-plex-sans-latin-ext-${w}-normal`, w, LATIN_EXT, base));
  }
  for (const w of [400, 600]) {
    out.push(face('PW UI', `ibm-plex-sans-devanagari-devanagari-${w}-normal`, w, DEVANAGARI, base));
    out.push(face('PW Mono', `ibm-plex-mono-latin-${w}-normal`, w, LATIN, base));
    out.push(face('PW Mono', `ibm-plex-mono-latin-ext-${w}-normal`, w, LATIN_EXT, base));
  }
  return out.join('\n');
}
