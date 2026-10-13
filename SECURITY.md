# Security policy

## Supported versions

| Version | Supported |
|---|---|
| 1.x | yes (the latest minor) |
| 0.13.x / 0.14 release candidates | security fixes until 1.1.0 |
| < 0.13 | no |

From 1.0, security fixes go to the latest 1.x minor; a security fix may change behaviour in a patch release. `@pagewrightjs/*` (the old name) is not maintained.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private reporting:
[Report a vulnerability](https://github.com/MrArun005/reportwright/security/advisories/new).

Include the package and version, what an attacker controls (the report definition, the data, a parameter, a URL), and
a minimal report or script that shows the problem. You get an answer within 5 working days, and a fix or a plan within
30 days. We credit reporters in the CHANGELOG unless you ask us not to.

## Scope notes for the npm packages

- `@reportwright/engine` evaluates report expressions (`=Fields.x * 2`) in its own interpreter: no `eval`, no
  `new Function`, no access to globals. A report definition that escapes it is a vulnerability.
- The engine makes no network requests of its own. Images and data come through the `fetchImage` / data callbacks you
  pass in; validate URLs there if definitions come from untrusted users.
- Published tarballs are built by `.github/workflows/publish.yml`. npm provenance (checked with `npm audit signatures`)
  needs a public repository; until the repository is public, the packages carry no provenance statement.
