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

## What the safety rests on

**The login's verified privileges.** Before it runs report queries (and again every few seconds), Pagewright asks the
database what the connection's login may do: every effective privilege, role (followed recursively) and grant, PUBLIC's
included. Anything outside a short allow-list (connect, read, the database's harmless defaults) refuses the connection,
and an error in the check refuses it too. This is the release criterion for each database; see
[Logins](#logins-the-exact-setup) for the setup each one accepts.

**Defence in depth, not the guarantee:** the statement check (`src/server/sql/check.js`) allows one `SELECT`/`WITH`
whose every call is a built-in function on the dialect's list (an unknown, quoted or schema-qualified function is
refused), and it fails closed on anything it does not fully classify (nested comments, optimizer hints, `{fn }`
escapes, characters outside ASCII in code, dollar-quoting, `E''`/`U&''` strings, backslashes where the server's settings
decide what they mean). No scanner reads SQL exactly as every server does, so it is a second guard; so are the read-only
transactions, the server-side parse checks and BigQuery's dry run.

## What every connection guarantees

- **One read-only SELECT.** The query must start with `SELECT` or `WITH` and pass the statement check. Each database adds
  its own guard (below).
- **Parameters bound by the driver.** `@name` binds the report parameter `name` (`$n` for Postgres, `?` for MySQL,
  Snowflake and BigQuery, `:n` for Oracle, `@pw_n` for SQL Server). A list becomes `in (@list)`; an empty list matches
  nothing. A value never becomes SQL text.
- **Caps on the client.** `limits.rows` (100,000, `PW_SQL_MAX_ROWS`), `limits.bytes` (64 MB of returned values, every
  type counted, `PW_SQL_MAX_MB`) and one wall-clock deadline `limits.ms` (30 s, `PW_SQL_TIMEOUT_MS`) for everything a
  query does. Each pool holds at most `PW_DB_POOL_MAX` connections (default 5) per server thread. At a cap the read stops and the request is
  cancelled; at the deadline the caller gets a 504 at once and the request in flight is cancelled.
- **Admin-only connections and procedures.** Query text over 100,000 characters is refused.

## Per database

- **PostgreSQL**: the login check (above), then `BEGIN READ ONLY`, the extended protocol (one statement), a cursor read
  in counted batches with `statement_timeout` set again before each batch. The socket's bytes are counted as they
  arrive: past half the byte cap, or at the deadline, the backend is terminated from another connection
  (`pg_terminate_backend`; a dropped socket alone does not stop a running query) and the connection thrown away. Only
  plain scalar types are parsed; json, jsonb, arrays and the rest stay text.
- **MySQL**: the login check (above), a read-only session and transaction, a server-side prepared statement (one
  statement), `sql_select_limit` and `max_execution_time`; the same socket byte count, and at a cap or the deadline the
  thread is killed from another connection (`KILL`: an optimizer hint or a `CALL` is not bound by `max_execution_time`).
  JSON stays text, geometry bytes.
- **SQLite**: each query runs in a child process (`src/server/sql/sqlite.js`), never on a server thread: the file is
  opened read-only, rows and bytes are counted as they are read, the deadline kills the process, its memory is watched
  while it runs (`PW_SQLITE_MEMORY_MB`, default 1024, also its heap limit) and a value too large for Node (a
  `printf('%.*c', 900000000, 'x')`) ends only that process. At most `PW_SQLITE_PROCESSES` (default 2) run at once per
  server thread. `zeroblob` and `randomblob` are refused by the statement check. Node 22 has no `sqlite3_limit()`: the
  query text is capped at 100,000 characters before it is sent, bound variables by SQLite's own 32,766.
- **SQL Server**: the login is checked before every query (5-second cache) in the connected database and in every other
  database it can enter, `master` and `msdb` included: any role, ownership or right beyond reading (and `SHOWPLAN`)
  refuses the connection, and a `CREATE TABLE` in a rolled-back transaction must fail. Then a T-SQL keyword scan, the
  server's own compile of the exact text (`SHOWPLAN_XML`, streamed, exactly one SELECT), a description of the result
  (`sp_describe_first_result_set`) that bounds the widest row before a byte is read, `TEXTSIZE` at a quarter of the byte
  cap per large value (the driver holds a value up to four times over before it can be measured), xml and CLR columns
  refused, info and error messages counted (at most 1,000), and a transaction that is always rolled back. Give the login
  `db_datareader` plus `GRANT SHOWPLAN` and nothing else.
- **Oracle**: the login check (above); the text must be one plain `SELECT`/`WITH` with built-in functions only (no
  PL/SQL, `WITH FUNCTION`, `CALL`, `FOR UPDATE`, `@dblink`, package calls; `q'…'` quoting and hints refused), the
  server's parse must say SELECT (`getStatementInfo`), and it runs after `SET TRANSACTION READ ONLY` and is rolled back.
  LOBs are measured before they are read; `LONG`, XMLType, JSON, object, cursor and vector columns are refused; rows come
  in batches sized from the widest possible row. The deadline breaks the call in flight.
- **Snowflake**: the URL must name a `role`; the role check (above, after `USE SECONDARY ROLES NONE`, once a minute);
  the statement check (`$$` strings and `@stage` refused), `MULTI_STATEMENT_COUNT=1`, `STATEMENT_TIMEOUT_IN_SECONDS`,
  rows streamed and counted, the statement cancelled at a cap or the deadline; VARIANT, OBJECT and ARRAY stay text.
  Ceiling: the SDK downloads a result chunk before a row of it can be counted.
- **BigQuery**: a dry run first (free): BigQuery's parse must say the statement type is `SELECT` and the bytes it would
  scan must be within `maxBytes` (default 10 GB). The job then runs with `maximumBytesBilled` and a job timeout; pages of
  at most 1,000 rows (and BigQuery's own 10 MB a page) are counted and the job is cancelled at a cap or the deadline. Give
  the service account BigQuery Data Viewer and Job User only.

## Logins: the exact setup

| Database | Accepted | Refused (examples) |
|---|---|---|
| SQL Server | `CREATE LOGIN rep WITH PASSWORD = '…'; USE sales; CREATE USER rep FOR LOGIN rep; ALTER ROLE db_datareader ADD MEMBER rep; GRANT SHOWPLAN TO rep;` Database rights exactly CONNECT, SELECT, SHOWPLAN and the two default `VIEW ANY COLUMN … KEY DEFINITION`; server rights CONNECT SQL, VIEW ANY DATABASE (CONNECT ANY DATABASE, SELECT ALL USER SECURABLES); schema rights SELECT only; checked in every database the login can enter, `master` and `msdb` included | any role but db_datareader, any other right (VIEW SERVER STATE, VIEW DATABASE STATE, ALTER, EXECUTE, IMPERSONATE…), ownership of anything, WITH GRANT OPTION, linked servers, `xp_cmdshell`, ad hoc distributed queries; a `CREATE TABLE` must fail |
| PostgreSQL | `CREATE ROLE rep LOGIN PASSWORD '…'; GRANT CONNECT ON DATABASE sales TO rep; GRANT USAGE ON SCHEMA public TO rep; GRANT SELECT ON ALL TABLES IN SCHEMA public TO rep; REVOKE CREATE ON SCHEMA public FROM PUBLIC; REVOKE CREATE ON DATABASE sales FROM PUBLIC;` (optionally `GRANT pg_read_all_data TO rep`) | superuser, CREATEROLE, CREATEDB, REPLICATION, BYPASSRLS; any other role (pg_read_server_files, pg_execute_server_program, pg_database_owner…); any extension but plpgsql (dblink, postgres_fdw, file_fdw…); CREATE on any schema or the database; owning anything; INSERT/UPDATE/DELETE/TRUNCATE/TRIGGER/REFERENCES on any table |
| MySQL | `CREATE USER 'rep'@'%' IDENTIFIED BY '…'; GRANT SELECT ON sales.* TO 'rep'@'%';` (`SHOW VIEW` too; `GRANT EXECUTE ON PROCEDURE sales.p` for a listed procedure) | every other `SHOW GRANTS` line: FILE, PROCESS, SUPER, any write right, a granted role, WITH GRANT OPTION |
| Oracle | `CREATE USER rep IDENTIFIED BY "…"; GRANT CREATE SESSION TO rep; GRANT SELECT ON sales.orders TO rep;` and `REVOKE EXECUTE ON UTL_HTTP FROM PUBLIC` (and `UTL_TCP`, `UTL_SMTP`, `UTL_MAIL`, `UTL_FILE`, `UTL_INADDR`, `DBMS_LDAP`, `HTTPURITYPE`, `DBMS_JAVA`, `DBMS_SCHEDULER`, `DBMS_JOB`, `DBMS_BACKUP_RESTORE` where PUBLIC has them) | any system privilege but CREATE SESSION; any grant to the user, its roles or PUBLIC other than SELECT/READ on a table or view (EXECUTE on anything, READ on a DIRECTORY; PUBLIC's EXECUTE on Oracle's own packages is the install default); owning objects; a visible database link |
| Snowflake | `CREATE ROLE reader; GRANT USAGE ON WAREHOUSE wh TO ROLE reader; GRANT USAGE ON DATABASE sales TO ROLE reader; GRANT USAGE ON SCHEMA sales.public TO ROLE reader; GRANT SELECT ON ALL TABLES IN SCHEMA sales.public TO ROLE reader; GRANT ROLE reader TO USER rep;` and `?role=READER` in the URL | any grant to the role, its granted roles or PUBLIC beyond USAGE on a warehouse, database or schema and SELECT on a table, view or materialized/dynamic table (OWNERSHIP, CREATE …, USAGE on an integration, stage, function or procedure, SELECT on an external table) |
| BigQuery | a service account with BigQuery Data Viewer and BigQuery Job User | **not enforced**: the service account's IAM is not checked (it cannot be enumerated with the BigQuery API alone). The dry run (SELECT only, bytes within `maxBytes`) and the statement check are the only guards |

## Release status

- **SQLite, MySQL: released.** Live-tested; the last review round found nothing material in the MySQL probe.
- **PostgreSQL, SQL Server: not released yet.** Live-tested (PostgreSQL 16, Azure SQL Edge). The last review round found
  probe gaps (SQL Server: grants on system objects to the login; PostgreSQL: column, sequence, large-object and server
  setting rights). They are fixed and tested live, but a further clean round is the release criterion.
- **Oracle, Snowflake, BigQuery: not released.** Not live-tested (mocked drivers only); BigQuery's login is not checked.
- **Stored procedures: not released.**
- **Open by design:** `public`'s default EXECUTE on `xp_dirtree`, `xp_fileexist`, `xp_regread` in SQL Server's `master`
  (reachable only through EXEC, which the keyword scan and the SHOWPLAN check refuse; on Windows, revoke them from
  public: `xp_dirtree` to a UNC path leaks the server's NTLM hash); PUBLIC's default EXECUTE on PostgreSQL functions (only
  the built-ins-only check stands in front of a SECURITY DEFINER function: revoke EXECUTE on such functions from PUBLIC).

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
