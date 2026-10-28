// The D1 calls the Worker uses (prepare/bind/first/all/run, batch, exec), on Node's built-in
// SQLite. D1 is SQLite too, so the Worker's SQL runs unchanged. Used by the tests and by
// cloud/local/server.mjs (run the Worker on this computer, no Cloudflare account needed).
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const SCHEMA = new URL("../schema.sql", import.meta.url);

class Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new Statement(this.db, this.sql, params);
  }

  async first() {
    return this.db.prepare(this.sql).get(...this.params) ?? null;
  }

  async all() {
    return { results: this.db.prepare(this.sql).all(...this.params) };
  }

  async run() {
    const r = this.db.prepare(this.sql).run(...this.params);
    return { meta: { changes: Number(r.changes) } };
  }
}

export function openD1(path = ":memory:") {
  const db = new DatabaseSync(path);
  db.exec(readFileSync(SCHEMA, "utf-8"));
  return {
    raw: db,
    prepare: (sql) => new Statement(db, sql),
    // D1 runs a batch as one transaction.
    async batch(stmts) {
      db.exec("BEGIN");
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    async exec(sql) {
      db.exec(sql);
    },
  };
}
