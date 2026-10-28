// Set up and manage OFFGRID's online reports (Cloudflare Workers + D1, FREE plan, no card).
//
//   node tools/cloud_admin.mjs setup                 one time: database, tables, deploy, write cloud/site.json
//   node tools/cloud_admin.mjs deploy                publish changes to cloud/src (after build_phone_pack.py)
//   node tools/cloud_admin.mjs add "Juan Dela Cruz"  new responder account; prints its password ONCE
//   node tools/cloud_admin.mjs reset "Juan Dela Cruz"   new password for an account
//   node tools/cloud_admin.mjs disable "Juan Dela Cruz" / enable "..."
//   node tools/cloud_admin.mjs list                  accounts
//   node tools/cloud_admin.mjs log [50]              audit log: logins, verify, remove
//
// Add --local <file.db> to work on a local database (cloud/local/server.mjs) instead.
// Before `setup`: make a free Cloudflare account (email only, no card), then run
//   npx wrangler@4.150.0 login
// Nothing here adds a payment method or changes the plan; the free plan never charges.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { hashPassword, newPassword, validName } from "../cloud/src/auth.js";
import { randomHex } from "../cloud/src/reports.js";

const WRANGLER = "wrangler@4.150.0"; // pinned: the version this was checked with
const CLOUD = new URL("../cloud/", import.meta.url);
const cloudPath = (f) => decodeURIComponent(new URL(f, CLOUD).pathname).replace(/^\/([A-Za-z]:)/, "$1");
const args = process.argv.slice(2);
const localIdx = args.indexOf("--local");
const LOCAL = localIdx >= 0 ? args.splice(localIdx, 2)[1] : null;
const [cmd, ...rest] = args;

