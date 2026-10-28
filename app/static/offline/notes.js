// Report notes ("Ano ang nakikita mo?"): the checks done by code, never by AI. The hub has an
// exact copy (app/services/report_notes.py), the online reports Worker imports this file, and
// tests/test_report_notes.py checks all of them give the same result on shared cases.
//
// - cleanNote: contact details (phone numbers, emails, links) become "[tinanggal]"; at most
//   140 characters; empty -> null.
// - hasWord: whole-word match against a list from data/report_words.json (danger words show
//   "Call 911 now" on the phone; flag words mark a note for a responder to check).
// Only ASCII classes and no lookbehind, so it runs the same everywhere (older phones included).

export const MAX_NOTE = 140;
export const REMOVED = "[tinanggal]";

const CONTROL = /[\u0000-\u001f\u007f]+/g;
const SPACES = /\s+/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const LINK = /(?:https?:\/\/|www\.)\S+|\b[A-Za-z0-9-]+\.(?:com|ph|net|org|info|io|me|co)\b(?:\/\S*)?/gi;
const PHONE = /\+?\d[\d ().-]{5,}\d/g;

export function cleanNote(text) {
  if (typeof text !== "string") return null;
  let s = text.replace(CONTROL, " ").replace(SPACES, " ").trim();
  s = s.replace(EMAIL, REMOVED).replace(LINK, REMOVED);
  // Seven or more digits is a phone number; shorter runs are depths, times, house numbers.
  s = s.replace(PHONE, (m) => ((m.match(/\d/g) || []).length >= 7 ? REMOVED : m));
  const chars = Array.from(s); // count characters, not UTF-16 units (emoji)
  if (chars.length > MAX_NOTE) s = chars.slice(0, MAX_NOTE).join("").trim();
  return s || null;
}

const words = (s) => ` ${String(s).toLowerCase().replace(/[^a-z0-9']+/g, " ").trim()} `;

export function hasWord(text, list) {
  if (!text) return false;
  const t = words(text);
  return list.some((w) => {
    const p = words(w);
    return p.trim() !== "" && t.includes(p);
  });
}
