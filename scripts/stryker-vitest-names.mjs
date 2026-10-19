// A Stryker test runner ("vitest-names"): @stryker-mutator/vitest-runner with test names as vitest 5 matches them.
// The runner picks the tests that cover a mutant by name, joining describe and test names with spaces ("suite test"),
// but vitest 5's testNamePattern matches "suite > test": no test ran, and every mutant survived. This one learns each
// test's vitest name in the dry run and asks for that. Used by stryker.config.mjs (npm run test:mutation).
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { declareFactoryPlugin, PluginKind, tokens, commonTokens } from '@stryker-mutator/api/plugin';
import { INSTRUMENTER_CONSTANTS } from '@stryker-mutator/api/core';

// the runner's own files (its package exports only the plugin list)
const dist = path.join(path.dirname(createRequire(import.meta.url).resolve('@stryker-mutator/vitest-runner')));
const { VitestTestRunner } = await import(pathToFileURL(path.join(dist, 'vitest-test-runner.js')).href);
const { collectTestsFromSuite, normalizeTestId } = await import(
  pathToFileURL(path.join(dist, 'vitest-helpers.js')).href
);
const { toRawTestId } = await import(pathToFileURL(path.join(dist, 'test-helpers.js')).href);

/** "suite > inner suite > test", as vitest's -t matches it. */
const vitestName = (t) => {
  const parts = [t.name];
  for (let s = t.suite; s && s.name; s = s.suite) parts.unshift(s.name);
  return parts.join(' > ');
};

class VitestNamesRunner extends VitestTestRunner {
  /** Stryker's test id ("file#suite test") → the same test with its vitest name ("file#suite > test"). */
  names = new Map();
  async dryRun(options) {
    const r = await super.dryRun(options);
    for (const file of this.ctx.state.getFiles()) {
      for (const t of collectTestsFromSuite(file))
        this.names.set(normalizeTestId(toRawTestId(t)), `${t.file?.filepath ?? 'unknown.js'}#${vitestName(t)}`);
    }
    return r;
  }
  async run(opts = {}) {
    if (opts.testIds?.length) opts = { ...opts, testIds: opts.testIds.map((id) => this.names.get(id) ?? id) };
    return super.run(opts);
  }
}

function create(injector) {
  return injector.provideValue('globalNamespace', INSTRUMENTER_CONSTANTS.NAMESPACE).injectClass(VitestNamesRunner);
}
create.inject = tokens(commonTokens.injector);
export const strykerPlugins = [declareFactoryPlugin(PluginKind.TestRunner, 'vitest-names', create)];