function wrangler(wargs, { capture = false } = {}) {
  // Windows runs npx through cmd.exe, which splits on spaces: quote arguments that have them.
  const quoted = process.platform === "win32" ? wargs.map((a) => (/[\s'&|<>^]/.test(a) ? `"${a}"` : a)) : wargs;
  const r = spawnSync("npx", ["--yes", WRANGLER, ...quoted], {
    cwd: cloudPath("."), shell: process.platform === "win32", encoding: "utf-8", stdio: capture ? "pipe" : "inherit",
  });
  if (r.status !== 0) {
    if (capture) console.error(r.stdout, r.stderr);
    throw new Error(`wrangler ${wargs.join(" ")} failed`);
  }
  return r.stdout ?? "";
}

// Run SQL on the database; returns rows for a SELECT.
function sql(statement, params = []) {
  if (LOCAL) {
    const db = new DatabaseSync(LOCAL);
    db.exec(readFileSync(cloudPath("schema.sql"), "utf-8"));
    const st = db.prepare(statement);
    return /^\s*select/i.test(statement) ? st.all(...params) : (st.run(...params), []);
  }
  // Remote: values are inlined. Names pass validName and the rest are numbers or hex, so no
  // value can contain a quote; sent with --command, which (unlike --file) returns the rows.
  const q = (v) => (typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  let i = 0;
  const text = statement.replace(/\?/g, () => q(params[i++]));
  if (/["%!]/.test(text)) throw new Error("unexpected character in SQL");
  const out = wrangler(["d1", "execute", "offgrid", "--remote", "--json", "--command", text], { capture: true });
  return JSON.parse(out.slice(out.indexOf("[")))[0]?.results ?? [];
}

function needName() {
  const name = rest[0];
  if (!validName(name)) throw new Error('Give a name of 2-40 letters, digits, spaces, dots or dashes, e.g. "Juan Dela Cruz"');
  return name;
}

async function setPassword(name, isNew) {
  const password = newPassword();
  const salt = randomHex(16);
  const hash = await hashPassword(salt, password);
  if (isNew) {
    if (sql("SELECT name FROM accounts WHERE name = ?", [name]).length) throw new Error(`${name} already exists (use reset)`);
    sql("INSERT INTO accounts (name, salt, pw_hash, created_at) VALUES (?, ?, ?, ?)", [name, salt, hash, Date.now() / 1000]);
  } else {
    if (!sql("SELECT name FROM accounts WHERE name = ?", [name]).length) throw new Error(`No account named ${name}`);
    sql("UPDATE accounts SET salt = ?, pw_hash = ?, failures = 0, locked_until = 0 WHERE name = ?", [salt, hash, name]);
    sql("DELETE FROM sessions WHERE name = ?", [name]);
  }
  console.log(`\n  Responder: ${name}\n  Password:  ${password}\n\nGive it to them privately. It is shown only now; if it's lost, run "reset".`);
}

const when = (s) => new Date(s * 1000).toLocaleString("en-PH", { timeZone: "Asia/Manila" });

try {
  if (cmd === "setup") {
    console.log("Checking the Cloudflare login (free account, no card)...");
    wrangler(["whoami"]);
    const toml = readFileSync(cloudPath("wrangler.toml"), "utf-8");
    let id = /database_id = "([^"]+)"/.exec(toml)?.[1];
    if (!id) {
      const list = JSON.parse(wrangler(["d1", "list", "--json"], { capture: true }));
      id = list.find((d) => d.name === "offgrid")?.uuid;
      if (!id) {
        const out = wrangler(["d1", "create", "offgrid"], { capture: true });
        id = /database_id\s*=\s*"([0-9a-f-]+)"/.exec(out)?.[1] ?? /"database_id":\s*"([0-9a-f-]+)"/.exec(out)?.[1];
        if (!id) throw new Error(`Could not read the new database id:\n${out}`);
      }
      writeFileSync(cloudPath("wrangler.toml"), toml.replace('database_id = ""', `database_id = "${id}"`));
      console.log(`Database "offgrid" ready (${id}).`);
    }
    wrangler(["d1", "execute", "offgrid", "--remote", "--yes", "--file", "schema.sql"]);
    cmd === "setup" && console.log("Tables ready. Publishing the Worker...");
  }
  if (cmd === "setup" || cmd === "deploy") {
    const out = wrangler(["deploy"], { capture: true });
    console.log(out);
    const url = /https:\/\/[a-z0-9.-]+\.workers\.dev/.exec(out)?.[0];
    if (!url) throw new Error("Deployed, but no workers.dev address was printed. If Cloudflare asked to pick a free workers.dev subdomain, do that in the dashboard (Workers & Pages) and run this again.");
    writeFileSync(cloudPath("site.json"), `${JSON.stringify({ url: `${url}/` }, null, 1)}\n`);
    console.log(`\nOnline reports are live at ${url}/ (written to cloud/site.json).\nNext: add responders with "add", then commit and push so the website uses it.`);
  } else if (cmd === "add" || cmd === "reset") {
    await setPassword(needName(), cmd === "add");
  } else if (cmd === "disable" || cmd === "enable") {
    const name = needName();
    sql("UPDATE accounts SET active = ? WHERE name = ?", [cmd === "enable" ? 1 : 0, name]);
    if (cmd === "disable") sql("DELETE FROM sessions WHERE name = ?", [name]);
    console.log(`${name}: ${cmd}d.`);
  } else if (cmd === "list") {
    for (const a of sql("SELECT name, active, created_at FROM accounts ORDER BY name")) {
      console.log(`${a.active ? "active  " : "disabled"}  ${a.name}  (since ${when(a.created_at)})`);
    }
  } else if (cmd === "log") {
    const n = Math.min(Number(rest[0]) || 50, 1000);
    for (const e of sql(`SELECT at, name, action, report_id FROM audit ORDER BY id DESC LIMIT ${n}`)) {
      console.log(`${when(e.at)}  ${e.name}  ${e.action}${e.report_id ? `  ${e.report_id}` : ""}`);
    }
  } else if (cmd !== "setup") {
    console.log(readFileSync(new URL(import.meta.url), "utf-8").split("\n").filter((l) => l.startsWith("//")).join("\n"));
  }
} catch (e) {
  console.error(`\n${e.message}`);
  process.exit(1);
}
