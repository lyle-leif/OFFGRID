// Location-question detection on the phone. Mirrors app/services/intents.py and the
// direction check in app/routes/assistant.py; tests/fixtures/intents.json keeps them in step.

const rx = (s) => new RegExp(s, "i");

const TYPE_WORDS = [
  ["evacuation_center", rx(String.raw`\b(evac\w*|evacuation|silungan|lilikasan|likasan|lumikas|shelter|refuge)\b`)],
  ["barangay_hall", rx(String.raw`\b(barangay hall|brgy\.? hall|barangay office|bulwagan ng barangay)\b`)],
  ["town_hall", rx(String.raw`\b(town hall|city hall|municipal hall|munisipyo|kapitolyo|capitol|mdrrmo office)\b`)],
  ["rescue", rx(String.raw`\b(rescue|rescuer|ambulance|ambulansya|drrm\w*|saklolo)\b`)],
  ["hospital", rx(String.raw`\b(hospital|ospital|emergency room|\ber\b|medical center)\b`)],
  ["health_center", rx(String.raw`\b(clinic|klinika|health ?center|rhu|bhs|doctor|doktor|check-?up|magpatingin)\b`)],
  ["pharmacy", rx(String.raw`\b(pharmacy|pharmacies|botika|drug ?store|drugstore|medicine|gamot|medisina|parmasya)\b`)],
  ["police", rx(String.raw`\b(police|pulis|presinto|pnp|precinct)\b`)],
  ["fire_station", rx(String.raw`\b(fire ?station|fire|bumbero|bfp|sunog)\b`)],
  ["market", rx(String.raw`\b(market|palengke|grocery|groceries|supermarket|tindahan|pagkain|food|rice|bigas|water supply|mabibilhan)\b`)],
];

const NEAREST = rx(String.raw`\b(nearest|closest|nearby|pinakamalapit|malapit na|pinaka malapit|the closest)\b` +
  String.raw`|\bwhere (is|are|can i|can we|do i|should i)\b|\bsaan\b|\bsaan (may|merong|ang|makakabili|pwede)\b` +
  String.raw`|\b(find|look for|hanapin|maghanap)\b`);
const NEAR_ME = rx(String.raw`\b(near me|near us|around me|around here|nearby|malapit sa (akin|amin|atin|dito)|dito sa paligid|what'?s near)\b`);
const DISTANCE = rx(String.raw`\b(how far|gaano kalayo|kalayo|layo|distance|ilang (km|kilometro|kilometers?|metro|meters?|minuto|minutes?|oras)` +
  String.raw`|how long (does it take|will it take|to (walk|drive|get|go))|gaano katagal|how many (km|kilometers|minutes|meters))\b`);
const CONTACT = rx(String.raw`\b(phone|contact|telephone|tel\.?|cellphone|cp number|numero|number|tawagan|tumawag|call (them|it|this|here))\b`);
const HOURS = rx(String.raw`\b(open|opening|closing|close|hours|bukas|sarado|anong oras|what time|schedule|oras ng)\b`);
const DEICTIC = rx(String.raw`\b(this|that|it|here|there|place|dito|diyan|doon|ito|iyan|iyon|lugar|sila|nila)\b`);
const CONDITIONS = rx(String.raw`\b(flood\w*|baha|safe|ligtas|blocked|passable|madaanan|traffic|landslide|full|puno|available|may (bakante|space)` +
  String.raw`|reports?|balita|updates?)\b`);
const NEAREST_WORD = rx(String.raw`\b(nearest|closest|pinakamalapit)\b`);

const DIRECTIONS = rx(String.raw`\b(how (do|can|should) (i|we) (get|go)|how to (get|go)|get there|go there|directions?|route|` +
  String.raw`way to|navigate|paano (pumunta|pupunta|makarating|makapunta)|papunta|daan|saan dadaan|ituro)\b`);
const DIR_CONDITIONS = rx(String.raw`\b(flood\w*|baha|safe|ligtas|closed|blocked|sarado|open|bukas|passable|madaanan|traffic|landslide)\b`);

export const FOLLOW_UP = rx(String.raw`^\s*(and|also|how about|what about|what if|paano naman|eh|e |ano naman|at )` +
  String.raw`|\b(them|they|those|that|it|this|these|naman|din|rin|ito|iyon|sila)\b`);

export function facilityType(q) {
  for (const [type, re] of TYPE_WORDS) if (re.test(q)) return type;
  return null;
}

// Returns { kind, ftype } or null — same rules and order as the hub.
export function detect(question, hasPlace) {
  const q = question.trim();
  if (CONDITIONS.test(q)) return null;
  const ftype = facilityType(q);
  const short = q.split(/\s+/).filter(Boolean).length <= 5;
  if (hasPlace && CONTACT.test(q) && (DEICTIC.test(q) || (short && !ftype))) return { kind: "contact", ftype: null };
  if (hasPlace && HOURS.test(q) && (DEICTIC.test(q) || (short && !ftype))) return { kind: "hours", ftype: null };
  if (ftype && (NEAREST.test(q) || NEAR_ME.test(q))) return { kind: "nearest", ftype };
  if (NEAR_ME.test(q)) return { kind: "nearby", ftype: null };
  if (DISTANCE.test(q)) {
    if (ftype && !hasPlace) return { kind: "nearest", ftype };
    return { kind: "distance", ftype: null };
  }
  if (NEAREST.test(q) && NEAREST_WORD.test(q)) return { kind: "nearest", ftype: null };
  return null;
}

