// The phone engine (app/static/offline) must answer like the hub. Fixtures come from
// tools/make_parity_fixtures.py; run with `node --test tests/js` (pytest runs it too).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { localAsk } from "../../app/static/offline/answers.js";
import { detect, reportQuery } from "../../app/static/offline/intents.js";
import { createNormalizer } from "../../app/static/offline/normalize.js";
import { createRouter } from "../../app/static/offline/router.js";
import { createSearch } from "../../app/static/offline/search.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p));
const json = (p) => JSON.parse(read(p).toString("utf-8"));

const intents = json("tests/fixtures/intents.json");
const parity = json("tests/fixtures/parity.json");
const search = createSearch(json("app/static/pack/guides.json"));
const bin = read("app/static/pack/roads.bin");
const router = createRouter(json("app/static/pack/roads-meta.json"),
  bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const locations = json("data/locations.json");
const normalizer = createNormalizer(json("app/static/pack/lexicon.json"));
const ctx = { search, getRouter: async () => router, locations, byId: new Map(locations.map((l) => [l.id, l])) };
const bank = json("tests/question_bank.json");

test("intent detection matches the hub", () => {
  for (const c of intents.cases) {
    assert.deepEqual(detect(c.q, c.has_place), { kind: c.kind, ftype: c.ftype }, c.q);
  }
  for (const c of intents.none) assert.equal(detect(c.q, c.has_place), null, c.q);
});

test("report question detection matches the hub", () => {
  for (const c of intents.reports) assert.deepEqual(reportQuery(c.q, c.place_is_center), c.kinds, c.q);
});

test("answers from situation reports match the hub", async () => {
  const { reports, cases } = parity.report_answers;
  for (const c of cases) {
    const phone = await localAsk(c.body, { ...ctx, reports: { reports, syncedMinAgo: null } });
    const done = phone[phone.length - 1];
    const q = c.body.question;
    assert.equal(done.status, "reports", `${q}: status`);
    assert.equal(phone.filter((e) => e.type === "token").map((e) => e.text).join(""), c.text, `${q}: text`);
    assert.deepEqual(done.reports.map((r) => r.id), c.ids, `${q}: reports`);
    assert.equal(done.location_used, c.location_used, `${q}: place`);
  }
});

test("guide search matches the hub", () => {
  for (const s of parity.search) {
    assert.deepEqual(search.evidence(s.q).map((h) => h.chunk.chunk_id), s.evidence, s.q);
    const top = search.search(s.q, s.top.length);
    s.top.forEach(([id, score, matched], i) => {
      assert.equal(top[i].chunk.chunk_id, id, `${s.q} #${i}`);
      assert.ok(Math.abs(top[i].score - score) < 1e-5, `${s.q} score ${top[i].score} vs ${score}`);
      assert.equal(top[i].matched, matched, `${s.q} matched`);
    });
  }
});

test("phone routes match the hub", () => {
  for (const r of parity.routes) {
    const name = `${r.mode} ${r.from} -> ${r.to}${r.avoid ? ` avoiding ${r.avoid}` : ""}`;
    const avoid = r.avoid ? new Set(r.avoid) : null;
    if (r.error) {
      assert.throws(() => router.route(r.from, r.to, r.mode, "X", avoid), { message: r.error }, name);
      continue;
    }
    const res = router.route(r.from, r.to, r.mode, "X", avoid);
    if (r.edges) assert.deepEqual(res.edges, r.edges, `${name} edges`);
    assert.equal(res.distance_m, r.distance_m, `${name} distance`);
    assert.equal(res.duration_min, r.duration_min, `${name} duration`);
    assert.deepEqual(res.steps.map((s) => s.instruction), r.steps, `${name} steps`);
    assert.deepEqual(res.steps.map((s) => s.distance_m), r.step_m, `${name} step lengths`);
  }
});

test("offline answers match the hub's data answers", async () => {
  for (const { body, events: hub } of parity.asks) {
    const phone = await localAsk(body, ctx);
    const q = body.question;
    const hubDone = hub[hub.length - 1];
    const phoneDone = phone[phone.length - 1];
    assert.equal(phoneDone.type, hubDone.type, `${q}: last event type`);
    if (hubDone.type === "error") continue;
    assert.equal(phoneDone.status, hubDone.status, `${q}: status`);
    const text = (evs) => evs.filter((e) => e.type === "token").map((e) => e.text).join("");
    assert.equal(text(phone), text(hub), `${q}: answer text`);
    const passages = (evs) => (evs.find((e) => e.type === "passages")?.passages ?? []).map((p) => p.chunk_id);
    assert.deepEqual(passages(phone), passages(hub), `${q}: guide sections`);
    assert.deepEqual((phoneDone.sources ?? []).map((s) => s.chunk_id), (hubDone.sources ?? []).map((s) => s.chunk_id), `${q}: sources`);
    assert.deepEqual((phoneDone.places ?? []).map((p) => [p.id, p.distance_m]), (hubDone.places ?? []).map((p) => [p.id, p.distance_m]), `${q}: places`);
    if (hubDone.route) assert.equal(phoneDone.route.distance_m, hubDone.route.distance_m, `${q}: route`);
  }
});

test("spelling fixes match the hub", () => {
  for (const [q, hub] of parity.normalize) assert.equal(normalizer.normalize(q), hub, q);
});

// The same question bank the hub is tested with (tests/test_question_bank.py): typos,
// Filipino/Taglish and odd phrasing must get the right kind of answer on the phone too.
test("question bank: the phone understands typos like the hub", async () => {
  const NEAR_BMC = { lat: 13.7672, lng: 121.066 };
  const STATUS = { nearest: "places", nearby: "places", distance: "route", contact: "info", hours: "info" };
  const failures = [];
  for (const g of bank.groups) {
    for (const q of g.qs) {
      const body = { question: q, use_ai: true };
      if (g.ctx.pos) body.from_pos = NEAR_BMC;
      if (g.ctx.place) body.location_id = bank.places[g.ctx.place];
      const events = await localAsk(body, { ...ctx, normalize: normalizer.normalize, reports: { reports: [], syncedMinAgo: null } });
      const done = events[events.length - 1];
      const norm = normalizer.normalize(q);
      const e = g.expect;
      const shown = events.filter((x) => x.type === "passages").flatMap((x) => x.passages.map((p) => p.chunk_id));
      let problem = null;
      if (e.intent) {
        const got = detect(norm, Boolean(body.location_id));
        if (!got || got.kind !== e.intent || (e.ftype && got.ftype !== e.ftype)) problem = `intent ${JSON.stringify(got)}`;
        else if (done.status !== STATUS[e.intent]) problem = `status ${done.status}`;
      } else if (e.route) {
        if (done.status !== "route") problem = `status ${done.status}`;
      } else if (e.reports) {
        const kinds = reportQuery(norm, g.ctx.place === "bsu");
        if (done.status !== "reports") problem = `status ${done.status}`;
        else if (JSON.stringify(kinds) !== JSON.stringify(e.reports)) problem = `kinds ${kinds}`;
      } else if (e.chunks) {
        if (!shown.some((s) => e.chunks.some((c) => s === c || (c.endsWith("#") && s.startsWith(c))))) problem = `showed ${shown.join(", ") || done.status}`;
      } else if (e.uncovered) {
        if (done.status !== "uncertain") problem = `answered ${done.status} ${shown.join(", ")}`;
      }
      if (problem) failures.push(`${g.name}: ${q} (read as "${norm}"): ${problem}`);
    }
  }
  assert.deepEqual(failures, []);
});
