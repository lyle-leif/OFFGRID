// Replays report steps (JSON on stdin) on the cloud's rules (cloud/src/reports.js) and prints
// what phones would see after each "active" step. tests/test_cloud.py runs the same steps on
// the hub's ReportStore and compares the two.
import { openD1 } from "../../cloud/local/d1shim.mjs";
import { ReportStore, publicReport } from "../../cloud/src/reports.js";

const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const steps = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
const store = new ReportStore(openD1());
const out = [];
for (const s of steps) {
  if (s.op === "add") {
    const [r, created] = await store.add({ id: s.id, kind: s.kind, lat: s.lat, lng: s.lng, device: s.device, ageS: s.age_s ?? 0,
      now: s.now, locationId: s.location_id ?? null, edgeId: s.edge_id ?? null, roadName: s.road_name ?? null,
      details: s.details ?? [], note: s.note ?? null, flagged: s.flagged ?? false, onSite: s.on_site ?? false,
      accBucket: s.acc_bucket ?? null });
    out.push({ op: "add", id: r.id, created });
  } else if (s.op === "note") {
    await store.setNote(s.id, s.status);
  } else if (s.op === "raw") {
    out.push({ op: "raw", note: (await store.get(s.id)).note });
  } else if (s.op === "vote") {
    const r = await store.vote(s.id, s.device, s.vote, s.now);
    out.push({ op: "vote", found: Boolean(r) });
  } else if (s.op === "flag") {
    await store.setFlag(s.id, s.flag);
  } else if (s.op === "active") {
    out.push({ op: "active", reports: (await store.active(s.now)).map((r) => publicReport(r, s.now, s.responder ?? false)) });
  }
}
process.stdout.write(JSON.stringify(out));
