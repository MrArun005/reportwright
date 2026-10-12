# Users, roles and report permissions

Give each person an account with a role, and control who can see or change each report. Use roles for what a person may do at all. Use report access (folders and grants) for which reports they can see.

## In the UI

Users (admins only, `/admin/users`, nav **Users**):

1. Open **Users**.
2. Under **Add a user**, fill in **Email**, **Role** (viewer, designer or admin), and **Password (at least 10 characters)**.
3. Press **Add user**.
4. In the list, use **Enable** or **Disable**, **Reset password** (enter a new password, then **Save password**), **Allow SSO** or **Delete {email}**.

Report access (home page):

1. Find the report card (or folder) on the home page. Click **Share**.
2. Add a person or a group. Pick the level: **View** (open, run, export), **Edit** (also change and restore), or **Manage** (also share, move and delete).
3. Leave **inherit** on to keep the folder's access too.

Roles are a ceiling: viewers can only view, designers can edit, admins see everything.

## From the CLI

Not available as a `pw` command. The app has a user script, run in the app folder with the same `PW_STORAGE`:

```bash
node scripts/user.mjs add you@example.com admin
```

It asks for the password, or reads `PW_NEW_PASSWORD`.

## Through the API

Needs a session (sign in first) and an `Origin` header on every write. Save the cookie with `-c cookies.txt` at sign-in.

Create a user (admin):

```bash
curl -sS -X POST http://localhost:3000/api/users \
  -b cookies.txt -H "Origin: http://localhost:3000" -H "content-type: application/json" \
  -d '{"email":"ann@acme.com","role":"designer","password":"a-long-password","groups":["finance"]}'
```

Change a user (admin). Fields: `role`, `groups`, `disabled`, `password`, `allowSso`, `resetTwoFactor`, `forgetDevices`, `unlockSignIn`:

```bash
curl -sS -X PATCH http://localhost:3000/api/users/ann@acme.com \
  -b cookies.txt -H "Origin: http://localhost:3000" -H "content-type: application/json" \
  -d '{"role":"viewer","disabled":false}'
```

Share a report with a group (manage on that report):

```bash
curl -sS -X PUT http://localhost:3000/api/reports/<id>/access \
  -b cookies.txt -H "Origin: http://localhost:3000" -H "content-type: application/json" \
  -d '{"grants":[{"to":"group:finance","level":"view"}]}'
```

A grant is `{ "to": "user:ann@acme.com" | "group:finance", "level": "view" | "edit" | "manage" }`. `PUT` on `/api/reports/<id>/access` also takes `folder` and `inherit`. Folders: `GET` and `POST /api/folders` (`{ name, parent? }`), `GET`, `PATCH` and `DELETE /api/folders/<id>`.

## Notes

- Built-in groups: `group:everyone` (every signed-in user), `group:designers` (designers and admins), `group:public` (anonymous viewers embedded from `PW_EMBED_ORIGINS`).
- A report the user may not view is not found (404) on every route. That includes the viewer, exports, thumbnails and subreports.
- A report gets the highest grant on itself, then on its folder and the folders above (while `inherit` is true), then the top-level grants.
- Roles: `viewer`, `designer`, `admin`. Only designers and admins can save a report with SQL or internal data sources.
- Passwords: stored as scrypt hashes. No API returns a hash.
- Groups come from single sign-on at every sign-in (see [sign-in-sso-and-2fa](sign-in-sso-and-2fa.md)).
- Report access is different from the PDF password. See [passwords-and-permissions](passwords-and-permissions.md).
