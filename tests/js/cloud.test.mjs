// The online-reports Worker (cloud/src/worker.js) on Node's built-in SQLite instead of D1:
// CORS, checks, rate limits, responder accounts, the audit log and Tagalog errors.
// Run with `node --test tests/js/cloud.test.mjs` (pytest runs it too, tests/test_cloud.py).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { openD1 } from "../../cloud/local/d1shim.mjs";
import { hashPassword, newPassword } from "../../cloud/src/auth.js";
import { DATA } from "../../cloud/src/data.js";
import worker, { cleanUp } from "../../cloud/src/worker.js";

const TL = JSON.parse(readFileSync(new URL("../../app/static/lang/tl.json", import.meta.url), "utf-8"));
const EN = JSON.parse(readFileSync(new URL("../../app/static/lang/en.json", import.meta.url), "utf-8"));
const SITE = "https://lyle-leif.github.io";
const [CENTER_ID, [CENTER_NAME, CENTER_LAT, CENTER_LNG]] = Object.entries(DATA.centers)[0];
const ROAD = { lat: 13.7565, lng: 121.0583, edge_id: 12345, road_name: "P. Burgos Street" };
let n = 0;
const rid = () => `report-${String(++n).padStart(4, "0")}`;

function setup() {
  const clock = { now: 1_800_000_000 };
  const env = { DB: openD1(), NOW: () => clock.now * 1000 };
  const call = async (method, path, { body, headers = {}, origin = SITE, ip = "10.0.0.1" } = {}) => {
    const resp = await worker.fetch(new Request(`https://offgrid.example.workers.dev${path}`, {
      method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { Origin: origin, "CF-Connecting-IP": ip, ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
    }), env);
    const text = await resp.text();
    return { status: resp.status, headers: resp.headers, body: text ? JSON.parse(text) : null };
  };
  const post = (fields, opts) => call("POST", "/api/reports", { body: { id: rid(), device: "phone-0001", ...fields }, ...opts });
  return { env, clock, call, post };
}

async function addAccount(env, name, now) {
  const password = newPassword();
  await env.DB.prepare("INSERT INTO accounts (name, salt, pw_hash, created_at) VALUES (?, ?, ?, ?)")
    .bind(name, "salt-1", await hashPassword("salt-1", password), now).run();
  return password;
}

test("CORS: only the website (and local testing) may call it", async () => {
  const { call } = setup();
  const ok = await call("OPTIONS", "/api/reports");
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get("Access-Control-Allow-Origin"), SITE);
  assert.match(ok.headers.get("Access-Control-Allow-Headers"), /Authorization/);
  assert.equal((await call("GET", "/api/reports", { origin: "http://127.0.0.1:8768" })).headers.get("Access-Control-Allow-Origin"), "http://127.0.0.1:8768");
  assert.equal((await call("GET", "/api/reports", { origin: "https://evil.example" })).headers.get("Access-Control-Allow-Origin"), null);
});

