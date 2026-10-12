// Types for src/index.mjs (hand-written: keep in step with it)
/** [path under ofl/ in google/fonts, file name the engine asks for, sha256] */
export declare const CJK_FONTS: [string, string, string][];
/** the default font folder: REPORTWRIGHT_FONTS_DIR, else $XDG_CACHE_HOME, %LOCALAPPDATA% or ~/.cache + reportwright/fonts-cjk */
export declare function cacheDir(env?: Record<string, string | undefined>, platform?: string, home?: string): string;
/** cacheDir() when this module loaded */
export declare const FONTS_DIR: string;
/** @internal where earlier versions put the fonts (this package's fonts/ folder); still read. Not part of the public API. */
export declare const LEGACY_DIR: string;
/** the path of a downloaded font file (NotoSansJP.ttf…), or undefined when no folder has it */
export declare function fontPath(name: string, dirs?: string[]): string | undefined;
/** download the fonts into dir (SHA-256 checked; files already there and intact are kept); resolves to dir */
export declare function fetchCjkFonts(dir?: string, opt?: { log?: (line: string) => void; fetch?: typeof fetch }): Promise<string>;
