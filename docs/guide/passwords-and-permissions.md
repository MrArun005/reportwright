# PDF passwords and permissions

Protect a PDF with a password. Set who may open it, and which actions are taken away (print, copy, edit). Use it for statements and payslips sent by email or download.

## In the UI

Not available in the UI. The viewer's **Export options** only offer PDF/A, PDF/UA, Excel formulas and the HTML kind. Use the CLI or the API.

## From the CLI

```bash
pw render orders.pw.json -d orders=orders.json --password s3cret --deny copy -o locked.pdf
pw render statement.pw.json -p accountId=LN-1 --owner-password 'boss' --deny copy --deny modify -o out.pdf
```

- `--password PW`: the password needed to open the file (the user password). Leave it out and anyone can open the file, but the permissions still apply.
- `--owner-password PW`: the password that changes the rules. If you leave it out, a random one is used that nobody knows.
- `--deny NAME`: takes away one permission. Repeat it for more. Names: `print`, `printHighQuality`, `modify`, `copy`, `annotate`, `fillForms`, `accessibility`, `assemble`.
- Only `-f pdf`. Not valid with `--pdfa`.

## Through the API

Needs an API key. Add a `pdf` object to the body of `POST /api/v1/render`:

```bash
curl -sS -X POST http://localhost:3000/api/v1/render \
  -H "x-api-key: $PW_API_KEY" \
  -H "content-type: application/json" \
  -d '{"template":"loan-statement","format":"pdf","parameters":{"accountId":"LN-2025-001982"},"pdf":{"userPassword":"to open it","ownerPassword":"to change the rules","permissions":{"copy":false,"modify":false}}}' \
  -o locked.pdf
```

- `userPassword`: to open. `''` or left out: anyone can open it.
- `ownerPassword`: to change the rules. Left out: a random one.
- `permissions`: each permission is allowed unless you set it to `false`. Same names as the CLI.

Response: the encrypted PDF. A password is never written in an error message.

## Notes

- The file is AES-256 (PDF 2.0 standard security handler, revision 6). Acrobat X and later, pdf.js, poppler and macOS Preview open it.
- Passwords are Unicode (NFKC-normalised) and at most 127 bytes in UTF-8. A longer password is refused, not cut.
- A password cannot go with `pdfa` or `sign`. Both are refused with 400.
- Report access (who may view or edit a report) is a different thing. See [users-roles-and-permissions](users-roles-and-permissions.md).
