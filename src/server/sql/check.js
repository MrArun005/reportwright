// @ts-check
// The statement check for every SQL dialect: defence in depth beside each database's own guard and the read-only login.
// It is an allow-list: one SELECT or WITH query whose every call (a name followed by "(") is a built-in scalar,
// aggregate or window function on this dialect's list, a keyword or a type. An unknown function is refused, so a
// function that reaches files, the network, other servers or dynamic SQL never needs to be named here.
// The scanner reads strings, quoted names and comments as each database does; quoting it does not model is refused,
// so the scanner and the server never disagree on where code is. Quoted names stay visible ("lo_import"( is a call).

/** @typedef {'sqlite'|'postgres'|'mysql'|'mssql'|'oracle'|'snowflake'|'bigquery'} Dialect */

/**
 * A quoted name as the checks see it: a marked word ("qn_" and the name's word characters), so it is never a keyword,
 * a type or an allowed function: a quoted or bracketed name before "(" is always refused ("lo_import"(, [upper](,
 * "in"( — which would resolve to a function of that name, not the keyword).
 */
export const visibleName = (n) => `qn_${String(n).replace(/[^\w]/g, '_')}`;

const err = (msg) => Object.assign(new Error(msg), { status: 400 });

/**
 * The code of a query: strings blanked, comments removed, quoted names kept as their text. Throws on quoting this
 * scanner does not model.
 * @param {string} q @param {Dialect} dialect
 */
