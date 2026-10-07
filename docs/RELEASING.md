# Releasing the npm packages

All `@pagewrightjs/*` packages share one version (the root `package.json`). They are published by
`.github/workflows/publish.yml` with `npm publish --provenance --access public`, in dependency order:
fonts, fonts-cjk, engine, cli, viewer, react, vue, svelte, angular. Provenance (a signed statement that the tarball
was built from this repository by that workflow) only comes from CI. A publish from a laptop has none, and Socket's
supply-chain score is lower without it.

## One-time setup (the owner)

Pick one of the two.

**A. Trusted publishing (preferred: no token to leak or rotate).** On npmjs.com, for each package:
package page > Settings > Trusted Publisher > GitHub Actions, then fill in:

- Organization or user: `MrArun005`
- Repository: `pagewright`
- Workflow filename: `publish.yml`
- Environment: leave empty

A trusted publisher can only be added to a package that already exists. `@pagewrightjs/fonts-cjk` has never been
published, so publish it once by hand first (see below) or use option B for the first release.

**B. A token.** On npmjs.com: Access Tokens > Generate New Token > Granular, with read and write on the
`@pagewrightjs` scope. Save it in GitHub: repository Settings > Secrets and variables > Actions > New repository
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
