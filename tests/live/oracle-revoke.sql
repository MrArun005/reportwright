-- Run by .github/workflows/db-live.yml as SYSDBA in FREEPDB1, after oracle-setup.sql. The stock image grants PUBLIC
-- EXECUTE on network and file packages; the login probe (src/server/sql/oracle.js, RISKY) refuses a reader that can
-- reach them, so the admin step the probe's message names is run here: REVOKE EXECUTE … FROM PUBLIC.
WHENEVER SQLERROR EXIT FAILURE ROLLBACK
SET SERVEROUTPUT ON
BEGIN
  FOR p IN (SELECT table_name FROM all_tab_privs
             WHERE grantee = 'PUBLIC' AND privilege = 'EXECUTE'
               AND table_name IN ('UTL_HTTP', 'UTL_TCP', 'UTL_SMTP', 'UTL_MAIL', 'UTL_FILE', 'UTL_INADDR', 'DBMS_LDAP',
                                  'HTTPURITYPE', 'DBMS_JAVA', 'DBMS_SCHEDULER', 'DBMS_JOB', 'DBMS_BACKUP_RESTORE')) LOOP
    EXECUTE IMMEDIATE 'REVOKE EXECUTE ON SYS.' || p.table_name || ' FROM PUBLIC';
    DBMS_OUTPUT.PUT_LINE('revoked EXECUTE on SYS.' || p.table_name || ' from PUBLIC');
  END LOOP;
END;
/
EXIT