export function codeOnly(q, dialect) {
  const open = () => err('The query has a comment, string or quoted name that does not end.');
  const refuse = (what) => err(`A SQL source cannot use ${what} here: write a plain '…' string.`);
  // comments that run to the end of the line
  const line = { bigquery: ['--', '#'], snowflake: ['--', '//'], mysql: ['#'] }[dialect] || ['--'];
  // [quote, closing, is a name, backslash escapes]
  const quotes = {
    bigquery: [["'", "'", false, true], ['"', '"', false, true], ['`', '`', true, true]],
    mysql: [["'", "'", false, false], ['"', '"', false, false], ['`', '`', true, false]], // \ refused below (NO_BACKSLASH_ESCAPES)
    snowflake: [["'", "'", false, true], ['"', '"', true, false]],
    mssql: [["'", "'", false, false], ['"', '"', true, false], ['[', ']', true, false]],
    sqlite: [["'", "'", false, false], ['"', '"', true, false], ['`', '`', true, false], ['[', ']', true, false]],
  }[dialect] || [["'", "'", false, false], ['"', '"', true, false]]; // postgres, oracle
  let out = '', i = 0;
  while (i < q.length) {
    const c = q[i], prev = q[i - 1] || ' ';
    if (line.some(m => q.startsWith(m, i)) || (q.startsWith('--', i) && (dialect !== 'mysql' || /[\s]/.test(q[i + 2] ?? ' ')))) {
      const e = q.slice(i).search(/[\r\n]/); i = e < 0 ? q.length : i + e; out += ' '; continue;
    }
    if (q.startsWith('/*', i)) {
      // MySQL runs /*! … */ (MariaDB also /*M! … */) as code and reads /*+ … */ as optimizer hints: all refused
      if (dialect === 'mysql' && /^\/\*([!+]|M!)/i.test(q.slice(i, i + 4))) throw err('A SQL source cannot use /*!, /*M! or /*+ comments.');
      if (dialect === 'oracle' && q.startsWith('/*+', i)) throw err('A SQL source cannot use optimizer hints.');
      // SQL Server and PostgreSQL nest /* */; a nested comment is refused rather than modelled
      const e = q.indexOf('*/', i + 2);
      if (e < 0) throw open();
      if (q.slice(i + 2, e).includes('/*')) throw err('A SQL source cannot use nested comments.');
      i = e + 2; out += ' '; continue;
    }
    if (!/[\w$#]/.test(prev)) {
      const head = q.slice(i, i + 4);
      if (dialect === 'oracle' && /^n?q'/i.test(head)) throw refuse("q'…' quoting");
      if (dialect === 'bigquery' && /^(r|b|rb|br)['"]/i.test(head)) throw refuse('raw or bytes strings');
      if (dialect === 'postgres' && /^(e|u&|b|x)'/i.test(head)) throw refuse("E'…', U&'…', B'…' or X'…' strings");
      if (dialect === 'mysql' && /^_\w+'/.test(q.slice(i, i + 12))) throw refuse('character set introducers');
    }
    if ((dialect === 'snowflake' || dialect === 'postgres') && c === '$' && /^\$\w*\$/.test(q.slice(i)) && !/[\w$]/.test(prev)) throw refuse('$$ strings');
    if (dialect === 'bigquery' && (q.startsWith("'''", i) || q.startsWith('"""', i))) throw refuse('triple-quoted strings');
    const quote = quotes.find(([o]) => o === c);
    if (quote) {
      const [, close, name, bs] = quote;
      let j = i + 1;
      for (;;) {
        if (j >= q.length) throw open();
        if (q[j] === '\\' && (dialect === 'mysql' || dialect === 'postgres') && !name) throw err('A SQL source cannot use a backslash in a string here: the server reads it by its settings.');
        if (bs && q[j] === '\\') { j += 2; continue; }
        if (q[j] === close) { if (q[j + 1] === close) { j += 2; continue; } break; }
        j++;
      }
      out += name ? ` ${visibleName(q.slice(i + 1, j))} ` : ' x ';
      i = j + 1;
      continue;
    }
    // fail closed: braces ({fn …} ODBC escapes, object literals) and anything outside printable ASCII in code
    if (c === '{' || c === '}') throw err('A SQL source cannot use { } (ODBC escapes or literals) in code.');
    if (!/[\x09\x0a\x0d\x20-\x7e]/.test(c)) throw err('A SQL source cannot use characters outside plain ASCII except inside strings.');
    out += c;
    i++;
  }
  return out;
}

// Words that may stand before "(" without being a function call.
const KEYWORDS = new Set(['select', 'from', 'where', 'and', 'or', 'not', 'in', 'exists', 'as', 'on', 'join', 'using', 'over', 'partition', 'by',
  'order', 'group', 'having', 'when', 'then', 'else', 'case', 'end', 'between', 'like', 'ilike', 'is', 'values', 'union', 'all', 'any', 'some',
  'distinct', 'intersect', 'except', 'minus', 'with', 'recursive', 'lateral', 'filter', 'within', 'top', 'limit', 'offset', 'fetch', 'row', 'rows',
  'array', 'struct', 'unnest', 'cross', 'outer', 'inner', 'left', 'right', 'full', 'apply', 'pivot', 'unpivot', 'for', 'of', 'escape', 'nulls',
  'first', 'last', 'asc', 'desc', 'interval', 'qualify', 'window', 'range', 'preceding', 'following', 'current', 'unbounded', 'collate', 'at',
  'zone', 'tablesample', 'percent', 'similar', 'to', 'returning', 'only', 'ties', 'regexp', 'rlike', 'div', 'mod', 'xor', 'sample', 'match_recognize']);

// Type names that take "(" (in CAST, CONVERT, ::).
const TYPES = new Set(['char', 'varchar', 'nchar', 'nvarchar', 'varchar2', 'nvarchar2', 'character', 'varying', 'text', 'string', 'decimal', 'numeric',
  'number', 'dec', 'float', 'real', 'double', 'precision', 'int', 'integer', 'bigint', 'smallint', 'tinyint', 'bit', 'binary', 'varbinary', 'raw',
  'time', 'timestamp', 'datetime', 'datetime2', 'datetimeoffset', 'smalldatetime', 'date', 'interval', 'bytes', 'bignumeric', 'int64', 'float64',
  'bool', 'boolean', 'unsigned', 'signed', 'money', 'year']);

// Built-in functions every dialect here has (or that are harmless where absent: the server refuses an unknown name).
const COMMON = ['count', 'sum', 'avg', 'min', 'max', 'coalesce', 'nullif', 'cast', 'abs', 'round', 'floor', 'ceiling', 'ceil', 'power', 'sqrt', 'exp',
  'ln', 'log', 'log10', 'sign', 'mod', 'upper', 'lower', 'trim', 'ltrim', 'rtrim', 'length', 'replace', 'substring', 'substr', 'concat', 'lpad', 'rpad',
  'left', 'right', 'reverse', 'position', 'row_number', 'rank', 'dense_rank', 'ntile', 'lag', 'lead', 'first_value', 'last_value', 'nth_value',
  'percent_rank', 'cume_dist', 'stddev', 'stddev_pop', 'stddev_samp', 'variance', 'var_pop', 'var_samp', 'greatest', 'least', 'extract', 'trunc',
  'pi', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'degrees', 'radians', 'grouping', 'percentile_cont', 'percentile_disc', 'corr',
  'covar_pop', 'covar_samp', 'listagg', 'string_agg', 'ascii', 'chr', 'char', 'repeat', 'replicate', 'translate', 'initcap', 'instr', 'locate',
  'to_char', 'to_date', 'to_number', 'to_timestamp', 'current_date', 'current_timestamp', 'now', 'date_trunc', 'date_part', 'dateadd', 'datediff',
  'datepart', 'datename', 'year', 'month', 'day', 'quarter', 'week', 'hour', 'minute', 'second', 'convert', 'iif', 'isnull', 'ifnull', 'nvl', 'nvl2',
  'decode', 'regexp_replace', 'regexp_substr', 'regexp_like', 'regexp_instr', 'regexp_count', 'split_part', 'strpos', 'char_length', 'octet_length',
  'bit_length', 'format', 'md5', 'random', 'rand', 'uuid', 'hash', 'bool_and', 'bool_or', 'every', 'array_agg', 'any_value', 'median', 'mode',
  'approx_count_distinct', 'last_day', 'add_months', 'months_between', 'next_day', 'json_value', 'json_query', 'json_extract', 'isjson',
  'try_cast', 'safe_cast', 'try_convert', 'parse', 'try_parse', 'str', 'stuff', 'space', 'soundex', 'difference', 'count_big', 'checksum',
  'binary_checksum', 'eomonth', 'datefromparts', 'datetimefromparts', 'getdate', 'getutcdate', 'sysdatetime', 'sysutcdatetime', 'isnumeric',
  'isdate', 'choose', 'concat_ws', 'string_split', 'openjson', 'json_modify', 'string_escape', 'quotename', 'unicode', 'nchar', 'patindex',
  'charindex', 'len', 'datalength', 'newid', 'switchoffset', 'todatetimeoffset', 'at', 'datetrunc', 'date_bucket', 'generate_series',
  'to_json', 'to_jsonb', 'json_build_object', 'json_agg', 'jsonb_agg', 'json_object_agg', 'jsonb_build_object', 'array_length', 'array_to_string',
  'string_to_array', 'unnest', 'age', 'make_date', 'make_timestamp', 'justify_days', 'width_bucket', 'date_format', 'str_to_date', 'from_unixtime',
  'unix_timestamp', 'curdate', 'curtime', 'dayofweek', 'dayofmonth', 'dayofyear', 'weekofyear', 'monthname', 'dayname', 'timestampdiff',
  'timestampadd', 'date_add', 'date_sub', 'adddate', 'subdate', 'period_diff', 'group_concat', 'if', 'field', 'elt', 'find_in_set', 'mid',
  'lcase', 'ucase', 'truncate', 'json_object', 'json_array', 'json_arrayagg', 'json_objectagg', 'json_unquote', 'json_contains', 'json_length',
  'format_date', 'format_timestamp', 'parse_date', 'parse_timestamp', 'date_diff', 'timestamp_diff', 'timestamp_trunc', 'countif', 'logical_and',
  'logical_or', 'array_length', 'generate_array', 'generate_date_array', 'starts_with', 'ends_with', 'contains_substr', 'split', 'safe_divide',
  'ieee_divide', 'div', 'to_varchar', 'to_decimal', 'try_to_number', 'try_to_date', 'iff', 'zeroifnull', 'nullifzero', 'div0', 'equal_null',
  'array_size', 'parse_json', 'try_parse_json', 'object_construct', 'array_construct', 'flatten', 'get', 'get_path', 'listagg', 'ratio_to_report',
  'conditional_true_event', 'regexp_contains', 'regexp_extract', 'format_number', 'to_hex', 'sha256', 'sha1', 'farm_fingerprint', 'timestamp',
  'datetime', 'date', 'time', 'string', 'sys_extract_utc', 'systimestamp', 'sysdate', 'localtimestamp', 'current_time', 'utc_timestamp',
  'numtodsinterval', 'numtoyminterval', 'to_dsinterval', 'to_yminterval', 'cardinality', 'lnnvl', 'width_bucket', 'bitand', 'bit_and', 'bit_or',
  'bit_xor', 'trunc', 'dbtimezone', 'sessiontimezone', 'from_tz', 'new_time', 'extractvalue', 'rowidtochar', 'nlssort', 'nls_upper', 'nls_lower',
  'nls_initcap', 'vsize', 'dump', 'ora_hash', 'standard_hash', 'json_table', 'json_exists', 'json_serialize', 'uuid_string', 'object_keys',
  'array_contains', 'array_slice', 'to_array', 'to_object', 'to_variant', 'typeof', 'is_null_value', 'strtok', 'strtok_to_array', 'charindex',
  'contains', 'startswith', 'endswith', 'editdistance', 'jarowinkler_similarity', 'sha2', 'base64_encode', 'base64_decode_string', 'hex_encode',
  'hex_decode_string', 'try_base64_decode_string', 'convert_timezone', 'date_from_parts', 'time_from_parts', 'timestamp_from_parts',
  'to_timestamp_ntz', 'to_timestamp_ltz', 'to_timestamp_tz', 'previous_day', 'yearofweek', 'weekiso', 'dayofweekiso', 'monthname', 'square',
  'cbrt', 'factorial', 'haversine', 'gcd', 'lcm', 'log2', 'cot', 'sinh', 'cosh', 'tanh', 'ascii', 'printf', 'instr', 'total', 'julianday',
  'strftime', 'unixepoch', 'typeof', 'likely', 'unlikely', 'glob', 'hex', 'quote', 'json_each', 'json_tree', 'json_group_array',
  'json_group_object', 'json_type', 'json_valid', 'json_patch', 'json_insert', 'json_set', 'json_remove', 'json_array_length', 'group_concat',
  'sum', 'unicode', 'char', 'trim', 'nullif', 'instr', 'format', 'iif', 'string_agg', 'percentile', 'approx_percentile', 'approx_quantiles',
  'approx_top_count', 'array_concat', 'array_reverse', 'array_to_string', 'offset', 'ordinal', 'safe_offset', 'safe_ordinal', 'struct',
  'date_add', 'date_sub', 'datetime_add', 'datetime_sub', 'datetime_diff', 'datetime_trunc', 'timestamp_add', 'timestamp_sub', 'time_add',
  'time_sub', 'time_diff', 'time_trunc', 'extract', 'current_datetime', 'unix_seconds', 'unix_millis', 'timestamp_seconds', 'timestamp_millis',
  'byte_length', 'normalize', 'lower', 'upper', 'cosine_distance', 'euclidean_distance', 'nanvl', 'dense_rank', 'sumif'];

// Per dialect, beyond COMMON. Nothing that reads files, reaches the network or another server, runs dynamic SQL,
// sleeps, or tells about the server's configuration.
const EXTRA = {
  postgres: ['to_regclass', 'jsonb_array_elements', 'jsonb_array_elements_text', 'json_array_elements', 'json_array_elements_text', 'jsonb_extract_path',
    'jsonb_extract_path_text', 'json_extract_path', 'json_extract_path_text', 'jsonb_each', 'jsonb_each_text', 'jsonb_object_keys', 'jsonb_typeof',
    'array_position', 'array_remove', 'array_append', 'array_prepend', 'array_cat', 'regexp_split_to_array', 'regexp_split_to_table', 'regexp_matches',
    'string_to_table', 'left', 'right', 'btrim', 'overlay', 'encode', 'decode', 'num_nonnulls', 'num_nulls', 'make_interval', 'to_timestamp',
    'clock_timestamp', 'statement_timestamp', 'transaction_timestamp', 'timezone', 'bit_count', 'cbrt', 'div', 'scale', 'trim_scale', 'gen_random_uuid'],
  mssql: ['string_agg', 'approx_count_distinct', 'trim', 'translate', 'format', 'datediff_big', 'dateadd', 'isoweek', 'datetimeoffsetfromparts',
    'smalldatetimefromparts', 'timefromparts', 'datetime2fromparts', 'greatest', 'least', 'log', 'square', 'rand', 'char', 'nchar'],
  mysql: ['convert_tz', 'makedate', 'maketime', 'sec_to_time', 'time_to_sec', 'to_days', 'from_days', 'yearweek', 'weekday', 'last_insert_id_never'],
  oracle: ['sys_guid', 'regexp_count', 'collect', 'xmlagg', 'xmlelement', 'xmlforest', 'xmlserialize', 'listagg'],
  snowflake: ['array_agg', 'object_agg', 'hll', 'approx_top_k', 'kurtosis', 'skew', 'bitand', 'boolor_agg', 'booland_agg', 'minhash', 'seq4', 'seq8',
    'uniform', 'normal', 'generator', 'table'],
  bigquery: ['net.host', 'net.reg_domain', 'net.public_suffix', 'st_geogpoint', 'st_distance', 'st_astext', 'st_geogfromtext', 'json_extract_scalar',
    'json_extract_array', 'json_query_array', 'json_value_array', 'to_json_string', 'parse_numeric', 'parse_bignumeric', 'safe_convert_bytes_to_string',
    'error', 'range_bucket', 'array_first', 'array_last'],
  sqlite: [],
};

const allowedFor = Object.fromEntries(['sqlite', 'postgres', 'mysql', 'mssql', 'oracle', 'snowflake', 'bigquery'].map(d => [d, new Set([...COMMON, ...(EXTRA[d] || [])])]));
// table functions that read files or other servers, or system packages, and SQLite's blob makers (zeroblob, randomblob:
// a value of any size from one number): refused even if a list above names them by mistake
const NEVER = /^(zeroblob|randomblob|pg_|lo_|dblink|utl_|dbms_|xp_|sp_|fn_|open|external_|ml\.|ai\.|system\$|sys\.|information_schema\.)/;

/**
 * Every call in the code is to an allowed built-in. CTE names with a column list (`t(a, b) as (`) are not calls.
 * A qualified call (`schema.fn(`) is refused unless the whole name is on the list (BigQuery `net.host`) or it is
 * BigQuery's `safe.` prefix on an allowed function; `pg_catalog.` is the built-in schema.
 * @param {string} code from codeOnly @param {Dialect} dialect
 */
export function assertCalls(code, dialect) {
  const ok = allowedFor[dialect];
  // a CTE with a column list: after WITH or a comma, and its body is a query (`from fn(a) as (x int)` is a call)
  const ctes = new Set([...code.matchAll(/(?:\bwith\s+(?:recursive\s+)?|,\s*)([A-Za-z_][\w$#]*)\s*\([\w$#\s,]*\)\s*as\s*(?:not\s+)?(?:materialized\s+)?\(\s*(?:select|with|values)\b/gi)].map(m => m[1].toLowerCase()));
  for (const m of code.matchAll(/([A-Za-z_@#][\w$#@]*(?:\s*\.\s*[A-Za-z_][\w$#]*)*)\s*\(/g)) {
    let name = m[1].replace(/\s+/g, '').toLowerCase();
    if (name.startsWith('@')) continue; // a bound parameter before "(": a syntax error on the server, never a call
    if (dialect === 'postgres') name = name.replace(/^pg_catalog\./, '');
    if (dialect === 'bigquery') name = name.replace(/^safe\./, '');
    const bare = !name.includes('.');
    if (bare && (KEYWORDS.has(name) || TYPES.has(name) || ctes.has(name))) continue;
    if (!NEVER.test(name) && ok.has(name)) continue;
    throw err(`A SQL source can only call built-in functions: "${m[1].trim().slice(0, 60)}" is not on the list.`);
  }
}
