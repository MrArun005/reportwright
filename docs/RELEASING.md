# Releasing the npm packages

All `@reportwright/*` packages share one version (the root `package.json`). They are published by
`.github/workflows/publish.yml` with `npm publish --provenance --access public`, in dependency order:
fonts, fonts-cjk, engine, cli, viewer, react, vue, svelte, angular. Provenance (a signed statement that the tarball
was built from this repository by that workflow) only comes from CI. A publish from a laptop has none, and Socket's
supply-chain score is lower without it.

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

Pick one of the two.

**A. Trusted publishing (preferred: no token to leak or rotate).** On npmjs.com, for each package:
package page > Settings > Trusted Publisher > GitHub Actions, then fill in:

- Organization or user: `MrArun005`
- Repository: `reportwright`
- Workflow filename: `publish.yml`
- Environment: leave empty

A trusted publisher can only be added to a package that already exists: publish 0.9.0 by hand first (above).

**B. A token.** On npmjs.com: Access Tokens > Generate New Token > Granular, with read and write on the
`@reportwright` scope. Save it in GitHub: repository Settings > Secrets and variables > Actions > New repository
secret, named `NPM_TOKEN`.

## Each release

1. Bump `version` in the root `package.json`, add the CHANGELOG entry, then run `npm run build:packages`,
   `npx vitest run tests/engine/packages.test.js` and `npm run scan:packages` (all green). Commit and push.
2. On GitHub: Releases > Draft a new release > tag `v<version>` on `main` > Publish release. The workflow builds,
   tests, scans and publishes. Or start it from Actions > Publish to npm > Run workflow.
3. Check each package on npmjs.com shows the "Provenance" badge, and on socket.dev after it rescans (a few minutes).

## By hand (no provenance)

Only for a package's very first publish, or if CI is unavailable:

```bash
npm run build:packages
for p in fonts fonts-cjk engine cli viewer react vue svelte angular; do
  npm publish ./packages/$p --access public --auth-type=web
done
```
