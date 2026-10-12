# Data sources (JSON, REST, GraphQL, CSV, XML, SOAP, OData, SQL, pushed data)

Feed a report from where the data lives. A report can read inline JSON, a web API, a file, a database, or data your system pushes with each request.

## In the UI

Designer (`/designer/<id>`):

1. Open the **Data** panel.
2. Add a data source. In the source dialog, pick the **Source** type.
3. For a web source, enter the URL. Press **Explore the response**. Every list in the response is shown with its path, row count and fields. Press **Use** on the one you want. Nested lists get `[*]` paths.
4. For SQL, pick a connection set up on the server, press **Test** (a read-only `select 1`), and write a `SELECT` with `@parameter` placeholders.
5. For OData, press **Read $metadata** to list the entity sets and their properties.

Source types in the designer include XML, SOAP web service and OData service (the labels in the designer's language files), plus JSON, REST, GraphQL, CSV and SQL.

## From the CLI

```bash
pw render orders.pw.json -d orders=orders.json -f pdf -o orders.pdf
pw render orders.pw.json -d orders=orders.json -d customers=customers.json -f csv -o orders.csv
```

- `-d source=data.json`: replaces the data source named `source` with the JSON in the file. Repeat `-d` for more sources.
- A report with a remote URL needs a server. Pass `--base http://localhost:3000` (the CLI error says so), or push the data with `-d`.
- `--allow-internal`: lets the `--base` host be a local or private address.

## Through the API

Needs an API key. Send `data` in the body of `POST /api/v1/render`. The name is the data source's name. It replaces that source:

```bash
curl -sS -X POST http://localhost:3000/api/v1/render \
  -H "x-api-key: $PW_API_KEY" \
  -H "content-type: application/json" \
  -d '{"template":"loan-statement","format":"pdf","parameters":{"accountId":"LN-2025-001982"},"data":{"loan":{"id":"LN-2025-001982","rows":[{"due":"2026-01-05","amount":1200}]}}}' \
  -o statement.pdf
```

Pushed data (render and batch items) needs a designer or a service key (`docs/API.md`, Batches).

## Notes

- SQL: `connection: 'main'` reads the server variable `PW_DB_MAIN`. A report never holds a host or a password. `@name` binds a report parameter, so values never go into the SQL text.
- SQL rules: one `SELECT` (or `WITH … SELECT`), read-only transaction, 30 s, 100,000 rows (`docs/API.md`, `docs/CONFIG.md`).
- Released SQL drivers per `docs/FEATURES.md`: SQLite and MySQL. `docs/FEATURES.md` marks PostgreSQL, SQL Server, Oracle, Snowflake and BigQuery as not released. (`README.md` lists them without that mark. See the open question in the index.)
- Data URLs are fixed by default in production (`PW_FIXED_FETCH_HOSTS`): write the host out, and let parameters fill only the path and query.
- A REST source may only GET from this server (or a public host through `useProxy`).
- XML is read without DTDs. SOAP sends `{Parameters.x}` XML-escaped.
- Details: [docs/DATA-SQL.md](../DATA-SQL.md), [docs/CONFIG.md](../CONFIG.md).
