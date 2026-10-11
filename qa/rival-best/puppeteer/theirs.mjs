// Puppeteer's showcase: any HTML/CSS page (gradients, flexbox, rounded corners, shadows) to PDF.
import puppeteer from 'puppeteer';
import { pathToFileURL } from 'node:url';
const b = await puppeteer.launch({ args: ['--no-sandbox'] });
const p = await b.newPage();
await p.goto(pathToFileURL('page.html').href);
await p.pdf({ path: process.env.OUT + '/theirs.pdf', format: 'A4', printBackground: true });
await b.close();
