# Security policy

## Supported versions

| Version | Supported |
|---|---|
| 0.8.x | yes |
| 0.7.x | security fixes until 0.9.0 |
| < 0.7 | no |

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private reporting:
[Report a vulnerability](https://github.com/MrArun005/pagewright/security/advisories/new).

Include the package and version, what an attacker controls (the report definition, the data, a parameter, a URL), and
a minimal report or script that shows the problem. You get an answer within 5 working days, and a fix or a plan within
30 days. We credit reporters in the CHANGELOG unless you ask us not to.

## Scope notes for the npm packages

- `@pagewrightjs/engine` evaluates report expressions (`=Fields.x * 2`) in its own interpreter: no `eval`, no
  `new Function`, no access to globals. A report definition that escapes it is a vulnerability.
- The engine makes no network requests of its own. Images and data come through the `fetchImage` / data callbacks you
  pass in; validate URLs there if definitions come from untrusted users.
- Published tarballs are built by `.github/workflows/publish.yml` with npm provenance; check it with
  `npm audit signatures`.