test("posting: checks, road and center rules, retries, Tagalog errors", async () => {
  const { post, call } = setup();
  assert.equal((await post({ kind: "road_flooded", lat: ROAD.lat, lng: ROAD.lng })).body.detail, EN["apierr.pin_on_road"]);
  assert.equal((await post({ kind: "road_flooded", ...ROAD, edge_id: DATA.edges })).status, 422);
  assert.equal((await post({ kind: "power_out", lat: 14.6, lng: 121.0 })).body.detail, EN["apierr.outside"]);
  const tl = await post({ kind: "power_out", lat: 14.6, lng: 121.0 }, { headers: { "X-Lang": "tl" } });
  assert.equal(tl.body.detail, TL["apierr.outside"]);
  assert.equal((await post({ kind: "nonsense", lat: 13.7, lng: 121 })).status, 422);
  assert.equal((await post({ kind: "center_full", lat: 13.7, lng: 121, location_id: "not-a-center" })).body.detail, EN["apierr.choose_center"]);

  const id = rid();
  const road = await call("POST", "/api/reports", { body: { id, device: "phone-0001", kind: "road_flooded", ...ROAD } });
  assert.equal(road.status, 200);
  assert.deepEqual([road.body.edge_id, road.body.road_name, road.body.trust, road.body.label], [12345, "P. Burgos Street", "unverified", "Road flooded"]);
  const again = await call("POST", "/api/reports", { body: { id, device: "phone-0001", kind: "power_out", lat: 13.7, lng: 121 } });
  assert.equal(again.body.kind, "road_flooded"); // a retry returns what was stored
  const center = await post({ kind: "center_full", lat: 13.7, lng: 121.0, location_id: CENTER_ID }); // snapped to the center
  assert.deepEqual([center.body.lat, center.body.lng, center.body.location_name], [CENTER_LAT, CENTER_LNG, CENTER_NAME]);
  const list = await call("GET", "/api/reports");
  assert.deepEqual(list.body.map((r) => r.kind).sort(), ["center_full", "road_flooded"]);
});

test("votes: one per phone, never your own, hiding and expiry", async () => {
  const { post, call, clock } = setup();
  const r = (await post({ kind: "road_blocked", ...ROAD })).body;
  // Each phone on its own network address (votes are limited per address).
  const vote = (device, v) => call("POST", `/api/reports/${r.id}/vote`, { body: { device, vote: v }, ip: `10.9.0.${device.slice(-1)}` });
  assert.equal((await vote("phone-0001", "confirm")).body.confirms, 0); // the reporter's own
  assert.equal((await vote("phone-0002", "confirm")).body.confirms, 1);
  assert.equal((await vote("phone-0002", "confirm")).body.confirms, 1); // once per phone
  assert.equal((await vote("phone-0003", "confirm")).body.trust, "confirmed");
  const switched = (await vote("phone-0003", "dispute")).body;
  assert.deepEqual([switched.confirms, switched.disputes], [1, 1]);
  await vote("phone-0004", "dispute");
  await vote("phone-0005", "dispute");
  assert.equal((await call("GET", "/api/reports")).body.length, 0); // 3 disputes >= 1 confirm + 2: hidden
  assert.equal((await call("POST", "/api/reports/report-none1/vote", { body: { device: "phone-0002", vote: "confirm" } })).status, 404);
  const p = (await post({ kind: "power_out", lat: 13.7, lng: 121.0 })).body;
  clock.now += 6 * 3600 + 1;
  assert.equal((await call("GET", "/api/reports")).body.some((x) => x.id === p.id), false); // expired
});

test("rate limits: 10 reports per phone an hour", async () => {
  const { post, clock } = setup();
  for (let i = 0; i < 10; i++) assert.equal((await post({ kind: "power_out", lat: 13.7, lng: 121.0 })).status, 200);
  const blocked = await post({ kind: "power_out", lat: 13.7, lng: 121.0 });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.detail, EN["apierr.too_many"]);
  assert.equal((await post({ kind: "power_out", lat: 13.7, lng: 121.0 }, { ip: "10.0.0.2" })).status, 429); // still this phone
  clock.now += 3601;
  assert.equal((await post({ kind: "power_out", lat: 13.7, lng: 121.0 })).status, 200);
});

