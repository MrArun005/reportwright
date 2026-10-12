// node qa/stress/rec.mjs <check> <command> <expected> <actual> <PASS|FAIL|WARN|SKIP>   one result row from a shell step
import { record } from './lib.mjs';
const [check, command, expected, actual, result] = process.argv.slice(2);
record({ check, command, expected, actual, result: /** @type {any} */ (['PASS', 'FAIL', 'WARN', 'SKIP'].includes(result) ? result : 'FAIL') });
