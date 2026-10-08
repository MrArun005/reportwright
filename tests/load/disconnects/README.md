# Disconnect load test (N21 / N22)

A production-shaped check that a streaming PDF server survives users who leave mid-download or stop reading:
a `pg` Pool of 10, a cursor per export released in `finally`, `exportPdfStream` writing to the HTTP response with an
`AbortSignal` tied to the request and `timeoutMs: 30000`. Eight users download ledgers; 10% close the tab mid-download,
5% stop reading with the socket open.

```bash
# Postgres on 127.0.0.1:5433 (user postgres), a pwload database with a tx table:
createdb -h 127.0.0.1 -p 5433 -U postgres pwload
psql -h 127.0.0.1 -p 5433 -U postgres -d pwload -c "create table tx(id int primary key, g text, amount numeric(12,2));
  insert into tx select i, 'G'||(i%7), round((random()*10000)::numeric,2) from generate_series(1,300000) i;"
PORT=7788 node tests/load/disconnects/server.mjs &     # ROOT=<another checkout> to test other code
PORT=7788 DURATION_S=120 node tests/load/disconnects/load.mjs
```

Pass: every pool client acquired is released, no Postgres backend is left `active` or `idle in transaction`, and a
normal request after the load succeeds. Measured 2026-10-09 on an M2 (8 GB):

| | 0.12.1 | after the N21/N22 fixes |
|---|---|---|
| clients acquired / released | 365 / 355 (10 leaked) | 1,905 / 1,905 |
| stuck backends after the load | 10 | 0 |
| a request after the load | fails after 10 s | 288 ms |
| normal downloads | 113 ok, 26 failed | all ok |

The stalling clients ask for 300,000 rows (about 8 MB) so the output fills the socket buffers and really waits.
