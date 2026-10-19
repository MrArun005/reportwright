// The designer's browser specs (tests/e2e/designer-*.spec.js) in Chromium, Firefox and WebKit: npx playwright test.
// They mount the designer and the viewer from public/embed/esm (npm run build:packages first): no server needed.
// The other tests/e2e/*.mjs suites are plain scripts (npm run test:e2e) and are not run here.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: /designer-.*\.spec\.js$/,
  outputDir: 'test-results/e2e',
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'test-results/e2e-report' }]] : 'list',
  use: { screenshot: 'only-on-failure', trace: 'retain-on-failure', viewport: { width: 1500, height: 1000 } },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1500, height: 1000 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1500, height: 1000 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1500, height: 1000 } } },
  ],
});
