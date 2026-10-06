'use strict';
// DEVELOPMENT ONLY: a stand-in for the `pg` package that runs queries through
// the psql command-line tool. Used for local testing where npm is unavailable.
// Production always uses the real `pg` driver. Enable with PG_SHIM=1.
const { spawnSync } = require('node:child_process');

function literal(v) {
  if (v == null) return 'NULL';
  if (Buffer.isBuffer(v)) return `'\\x${v.toString('hex')}'`;
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) v = '{' + v.map((x) => '"' + String(x).replace(/["\\]/g, '\\$&') + '"').join(',') + '}';
  else if (typeof v === 'object') v = JSON.stringify(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

const TS = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/;
function revive(row) {
  for (const k of Object.keys(row)) {
    const v = row[k];
    if (typeof v === 'string' && TS.test(v)) row[k] = new Date(v);
    else if (typeof v === 'string' && v.startsWith('\\x')) row[k] = Buffer.from(v.slice(2), 'hex');
  }
  return row;
}

class Pool {
  constructor({ connectionString }) { this.url = connectionString; }
  on() {}
  async query(text, params = []) {
    // Same rule as real Postgres: the number of values must match the highest $n used.
    const used = Math.max(0, ...[...text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
    if (used !== params.length) throw new Error(`bind message supplies ${params.length} parameters, but prepared statement "" requires ${used}`);
    const sql = text.replace(/\$(\d+)/g, (_, n) => literal(params[Number(n) - 1]));
    const trimmed = sql.trim().replace(/;\s*$/, '');
    // Decide from the query text before values are filled in, so book text can't confuse it.
    const returnsRows = /^\s*(SELECT|WITH)\b/i.test(text) || /\bRETURNING\b/i.test(text);
    const script = returnsRows
      ? `WITH __q AS (${trimmed}) SELECT coalesce(json_agg(__q), '[]') FROM __q;`
      : trimmed + ';';
    const r = spawnSync('psql', [this.url, '-X', '-t', '-A', '-q', '-v', 'ON_ERROR_STOP=1'], { input: script, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) {
      const err = new Error(r.stderr.replace(/^psql:[^:]*:\d+: /, '').trim());
      const code = /duplicate key/.test(r.stderr) ? '23505' : undefined;
      if (code) err.code = code;
      throw err;
    }
    if (!returnsRows) return { rows: [], rowCount: 0 };
    const rows = JSON.parse(r.stdout.trim() || '[]').map(revive);
    return { rows, rowCount: rows.length };
  }
  async end() {}
}

module.exports = { Pool };
