# Digital signatures

Sign a PDF with a certificate on the server, so readers can check it has not changed since it was made. Use it for documents that need proof of origin.

## In the UI

Not available in the UI.

## From the CLI

Not available in the CLI. The `pw` command has no signing option.

## Through the API

Needs an API key, and the server must have a signing certificate set (see Notes). Add `"sign": true` to the body of `POST /api/v1/render`. Batches and schedules accept it too.

```bash
curl -sS -X POST http://localhost:3000/api/v1/render \
  -H "x-api-key: $PW_API_KEY" \
  -H "content-type: application/json" \
  -d '{"template":"loan-statement","format":"pdf","parameters":{"accountId":"LN-2025-001982"},"sign":true}' \
  -D headers.txt -o statement-signed.pdf
```

Response: the signed PDF. A `sign` request on a server with no certificate is refused.

## Notes

- Set `PW_SIGN_P12` (path to a PKCS#12 `.p12` file) and `PW_SIGN_PASSWORD` (its password) on the server. See [docs/CONFIG.md](../CONFIG.md).
- The signature is `adbe.pkcs7.detached` over the whole file. Poppler `pdfsig` reports "Signature is Valid" (`README.md`).
- It is not a PAdES baseline signature. It has no signing-certificate attribute and no timestamp.
- Signing is refused with `pdfa` or a password (400).
- Only API-key routes sign. A keyless request cannot sign.
