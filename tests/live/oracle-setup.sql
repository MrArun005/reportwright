-- Run by .github/workflows/db-live.yml as SYSTEM in FREEPDB1 (gvenzl/oracle-free). Fresh container every run.
WHENEVER SQLERROR EXIT FAILURE ROLLBACK
SET ECHO ON
-- the data owner: owns the table, and is not the reading login (a login that owns objects is refused by the probe)
CREATE USER pwowner IDENTIFIED BY PwOwner1234 QUOTA UNLIMITED ON USERS;
GRANT CREATE SESSION, CREATE TABLE TO pwowner;
-- the reading login: CREATE SESSION and nothing else; it gets SELECT on the one table
CREATE USER pwreader IDENTIFIED BY PwReader1234;
GRANT CREATE SESSION TO pwreader;

CREATE TABLE pwowner.types_t (
  id        NUMBER(10) PRIMARY KEY,
  amount    NUMBER(12,2),
  ratio     BINARY_DOUBLE,
  label     VARCHAR2(200),
  born      DATE,
  seen      TIMESTAMP(6),
  notes     CLOB
);
-- RPAD is VARCHAR2 (4000 max), so the 5000-character CLOB is two TO_CLOB pieces
INSERT INTO pwowner.types_t (id, amount, ratio, label, born, seen, notes)
VALUES (1, 1234.50, 1.5, 'Ünïcødé — ₹ 日本語 🚀', DATE '2024-01-02', TIMESTAMP '2024-01-02 03:04:05.123456', TO_CLOB(RPAD('n', 4000, 'n')) || TO_CLOB(RPAD('n', 1000, 'n')));
INSERT INTO pwowner.types_t (id) VALUES (2);
-- a CLOB of about 3.2 MB (over the CI cap of PW_SQL_MAX_MB=1): built in PL/SQL, 800 pieces of 4000 characters
DECLARE
  c CLOB;
BEGIN
  DBMS_LOB.CREATETEMPORARY(c, TRUE);
  FOR i IN 1..800 LOOP
    DBMS_LOB.WRITEAPPEND(c, 4000, RPAD('h', 4000, 'h'));
  END LOOP;
  INSERT INTO pwowner.types_t (id, notes) VALUES (3, c);
END;
/
COMMIT;
GRANT SELECT ON pwowner.types_t TO pwreader;
EXIT
