// A Stryker test runner ("vitest-names"): @stryker-mutator/vitest-runner with test names as vitest 5 matches them.
// The runner picks the tests that cover a mutant by name, joining describe and test names with spaces ("suite test"),
// but vitest 5's testNamePattern matches "suite > test": no test ran, and every mutant survived. Here each space of
// the pattern the runner sets also matches " > " (a test whose name differs only there would run too: harmless).
// Used by stryker.config.mjs (npm run test:mutation).
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { declareFactoryPlugin, PluginKind, tokens, commonTokens } from '@stryker-mutator/api/plugin';
import { INSTRUMENTER_CONSTANTS } from '@stryker-mutator/api/core';

// the runner's own class (its package exports only the plugin list)
const dist = path.dirname(createRequire(import.meta.url).resolve('@stryker-mutator/vitest-runner'));
const { VitestTestRunner } = await import(pathToFileURL(path.join(dist, 'vitest-test-runner.js')).href);

/** "suite test" (escaped) → "suite( | > )test". @param {RegExp | undefined} re */
const widen = (re) => (re instanceof RegExp ? new RegExp(re.source.replace(/ /g, '(?: | > )'), re.flags) : re);

class VitestNamesRunner extends VitestTestRunner {
  async init() {
    await super.init();
    for (const project of this.ctx.projects) {
      let pattern = widen(project.config.testNamePattern);
      Object.defineProperty(project.config, 'testNamePattern', {
        configurable: true,
        enumerable: true,
        get: () => pattern,
        set: (v) => {
          pattern = widen(v);
        },
      });
    }
  }
}

function create(injector) {
  return injector.provideValue('globalNamespace', INSTRUMENTER_CONSTANTS.NAMESPACE).injectClass(VitestNamesRunner);
}
create.inject = tokens(commonTokens.injector);
export const strykerPlugins = [declareFactoryPlugin(PluginKind.TestRunner, 'vitest-names', create)];
