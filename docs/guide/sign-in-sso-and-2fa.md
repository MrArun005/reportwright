# Sign-in, single sign-on and two-factor sign-in

Let people sign in with a password, with your company login (OpenID Connect or SAML 2.0), or with a code from an authenticator app. Use single sign-on so people use the accounts they already have. Use two-factor sign-in for admins and designers.

## In the UI

Password sign-in:

1. Open `/login`.
2. Enter **Email** and **Password**. Press **Sign in**.

Single sign-on:

1. On `/login`, press the **Sign in with {name}** button. The name is `PW_OIDC_NAME` or `PW_SAML_NAME` (defaults: "Single sign-on" or "SAML single sign-on").
2. If password sign-in is also on, **or with a password** separates the two.

Turn on two-factor sign-in (your own account):

1. Open your account page (`/account`). Find **Two-factor sign-in**.
2. Press **Turn on two-factor sign-in**. Scan the QR code with an authenticator app, then enter the 6-digit code and press **Confirm**.
3. Save the **Your recovery codes** shown once.

Require it for a role (admin):

1. Open **Settings** and set **Require two-factor sign-in for these roles**.

## From the CLI

Not available in the CLI.

## Through the API

Password sign-in (keeps the session cookie in `cookies.txt`):

```bash
curl -sS -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "content-type: application/json" -H "Origin: http://localhost:3000" \
  -d '{"email":"ann@acme.com","password":"a-long-password"}'
```

If the account has two-factor sign-in, the answer is `{ "mfa": "totp" }` and a `pw_mfa` cookie. Send the code:

```bash
curl -sS -b cookies.txt -c cookies.txt -X POST http://localhost:3000/api/auth/mfa \
  -H "content-type: application/json" -H "Origin: http://localhost:3000" \
  -d '{"code":"123456"}'
```

Use `{ "recoveryCode": "…" }` instead of `code` for a recovery code.

Turn two-factor on or off for your own account: `POST /api/account/2fa` with `{ "action": "setup" | "enable" | "recovery" | "disable", "code"? }`.

Password reset: `POST /api/auth/reset/request` with `{ "email" }` (always `202`), then `POST /api/auth/reset/confirm` with `{ "token", "password" }`.

Sign out: `POST /api/auth/logout`.

## Notes

Single sign-on settings (`docs/API.md`, `docs/CONFIG.md`):

| Setting | What it does |
|---|---|
| `PW_OIDC_ISSUER`, `PW_OIDC_CLIENT_ID`, `PW_OIDC_CLIENT_SECRET` | OpenID Connect. Register `https://<PW_BASE_URL>/api/auth/oidc/callback` as the redirect URI. |
| `PW_SAML_ENTRY_POINT`, `PW_SAML_IDP_CERT` (or `PW_SAML_IDP_CERT_FILE`), `PW_SAML_IDP_ISSUER` | SAML 2.0. SP metadata at `/api/auth/saml/metadata`. ACS at `/api/auth/saml/acs`. |
| `PW_SSO_ROLE_MAP` | IdP group to role, for example `idp-admins=admin,idp-designers=designer`. |
| `PW_SSO_DEFAULT_ROLE` | `viewer` (default), `designer`, `admin`, or `none` to refuse sign-in. |
| `PW_PASSWORD_LOGIN=off` | Turns off password sign-in. |
| `PW_SSO_ALLOWED_DOMAINS` | Only these email domains may sign in with SSO. |
| `PW_BASE_URL` | Set it. The redirect URI, ACS and audience come from it. |

- An account made by SSO is bound to the identity, not the email.
- SSO never takes over a password account by itself. An admin presses **Allow SSO** on that user first.
- Two-factor sign-in needs `PW_DATA_KEY` (32+ characters) in production. It seals the TOTP secrets.
- Sign-in attempts are rate limited: 10 failures in 15 minutes per source and email, then 429 for that source. See `README.md`, Users and roles.
- SAML single logout and OIDC logout are described in `docs/GOVERNANCE.md`.
