# Releasing the npm packages

**1.0.0 order.** `@reportwright/pdf@1.0.0` is published first (its own repository). Then, on `release/1.0` before
merging: `npm i -E @reportwright/pdf@1.0.0`, commit `package.json` and `package-lock.json` (the engine, CLI and viewer
pin the installed version through `scripts/build-packages.mjs`), let CI pass, merge, and publish 1.0.0. The branch
pins `0.1.0-beta.15` until then so `npm ci` works in CI.

All `@reportwright/*` packages share one version (the root `package.json`). They are published by
`.github/workflows/publish.yml` with `npm publish --provenance --access public`, in dependency order:
fonts, fonts-cjk, engine, cli, viewer, react, vue, svelte, angular.

**Provenance needs a public repository.** npm's provenance statement (a signed record that the tarball was built from
this repository by that workflow) is generated only for public GitHub repositories. The workflow adds `--provenance`
only when the repository is public (it reads `github.event.repository.private`); while it is private it publishes
without provenance. Do not add a provenance badge or claim to a README until each package on npmjs.com shows
"Provenance" after a release from the public repository.

**The workflow must be on `main`.** GitHub only offers "Run workflow" (and runs release-triggered workflows) for a
workflow file that exists on the default branch. A copy that lives only on a feature branch cannot be dispatched.

**Versions.** The verify and latest jobs accept only a plain `X.Y.Z` version. A pre-release such as `0.14.0-rc.1`
publishes to `next` from the publish job, then stops at verify ("bad version"), so `latest` never moves for it.
Publish release candidates by hand (below) or accept that verify stops.

## The 0.9.0 rename (Pagewright → ReportWright): the owner's steps, in order

The packages moved from `@pagewrightjs/*` to `@reportwright/*`. None of the new packages exist yet, so trusted
publishing (below) can only be added after this first publish.

1. **Create the npm organization** `reportwright` (npmjs.com > your avatar > Add Organization, free plan for public
   packages). The scope is the organization's name.
2. **Rename the GitHub repository** `MrArun005/pagewright` to `MrArun005/reportwright` (Settings > General >
   Repository name). GitHub redirects the old URL; then `git remote set-url origin
   https://github.com/MrArun005/reportwright.git`.
3. **Publish 0.9.0 by hand**, in dependency order (each asks for the web sign-in):

   ```bash
   npm run build:packages && npm run scan:packages
   npm publish ./packages/fonts --access public --auth-type=web
   npm publish ./packages/fonts-cjk --access public --auth-type=web
   npm publish ./packages/engine --access public --auth-type=web
   npm publish ./packages/cli --access public --auth-type=web
   npm publish ./packages/viewer --access public --auth-type=web
   npm publish ./packages/react --access public --auth-type=web
   npm publish ./packages/vue --access public --auth-type=web
   npm publish ./packages/svelte --access public --auth-type=web
   npm publish ./packages/angular --access public --auth-type=web
   ```

4. **Deprecate the old packages** (the message shows on every install of an old package):

   ```bash
   npm deprecate @pagewrightjs/engine "Renamed to @reportwright/engine" --auth-type=web
   npm deprecate @pagewrightjs/viewer "Renamed to @reportwright/viewer" --auth-type=web
   npm deprecate @pagewrightjs/fonts "Renamed to @reportwright/fonts" --auth-type=web
   npm deprecate @pagewrightjs/fonts-cjk "Renamed to @reportwright/fonts-cjk" --auth-type=web
   npm deprecate @pagewrightjs/cli "Renamed to @reportwright/cli" --auth-type=web
   npm deprecate @pagewrightjs/react "Renamed to @reportwright/react" --auth-type=web
   npm deprecate @pagewrightjs/vue "Renamed to @reportwright/vue" --auth-type=web
   npm deprecate @pagewrightjs/svelte "Renamed to @reportwright/svelte" --auth-type=web
   npm deprecate @pagewrightjs/angular "Renamed to @reportwright/angular" --auth-type=web
   ```

   (`@pagewrightjs/fonts-cjk` may never have been published: skip it if npm says it does not exist.)
5. Add the trusted publisher (option A below) to each `@reportwright/*` package, so later releases come from CI
   with provenance.

## One-time setup (the owner)

Trusted publishing (A) is optional; the token (B) is required.

**A. Trusted publishing (preferred: no token to leak or rotate).** On npmjs.com, for each package:
package page > Settings > Trusted Publisher > GitHub Actions, then fill in:

- Organization or user: `MrArun005`
- Repository: `reportwright`
- Workflow filename: `publish.yml`
- Environment: leave empty

A trusted publisher can only be added to a package that already exists: publish 0.9.0 by hand first (above).

**B. A token (required).** The workflow checks for the `NPM_TOKEN` secret first and stops with a clear message if
it is missing; the `latest` job always needs it, because `npm dist-tag` has no trusted publishing.

1. On npmjs.com: your avatar > Access Tokens > Generate New Token. Choose an **Automation** token if your account
   still offers that type; otherwise a Granular token with read and write on the `@reportwright` scope and "Bypass
   two-factor authentication" ticked (CI cannot answer a 2FA prompt). npm has been retiring classic tokens, so the
   granular one is the safe choice.
2. Copy the token (it is shown once).
3. On GitHub: repository Settings > Secrets and variables > Actions > New repository secret. Name: `NPM_TOKEN`,
   value: the token.
4. Rotate it by generating a new token and replacing the secret; then revoke the old one on npmjs.com.

## Each release

1. Bump `version` in the root `package.json`, add the CHANGELOG entry, then run `npm run build:packages`,
   `npx vitest run tests/engine/packages.test.js` and `npm run scan:packages` (all green). Commit and push.
2. On GitHub: Releases > Draft a new release > tag `v<version>` on `main` > Publish release. The workflow builds,
   tests, scans and publishes. Or start it from Actions > Publish to npm > Run workflow.
3. Once the repository is public: check each package on npmjs.com shows "Provenance", then on socket.dev after it rescans
   (a few minutes). While the repository is private this step does not apply.

## By hand (no provenance)

Only for a package's very first publish, or if CI is unavailable:

```bash
npm run build:packages
for p in fonts fonts-cjk engine cli viewer react vue svelte angular create-reportwright; do
  npm publish ./packages/$p --access public --auth-type=web
done
```