test("responders: personal accounts, lockout, sessions, audit log", async () => {
  const { env, post, call, clock } = setup();
  const password = await addAccount(env, "Juan Dela Cruz", clock.now);
  const r = (await post({ kind: "medical_need", lat: 13.7, lng: 121.0 })).body;
  assert.equal((await call("POST", `/api/reports/${r.id}/verify`)).status, 401); // not logged in
  assert.equal((await call("POST", `/api/reports/${r.id}/verify`, { headers: { Authorization: "Bearer nope" } })).body.detail, EN["apierr.need_login"]);

  const login = (pw, name = "Juan Dela Cruz") => call("POST", "/api/login", { body: { name, password: pw } });
  assert.equal((await login("wrong")).status, 403);
  assert.equal((await login(password, "Nobody Here")).status, 403);
  for (let i = 0; i < 3; i++) await login("wrong");
  const locked = await login("wrong"); // 5th wrong password
  assert.equal(locked.status, 429);
  assert.equal(locked.body.detail, EN["apierr.login_locked"]);
  assert.equal((await login(password)).status, 429); // even the right one, for 10 minutes
  clock.now += 601;
  const ok = await login(password);
  assert.equal(ok.status, 200);
  const auth = { Authorization: `Bearer ${ok.body.token}` };

  assert.equal((await call("POST", `/api/reports/${r.id}/verify`, { headers: auth })).body.trust, "verified");
  const other = (await post({ kind: "water_available", lat: 13.7, lng: 121.0, device: "phone-0009" })).body;
  assert.equal((await call("DELETE", `/api/reports/${other.id}`, { headers: auth })).status, 200);
  assert.equal((await call("GET", "/api/reports")).body.some((x) => x.id === other.id), false);

  const { results } = await env.DB.prepare("SELECT name, action, report_id FROM audit ORDER BY id").all();
  assert.deepEqual(results.map((a) => a.action), ["login_failed", "login_failed", "login_failed", "login_failed", "locked", "login", "verify", "remove"]);
  assert.equal(results.find((a) => a.action === "remove").report_id, other.id);

  await call("POST", "/api/logout", { headers: auth });
  assert.equal((await call("POST", `/api/reports/${r.id}/verify`, { headers: auth })).status, 401);
  const again = await login(password);
  clock.now += 12 * 3600 + 1; // sessions end after 12 hours
  assert.equal((await call("POST", `/api/reports/${r.id}/verify`, { headers: { Authorization: `Bearer ${again.body.token}` } })).status, 401);
  await env.DB.prepare("UPDATE accounts SET active = 0").run(); // disabled accounts can't log in
  assert.equal((await login(password)).status, 403);
});

test("nothing personal is stored", async () => {
  const { env, post } = setup();
  await post({ kind: "power_out", lat: 13.7, lng: 121.0, device: "my-phone-id-123" }, { ip: "203.0.113.7" });
  const dump = JSON.stringify([
    (await env.DB.prepare("SELECT * FROM votes").all()).results, (await env.DB.prepare("SELECT * FROM hits").all()).results,
  ]);
  assert.ok(!dump.includes("my-phone-id-123") && !dump.includes("203.0.113.7"), dump);
});

