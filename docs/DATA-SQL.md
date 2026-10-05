# SQL data sources

A `sql` source reads a database on the server. The admin sets up each connection; a report names one and can never hold
a host, a user, a password or a file of its own.

```json
{ "type": "sql", "connection": "main", "query": "select region, sum(amount) as amount from sales where year = @year group by region" }
{ "type": "sql", "connection": "main", "procedure": "dbo.sales_by_region", "args": [{ "name": "region", "param": "region" }] }
```

## Connections

`PW_DB_<NAME>` holds the URL. `connection: "main"` reads `PW_DB_MAIN` (any case). The Designer lists names and kinds only.

| Database | URL | Driver (optional dependency) | Tested |
|---|---|---|---|
| SQLite | `sqlite:/path/file.db` | built into Node 22 | live |
| PostgreSQL | `postgres://user:pass@host:5432/db` | `pg` | live (Docker) |
| MySQL / MariaDB | `mysql://user:pass@host:3306/db` | `mysql2` | live (Docker, MySQL 8.4) |
| SQL Server | `mssql://user:pass@host:1433/db?encrypt=false&trustServerCertificate=true&instance=NAME` | `mssql` | live (Azure SQL Edge in Docker) |
| Oracle | `oracle://user:pass@host:1521/SERVICE` | `oracledb` (thin mode: no Instant Client) | **not live-tested**: mocked driver only |
| Snowflake | `snowflake://user:pass@ACCOUNT/DATABASE/SCHEMA?warehouse=WH&role=READER` | `snowflake-sdk` | **not live-tested**: mocked driver only |
| BigQuery | `bigquery://PROJECT?keyFile=/path/key.json&location=US&maxBytes=10000000000` | `@google-cloud/bigquery` | **not live-tested**: mocked driver only |

User names and passwords are percent-decoded. No error a report author sees contains the URL or any part of it.

## What every connection guarantees

- **One read-only SELECT.** The query must start with `SELECT` or `WITH`. Each database adds its own guard (below). Use a
  database user that can only read: the guards are the second line, not the first.
- **Parameters bound by the driver.** `@name` binds the report parameter `name` (`$n` for Postgres, `?` for MySQL,
  Snowflake and BigQuery, `:n` for Oracle, `@pw_n` for SQL Server). A list becomes `in (@list)`; an empty list matches
  nothing. A value never becomes SQL text.
- **Caps on the client.** `limits.rows` (100,000), `limits.bytes` (64 MB of returned values, every type counted) and one
  wall-clock deadline `limits.ms` (30 s) for everything a query does. At a cap the read stops and the request is
  cancelled; at the deadline the caller gets a 504 at once and the request in flight is cancelled.
- **Admin-only connections and procedures.** Query text over 100,000 characters is refused.

## Per database

- **PostgreSQL**: `BEGIN READ ONLY`, the extended protocol (one statement), a cursor read in counted batches,
  `statement_timeout`. The socket's bytes are counted as they arrive: past half the byte cap, or at the deadline, the
  connection is cut and thrown away, so no value is buffered past the cap.
- **MySQL**: a read-only session and transaction, a server-side prepared statement (one statement),
  `sql_select_limit` and `max_execution_time`; the same socket byte count and deadline as Postgres.
- **SQLite**: the file is opened read-only; rows and bytes are counted as they are read. Queries run on the main thread,
  so the deadline cannot stop them and SQLite builds each value in full first: keep SQLite for small local files.
- **SQL Server**: the login is checked before every query (5-second cache) in the connected database and in every other
  database it can enter, `master` and `msdb` included: any role, ownership or right beyond reading (and `SHOWPLAN`)
  refuses the connection, and a `CREATE TABLE` in a rolled-back transaction must fail. Then a T-SQL keyword scan, the
  server's own compile of the exact text (`SHOWPLAN_XML`, streamed, exactly one SELECT), a description of the result
  (`sp_describe_first_result_set`) that bounds the widest row before a byte is read, `TEXTSIZE` at a quarter of the byte
  cap per large value (the driver holds a value up to four times over before it can be measured), xml and CLR columns
  refused, info and error messages counted (at most 1,000), and a transaction that is always rolled back. Give the login
  `db_datareader` plus `GRANT SHOWPLAN` and nothing else.
- **Oracle**: the login is checked before a query (5-second cache): only `CREATE SESSION` and `SELECT`/`READ` grants; any
  other privilege, `EXECUTE` on anything, `EXECUTE` through `PUBLIC` on `UTL_HTTP`, `UTL_TCP`, `UTL_SMTP`, `UTL_MAIL`,
  `UTL_FILE`, `UTL_INADDR`, `DBMS_LDAP`, `HTTPURITYPE`, `DBMS_JAVA`, `DBMS_SCHEDULER`, `DBMS_JOB` or
  `DBMS_BACKUP_RESTORE`, objects of its own, or a visible database link refuse it. The text must be one plain
  `SELECT`/`WITH` (no PL/SQL, `WITH FUNCTION`, `CALL`, `FOR UPDATE`, `@dblink`, `UTL_`/`DBMS_`/`OWA_` names, quoted or
  not; `q'…'` quoting is refused), the server's parse must say SELECT (`getStatementInfo`), and it runs after
  `SET TRANSACTION READ ONLY` and is rolled back. LOBs are measured before they are read; `LONG`, XMLType, JSON, object,
  cursor and vector columns are refused; rows come in batches sized from the widest possible row. The deadline breaks the
  call in flight.
- **Snowflake**: the URL must name a `role` (give it `USAGE` on the warehouse, database and schema and `SELECT`, nothing
  else). The statement check (one statement, no write or session words; `$$` strings refused), `MULTI_STATEMENT_COUNT=1`,
  `STATEMENT_TIMEOUT_IN_SECONDS`, rows streamed and counted, the statement cancelled at a cap or the deadline. Ceiling:
  the SDK downloads a result chunk (and a `VARIANT` up to Snowflake's own 128 MB) before a row of it can be counted.
- **BigQuery**: a dry run first (free): BigQuery's parse must say the statement type is `SELECT` and the bytes it would
  scan must be within `maxBytes` (default 10 GB). The job then runs with `maximumBytesBilled` and a job timeout; pages of
  at most 1,000 rows (and BigQuery's own 10 MB a page) are counted and the job is cancelled at a cap or the deadline. Give
  the service account BigQuery Data Viewer and Job User only.

## Stored procedures

Off by default. `PW_DB_<NAME>_PROCS=dbo.sales_by_region,report.top_customers` lists the procedures a report may call on
that connection; anything else is refused. In the Designer the SQL source then offers **Mode: Stored procedure**, lists
only those, and maps each argument to a report parameter (`region = region`, one per line). Arguments are bound by the
driver; a list parameter is refused. The first result set is the data.

| Database | How it runs | Guard |
|---|---|---|
| SQL Server | `EXEC` with named inputs | rolled-back transaction; the login probe allows `EXECUTE` on the listed procedures in the connected database and nothing else; the same row, byte and time caps; xml/CLR columns refused |
| PostgreSQL | `SELECT * FROM fn(arg => $1, …)` (a set-returning function) | `READ ONLY` transaction: a function that writes fails |
| MySQL | `CALL p(?, …)` | read-only session and transaction: a procedure that writes fails |
| Snowflake | `CALL p(?, …)` | the read-only role |
| Oracle, BigQuery, SQLite | refused | no read-only way to run one |

A procedure can do anything its owner can. List only procedures you trust: the guards above roll back or refuse writes,
but they do not stop reads the login is otherwise allowed to make.