export function isDirectionQuestion(q) {
  return DIRECTIONS.test(q) && !DIR_CONDITIONS.test(q);
}

// ---- questions about current conditions, answered from situation reports ----
// Mirrors report_query in app/services/intents.py.
const ROAD = rx(String.raw`\b(road|roads|street|st|avenue|ave|highway|hwy|bridge|tulay|daan|kalsada|kalye|route|daanan|lansangan)\b`);
const ROAD_STATE = rx(String.raw`\b(flood\w*|baha|binaha|bumabaha|lubog|blocked|block|closed|sarado|passable|madaanan|landslide|guho|harang` +
  String.raw`|open|bukas|clear)\b`);
const FLOOD_HERE = rx(String.raw`\b(is|are) (it|there|the area|this area|that area) (still )?flood\w*|\b(may|meron|merong) baha\b` +
  String.raw`|\bbaha (ba|pa|na|dito|doon|sa)\b|\b(bumabaha|binaha|lubog) (ba|pa|na)\b|\bflooded (now|today|right now|ngayon)\b` +
  String.raw`|\bany flood\w*\b|\b(is|are)\b.+\bflood(ed|ing)\b`);
const EVAC = TYPE_WORDS[0][1];
const CENTER_STATE = rx(String.raw`\b(full|puno|siksikan|space|room|bakante|open|bukas|accepting|tumatanggap|capacity|available|sarado|closed)\b`);
const POWER = rx(String.raw`\b(is|are) (there|the) (still )?(power|electricity|kuryente|brownout|blackout|power outage)\b` +
  String.raw`|\bpower (out|back|outage|interruption)\b|\b(may|wala|walang|meron|merong) (pa |pang )?(kuryente|ilaw)\b` +
  String.raw`|\b(brownout|blackout|power outage) (ba|pa|sa|in|at|na|now|ngayon|today)\b|\b(any|still) (brownout|blackout|power outage)s?\b`);
const WATER = rx(String.raw`\b(where|saan)\b.*\b(drinking water|tubig|water)\b|\b(drinking water|tubig|water) (available|distribution|rasyon|refill)\b` +
  String.raw`|\b(may|meron|merong) (malinis na )?tubig\b|\bwater (station|point)s?\b`);
const WATER_NOT = rx(String.raw`\b(purif\w*|boil\w*|pakuluan|clean|chlorine|how much|gaano|store|imbak|safe to drink|liters?|litro|pack)\b`);
const MEDICAL = rx(String.raw`\b(any|are there|may|meron)\b.*\b(medical|injur\w*|sugatan)\b.*\b(report\w*|need\w*|nangangailangan)\b` +
  String.raw`|\bmedical (help )?(needs|requests|reports)\b`);
const ANY_REPORTS = rx(String.raw`\b(any|latest|new|current|recent) (reports?|updates?|news|situation)\b|\bsituation reports?\b|\bwhat'?s happening\b` +
  String.raw`|\bano(ng)? (ang )?(balita|nangyayari|lagay)\b|\breports? (near|around|here|sa|in|on|for)\b|\bmay (report|balita)\b`);
const ADVICE = rx(String.raw`\b(what (should|do|can) (i|we) do|how (do|can|should) (i|we)|paano (ko|kung|mag\w*)|ano(ng)? (ang )?(gagawin|dapat)` +
  String.raw`|tips?|is it safe to|safe (ba )?(to|na|bang)|ligtas (ba )?(na|bang|mag\w*)|if|kung` +
  String.raw`|who (do|should|can) (i|we) (call|contact)|sino(ng)? (ang )?(tatawagan|tawagan)|hotlines?|numbers?` +
  String.raw`|warning signs?|signs? of|symptoms?)\b`);
export const REPORT_KIND_ORDER = ["road_flooded", "road_blocked", "center_full", "center_open", "water_available", "power_out", "medical_need"];

// Report kinds a question asks about ("Is P. Burgos flooded?" -> road kinds), or null.
export function reportQuery(question, placeIsCenter = false) {
  const q = question.trim();
  if (ADVICE.test(q)) return null;
  let kinds = [];
  if ((ROAD.test(q) && ROAD_STATE.test(q)) || FLOOD_HERE.test(q)) kinds.push("road_flooded", "road_blocked");
  // "Is it full?" about a selected center, but "Is the road open?" stays a road question.
  if ((EVAC.test(q) || (placeIsCenter && !kinds.length)) && CENTER_STATE.test(q)) kinds.push("center_full", "center_open");
  if (WATER.test(q) && !WATER_NOT.test(q)) kinds.push("water_available");
  if (POWER.test(q)) kinds.push("power_out");
  if (MEDICAL.test(q)) kinds.push("medical_need");
  if (!kinds.length && ANY_REPORTS.test(q)) kinds = [...REPORT_KIND_ORDER];
  return kinds.length ? kinds : null;
}