test("Reports v2: details per kind, Iba pa needs a note, notes public only once approved", async () => {
  const { env, post, call, clock } = setup();
  assert.equal((await post({ kind: "power_out", lat: 13.7, lng: 121.0, details: ["knee"] })).body.detail, EN["apierr.bad_details"]);
  const tl = await post({ kind: "other", lat: 13.7, lng: 121.0 }, { headers: { "X-Lang": "tl" } });
  assert.equal(tl.body.detail, TL["apierr.note_required"]);
  const r = (await post({ kind: "other", lat: 13.7, lng: 121.0, note: "Bumagsak na poste, tawag 0917 123 4567", on_site: true, acc_bucket: 20 })).body;
  assert.deepEqual([r.note, r.on_site, r.acc_bucket], [null, true, 20]); // waiting for a responder
  const publicView = async () => Object.fromEntries((await call("GET", "/api/reports")).body.map((x) => [x.id, x]));
  assert.equal((await publicView())[r.id].note, null);
  assert.equal((await call("POST", `/api/reports/${r.id}/note`, { body: { action: "approve" } })).status, 401);

  const password = await addAccount(env, "Maria Santos", clock.now);
  const token = (await call("POST", "/api/login", { body: { name: "Maria Santos", password } })).body.token;
  const auth = { Authorization: `Bearer ${token}` };
  const asResponder = Object.fromEntries((await call("GET", "/api/reports", { headers: auth })).body.map((x) => [x.id, x]));
  assert.equal(asResponder[r.id].note, "Bumagsak na poste, tawag [tinanggal]");
  assert.equal(asResponder[r.id].note_status, "pending");
  assert.equal((await call("POST", `/api/reports/${r.id}/note`, { body: { action: "approve" }, headers: auth })).status, 200);
  assert.equal((await publicView())[r.id].note, "Bumagsak na poste, tawag [tinanggal]");
  await call("POST", `/api/reports/${r.id}/note`, { body: { action: "hide" }, headers: auth });
  assert.equal((await publicView())[r.id].note, null);
  const { results } = await env.DB.prepare("SELECT action FROM audit WHERE report_id = ?").bind(r.id).all();
  assert.deepEqual(results.map((a) => a.action), ["note_approve", "note_hide"]);

  const flood = (await post({ kind: "road_flooded", ...ROAD, details: ["knee", "no_cars"], note: "gago" })).body;
  assert.deepEqual(flood.details, ["knee", "no_cars"]);
  const f = (await call("GET", "/api/reports", { headers: auth })).body.find((x) => x.id === flood.id);
  assert.equal(f.flagged, true);
  clock.now += 2 * 3600 + 1; // the flood report expires: its note is deleted, not just hidden
  await call("GET", "/api/reports");
  assert.equal((await env.DB.prepare("SELECT note FROM reports WHERE id = ?").bind(flood.id).first()).note, null);
});

test("safety: vote limits per address, lockout only from the guessing address, hourly clean-up", async () => {
  const { env, post, call, clock } = setup();
  const r = (await post({ kind: "road_flooded", ...ROAD })).body;
  // Made-up phone ids from one address can't dispute a true report away.
  const dispute = (device, ip = "198.51.100.7") => call("POST", `/api/reports/${r.id}/vote`, { body: { device, vote: "dispute" }, ip });
  assert.equal((await dispute("fake-0001")).status, 200);
  const second = await dispute("fake-0002");
  assert.equal(second.status, 429); // one dispute per address on a report: hiding needs two
  assert.equal(second.body.detail, EN["apierr.too_many_votes"]);
  assert.ok((await call("GET", "/api/reports")).body.some((x) => x.id === r.id)); // still listed
  const confirm = (device) => call("POST", `/api/reports/${r.id}/vote`, { body: { device, vote: "confirm" }, ip: "198.51.100.8" });
  assert.deepEqual([await confirm("neighbour-0001"), await confirm("neighbour-0002"), await confirm("neighbour-0003"), await confirm("neighbour-0004")].map((x) => x.status),
    [200, 200, 200, 429]); // neighbours on one Wi-Fi can still back it up
  assert.equal((await dispute("real-0005", "203.0.113.9")).status, 200); // someone else still can
  clock.now += 3601;
  assert.equal((await dispute("fake-0006")).status, 200); // an hour later

  // Wrong passwords lock the account only from where they came from.
  const password = await addAccount(env, "Ana Reyes", clock.now);
  const login = (pw, ip) => call("POST", "/api/login", { body: { name: "Ana Reyes", password: pw }, ip });
  for (let i = 0; i < 5; i++) await login("wrong", "198.51.100.66");
  assert.equal((await login(password, "198.51.100.66")).status, 429);
  assert.equal((await login(password, "203.0.113.20")).status, 200); // the responder, elsewhere

  // The hourly clean-up deletes the notes of expired reports even if nobody opens the list.
  const noted = (await post({ kind: "power_out", lat: 13.7, lng: 121.0, note: "TEST note", device: "phone-0042" })).body;
  clock.now += 6 * 3600 + 1;
  await cleanUp(env.DB, clock.now);
  assert.equal((await env.DB.prepare("SELECT note FROM reports WHERE id = ?").bind(noted.id).first()).note, null);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM hits WHERE at < ?").bind(clock.now - 3600).first()).n, 0);
});
