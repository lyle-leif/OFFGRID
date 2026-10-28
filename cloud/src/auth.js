// Personal responder accounts for the online reports (they replace the hub's shared PIN).
//
// The admin makes each account with tools/cloud_admin.mjs, which prints a long random password
// once. Because passwords are random (about 100 bits), a salted SHA-256 is enough to store them,
// and it stays inside the Workers free plan's CPU limit (slow password hashes would not).
// Every login, logout, verify and remove goes into the audit log.

import { randomHex, sha256 } from "./reports.js";

export const SESSION_S = 12 * 3600;
export const MAX_FAILURES = 5;
export const LOCK_S = 10 * 60;
// Letters and digits that can't be mistaken for each other when read aloud or typed.
const PASSWORD_CHARS = "abcdefghjkmnpqrstuvwxyz23456789";

export const hashPassword = (salt, password) => sha256(`${salt}:${password}`);
export const validName = (name) => typeof name === "string" && /^[A-Za-z0-9][A-Za-z0-9 .-]{1,39}$/.test(name);

export function newPassword(groups = 4) {
  const bytes = crypto.getRandomValues(new Uint8Array(groups * 5));
  const chars = [...bytes].map((b) => PASSWORD_CHARS[b % PASSWORD_CHARS.length]);
  return Array.from({ length: groups }, (_, i) => chars.slice(i * 5, i * 5 + 5).join("")).join("-");
}

export async function audit(db, name, action, reportId, now) {
  await db.prepare("INSERT INTO audit (at, name, action, report_id) VALUES (?, ?, ?, ?)").bind(now, name, action, reportId ?? null).run();
}

// Returns { token, name } or { error: "login_wrong" | "login_locked" }.
export async function login(db, name, password, now) {
  if (!validName(name) || typeof password !== "string" || password.length > 100) return { error: "login_wrong" };
  const acc = await db.prepare("SELECT name, salt, pw_hash, active, failures, locked_until FROM accounts WHERE name = ?").bind(name).first();
  if (!acc || !acc.active) return { error: "login_wrong" };
  if (acc.locked_until > now) return { error: "login_locked" };
  // Passwords are made lowercase by newPassword(); phones often capitalize the first letter.
  if ((await hashPassword(acc.salt, password.trim().toLowerCase())) !== acc.pw_hash) {
    const failures = acc.failures + 1;
    const locked = failures >= MAX_FAILURES;
    await db.prepare("UPDATE accounts SET failures = ?, locked_until = ? WHERE name = ?")
      .bind(locked ? 0 : failures, locked ? now + LOCK_S : acc.locked_until, name).run();
    await audit(db, name, locked ? "locked" : "login_failed", null, now);
    return { error: locked ? "login_locked" : "login_wrong" };
  }
  const token = randomHex(32);
  await db.batch([
    db.prepare("UPDATE accounts SET failures = 0 WHERE name = ?").bind(name),
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    db.prepare("INSERT INTO sessions (token_hash, name, expires_at) VALUES (?, ?, ?)").bind(await sha256(token), name, now + SESSION_S),
  ]);
  await audit(db, name, "login", null, now);
  return { token, name };
}

// The responder behind a "Bearer <token>" header, or null.
export async function sessionName(db, header, now) {
  const token = /^Bearer ([0-9a-f]{64})$/.exec(header ?? "")?.[1];
  if (!token) return null;
  const row = await db.prepare(
    "SELECT s.name AS name FROM sessions s JOIN accounts a ON a.name = s.name WHERE s.token_hash = ? AND s.expires_at > ? AND a.active = 1")
    .bind(await sha256(token), now).first();
  return row?.name ?? null;
}

export async function logout(db, header, now) {
  const name = await sessionName(db, header, now);
  const token = /^Bearer ([0-9a-f]{64})$/.exec(header ?? "")?.[1];
  if (token) await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  if (name) await audit(db, name, "logout", null, now);
  return name;
}
