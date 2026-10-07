#!/usr/bin/env node
// The optional CJK and emoji fonts (OFL), about 40 MB: too large to ship with every install, so they are fetched once
// into public/fonts/cjk (or the folder given), where the engine finds them (src/engine/text/fonts.js, FALLBACK).
//   node scripts/fetch-fonts-cjk.mjs [folder]      (npm run fonts:cjk)
// Without them, Chinese, Japanese, Korean and emoji text draws as boxes, with a warning that says to run this.
// The list, the pinned commit and the hashes live in @reportwright/fonts-cjk (packages/fonts-cjk/src/index.mjs).
import path from 'node:path';
import { fetchCjkFonts } from '../packages/fonts-cjk/src/index.mjs';

const dir = await fetchCjkFonts(path.resolve(process.argv[2] || path.join(import.meta.dirname, '..', 'public', 'fonts', 'cjk')), { log: console.log });
console.log(`CJK and emoji fonts in ${dir}`);
