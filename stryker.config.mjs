// Mutation testing of the designer store and the schema validator: npm run test:mutation (not part of CI; it takes a while).
// The score says how many small changes to these files (a flipped condition, a removed line) some test notices.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  mutate: ['src/designer/store.js', 'src/engine/schema/validate.js'],
  // the vitest runner, with test names as vitest 5 matches them (scripts/stryker-vitest-names.mjs says why)
  plugins: ['@stryker-mutator/vitest-runner', './scripts/stryker-vitest-names.mjs'],
  testRunner: 'vitest-names',
  vitest: { configFile: process.env.STRYKER_VITEST || 'vitest.mutation.config.mjs', related: false },
  coverageAnalysis: 'perTest',
  concurrency: Number(process.env.STRYKER_CONCURRENCY) || 3,
  timeoutMS: 20000,
  ignoreStatic: true,
  disableTypeChecks: false,
  reporters: ['clear-text', 'progress', 'json'],
  jsonReporter: { fileName: process.env.STRYKER_JSON || 'reports/mutation/mutation.json' },
  tempDirName: '.stryker-tmp',
  ignorePatterns: ['.next', 'dist-site', 'reports/mutation', 'test-results', 'pw-worker', '*.tgz'],
};
