// OFFGRID online reports: a Cloudflare Worker (free plan) with a D1 database.
//
// The same /api/reports paths and answers as the hub (app/routes/reports.py), so the app and
// the phone engine use them unchanged; the website (GitHub Pages) calls this when it is online.
// Responders log in with personal accounts (auth.js) instead of the hub's shared PIN.
// Road reports arrive already snapped to a road by the phone (the road network is too big for
// a Worker); the Worker checks the road id is real, and that center reports name a real
// evacuation center. Nothing here costs money: on the free plan, going over a daily limit only
// makes requests fail until the next day, and phones keep reports in their outbox meanwhile.

import { audit, login, logout, sessionName } from "./auth.js";
import { DATA } from "./data.js";
import { CENTER_KINDS, ROAD_KINDS, ReportStore, publicReport } from "./reports.js";

const TOKEN = /^[A-Za-z0-9-]{8,64}$/;
const LIMITS = { device: [10, 3600], ip: [30, 3600], login: [10, 600] }; // [count, seconds], as on the hub
const DEFAULT_ORIGINS = ["https://lyle-leif.github.io"];
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function text(lang, key, vars = {}) {
  const tpl = DATA.strings[lang]?.[key] ?? DATA.strings.en[key] ?? key;
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = (env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(",") : DEFAULT_ORIGINS).map((o) => o.trim());
  if (!allowed.includes(origin) && !LOCAL_ORIGIN.test(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Lang, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const optStr = (v, max) => v === undefined || v === null || (typeof v === "string" && v.length <= max);

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

async function limited(db, key, [count, window], now) {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM hits WHERE key = ? AND at > ?").bind(key, now - window).first();
  return row.n >= count;
}
const hit = (db, key, now) => db.prepare("INSERT INTO hits (key, at) VALUES (?, ?)").bind(key, now).run();

export async function handle(request, env, now) {
  const db = env.DB;
  const store = new ReportStore(db);
  const url = new URL(request.url);
  const lang = request.headers.get("X-Lang") === "tl" ? "tl" : "en";
  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  const send = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const fail = (status, key, vars) => send({ detail: text(lang, key, vars) }, status);
  const path = url.pathname.replace(/\/+$/, "");
  const m = /^\/api\/reports\/([A-Za-z0-9-]{8,64})(\/vote|\/verify)?$/.exec(path);

  if (path === "/api/health" && request.method === "GET") return send({ backend: "ok", cloud: true });

  if (path === "/api/reports" && request.method === "GET") {
    return send((await store.active(now)).map((r) => publicReport(r, now)));
  }

  if (path === "/api/reports" && request.method === "POST") {
    const b = await readJson(request);
    if (!b || !TOKEN.test(b.id ?? "") || !DATA.kinds.includes(b.kind) || !isNum(b.lat) || !isNum(b.lng) || !TOKEN.test(b.device ?? "")
        || !(b.age_s === undefined || (isNum(b.age_s) && b.age_s >= 0 && b.age_s <= 7 * 86400))
        || !optStr(b.location_id, 64) || !optStr(b.road_name, 120)
        || !(b.edge_id === undefined || b.edge_id === null || Number.isInteger(b.edge_id))) {
      return fail(422, "apierr.bad_request");
    }
    const old = await store.get(b.id);
    if (old) return send(publicReport(old, now)); // a phone retrying a report we already have
    const box = DATA.bbox;
    if (!(box.min_lat <= b.lat && b.lat <= box.max_lat && box.min_lng <= b.lng && b.lng <= box.max_lng)) return fail(422, "apierr.outside");
    const devKey = `d:${await store.hash(b.device)}`;
    const ipKey = `i:${await store.hash(`ip:${ip}`)}`;
    if (await limited(db, devKey, LIMITS.device, now) || await limited(db, ipKey, LIMITS.ip, now)) return fail(429, "apierr.too_many");

    let { lat, lng } = b;
    let locationId = null, edgeId = null, roadName = null;
    const center = b.location_id ? DATA.centers[b.location_id] : null;
    if (CENTER_KINDS.has(b.kind)) {
      if (!center) return fail(422, "apierr.choose_center");
      locationId = b.location_id;
      [, lat, lng] = center;
    } else if (ROAD_KINDS.has(b.kind)) {
      if (!Number.isInteger(b.edge_id) || b.edge_id < 0 || b.edge_id >= DATA.edges || !b.road_name) return fail(422, "apierr.pin_on_road");
      edgeId = b.edge_id;
      roadName = b.road_name;
    } else if (center) {
      locationId = b.location_id;
    }
    const [r, created] = await store.add({ id: b.id, kind: b.kind, lat, lng, device: b.device, ageS: b.age_s ?? 0, now,
      locationId, edgeId, roadName });
    if (created) {
      await db.batch([
        db.prepare("INSERT INTO hits (key, at) VALUES (?, ?)").bind(devKey, now),
        db.prepare("INSERT INTO hits (key, at) VALUES (?, ?)").bind(ipKey, now),
        db.prepare("DELETE FROM hits WHERE at < ?").bind(now - 3600),
      ]);
    }
    return send(publicReport(r, now));
  }

  if (m && m[2] === "/vote" && request.method === "POST") {
    const b = await readJson(request);
    if (!b || !TOKEN.test(b.device ?? "") || !["confirm", "dispute"].includes(b.vote)) return fail(422, "apierr.bad_request");
    const r = await store.vote(m[1], b.device, b.vote, now);
    return r ? send(publicReport(r, now)) : fail(404, "apierr.gone");
  }

  if (path === "/api/login" && request.method === "POST") {
    const loginKey = `l:${await store.hash(`ip:${ip}`)}`;
    if (await limited(db, loginKey, LIMITS.login, now)) return fail(429, "apierr.login_locked");
    const b = await readJson(request);
    const res = await login(db, b?.name, b?.password, now);
    if (res.error) {
      await hit(db, loginKey, now);
      return fail(res.error === "login_locked" ? 429 : 403, `apierr.${res.error}`);
    }
    return send({ token: res.token, name: res.name, expires_in: 12 * 3600 });
  }

  if (path === "/api/logout" && request.method === "POST") {
    await logout(db, request.headers.get("Authorization"), now);
    return send({ ok: true });
  }

  if (m && (m[2] === "/verify" || !m[2]) && request.method === (m[2] ? "POST" : "DELETE")) {
    const name = await sessionName(db, request.headers.get("Authorization"), now);
    if (!name) return fail(401, "apierr.need_login");
    const flag = m[2] ? "verified" : "removed";
    const r = await store.setFlag(m[1], flag);
    if (!r) return fail(404, "apierr.gone");
    await audit(db, name, m[2] ? "verify" : "remove", m[1], now);
    return m[2] ? send(publicReport(r, now)) : send({ ok: true });
  }

  return fail(404, "apierr.bad_request");
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    let resp;
    try {
      resp = await handle(request, env, (env.NOW ?? Date.now)() / 1000);
    } catch (e) {
      console.error(e);
      resp = Response.json({ detail: "Server error" }, { status: 500 });
    }
    const headers = new Headers(resp.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    return new Response(resp.body, { status: resp.status, headers });
  },
};
