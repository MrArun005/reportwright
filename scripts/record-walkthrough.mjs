// Cinematic automated walkthrough recording for ReportWright
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const outDir = '/Users/arunmallikarjun/Documents/pw-stress/public/videos';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: {
    dir: outDir,
    size: { width: 1440, height: 900 }
  }
});

const page = await context.newPage();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function smoothScroll(distance, steps = 10, interval = 50) {
  for (let i = 0; i < steps; i++) {
    await page.evaluate((d) => window.scrollBy(0, d), distance / steps);
    await sleep(interval);
  }
}

console.log('1. Loading main dashboard...');
await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
await sleep(1500);

// Smooth scroll through template gallery
console.log('2. Touring template gallery...');
await smoothScroll(600, 15, 60);
await sleep(1200);
await smoothScroll(800, 15, 60);
await sleep(1200);
await smoothScroll(-1400, 20, 40);
await sleep(1000);

// 3. Open Visual Designer (sales-dashboard)
console.log('3. Opening Visual Designer (Sales Dashboard)...');
await page.goto('http://localhost:3000/designer/sales-dashboard', { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid=paper]', { timeout: 15000 });
await sleep(2000);

// Hover & click canvas element
const item = page.locator('.box').first();
if (await item.count() > 0) {
  const box = await item.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
    await sleep(600);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(1200);
  }
}

// Switch to Preview
console.log('4. Previewing report in designer...');
const previewBtn = page.getByTestId('tab-preview');
if (await previewBtn.count() > 0) {
  await previewBtn.click();
  await page.waitForSelector('.vpage', { timeout: 15000 });
  await sleep(1500);
  await smoothScroll(500, 12, 60);
  await sleep(1500);
}

// 5. Open SSRS Imported Transcript
console.log('5. Showcasing SSRS Imported Transcript...');
await page.goto('http://localhost:3000/viewer/imported-ssrs-transcript', { waitUntil: 'networkidle' });
await page.waitForSelector('.vpage', { timeout: 15000 }).catch(() => {});
await sleep(2000);
await smoothScroll(600, 12, 60);
await sleep(1500);

// 6. Open Hindi Loan Statement (HarfBuzz Devanagari)
console.log('6. Showcasing Hindi Loan Statement (HarfBuzz WASM)...');
await page.goto('http://localhost:3000/viewer/loan-statement-hindi', { waitUntil: 'networkidle' });
await page.waitForSelector('.vpage', { timeout: 15000 }).catch(() => {});
await sleep(2000);
await smoothScroll(600, 12, 60);
await sleep(1500);

// 7. Open Charts Showcase
console.log('7. Showcasing Vector Charts Suite...');
await page.goto('http://localhost:3000/viewer/charts-showcase', { waitUntil: 'networkidle' });
await page.waitForSelector('.vpage', { timeout: 15000 }).catch(() => {});
await sleep(2000);
await smoothScroll(800, 15, 60);
await sleep(2000);

console.log('Closing browser and saving video...');
await page.close();
const videoPath = await page.video()?.path();
await context.close();
await browser.close();

if (videoPath && fs.existsSync(videoPath)) {
  const destPath = '/Users/arunmallikarjun/Documents/pw-stress/public/reportwright-product-tour.webm';
  fs.copyFileSync(videoPath, destPath);
  console.log('SUCCESS: Video saved to:', destPath);
  console.log('File size:', (fs.statSync(destPath).size / (1024 * 1024)).toFixed(2), 'MB');
} else {
  console.log('Video recording finished at:', outDir);
}
