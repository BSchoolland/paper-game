import { createHash, randomBytes } from "node:crypto";
import type { ErrorCode, ProfilePayload, AccountStatsPayload } from "shared";
import { levelForXp, earnedTitleIds, TITLES } from "shared";
import { db } from "./db.js";

/**
 * All account-domain DB access (docs/meta-loop/01-accounts.md §5), on the shared db handle.
 * New tables are Supabase-shaped: TEXT UUID PKs, ISO-8601 TEXT timestamps. FK integrity is
 * app-enforced here with loud throws (the foreign_keys pragma is off, matching the schema).
 * The Postgres swap later touches this module plus db.ts only (§8).
 */

/** Domain failure carrying its wire error code; ws handlers map it to a recoverable error message. */
export class AccountError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AccountError";
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

// --- Validation (server boundary, §3.5) ---

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

export function validateUsername(username: string): string {
  if (typeof username !== "string" || !USERNAME_RE.test(username)) {
    throw new AccountError("INVALID_INPUT", "Username must be 3-20 characters: letters, digits, underscore");
  }
  return username;
}

export function validatePassword(password: string): string {
  if (typeof password !== "string" || password.length < 8 || password.length > 128) {
    throw new AccountError("INVALID_INPUT", "Password must be 8-128 characters");
  }
  return password;
}

export function validateDisplayName(name: string): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed.length < 1 || trimmed.length > 24) {
    throw new AccountError("INVALID_INPUT", "Display name must be 1-24 characters");
  }
  return trimmed;
}

export function validateEmail(email: string): string {
  if (typeof email !== "string" || !/.+@.+/.test(email)) {
    throw new AccountError("INVALID_INPUT", "That does not look like an email address");
  }
  return email;
}

export function validateChatText(text: string): string {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (trimmed.length < 1 || trimmed.length > 300) {
    throw new AccountError("INVALID_INPUT", "Chat messages must be 1-300 characters");
  }
  return trimmed;
}

// --- Accounts: guest mint / claim / register / login lookup ---

export interface AccountRow {
  id: string;
  username: string | null;
  password_hash: string | null;
  email: string | null;
  is_guest: number;
  guest_client_id: string | null;
  created_at: string;
  updated_at: string;
}

const accountByIdStmt = db.prepare("SELECT * FROM accounts WHERE id = ?");
const accountByUsernameStmt = db.prepare(
  "SELECT * FROM accounts WHERE username IS NOT NULL AND lower(username) = lower(?)",
);
const guestByClientIdStmt = db.prepare(
  "SELECT * FROM accounts WHERE guest_client_id = ? AND is_guest = 1",
);
const insertAccountStmt = db.prepare(
  `INSERT INTO accounts (id, username, password_hash, email, is_guest, guest_client_id, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
);
// `AND is_guest = 1` makes the claim atomic: two claims racing across the async password hash
// cannot both land — the loser's UPDATE hits 0 rows and throws NOT_A_GUEST.
const claimAccountStmt = db.prepare(
  `UPDATE accounts SET username = ?, password_hash = ?, email = ?, is_guest = 0, guest_client_id = NULL, updated_at = ?
   WHERE id = ? AND is_guest = 1`,
);
const insertProfileStmt = db.prepare(
  `INSERT INTO profiles (account_id, display_name, xp, equipped_title_id, created_at, updated_at)
   VALUES (?, ?, 0, NULL, ?, ?)`,
);
const backfillSeatsStmt = db.prepare(
  "UPDATE run_seats SET account_id = ? WHERE client_id = ? AND account_id IS NULL",
);

export function accountById(accountId: string): AccountRow {
  const row = accountByIdStmt.get(accountId) as AccountRow | null;
  if (!row) throw new AccountError("NO_SUCH_USER", `No account ${accountId}`);
  return row;
}

export function accountByUsername(username: string): AccountRow | null {
  return (accountByUsernameStmt.get(username) as AccountRow | null) ?? null;
}

function mintedGuestName(accountId: string): string {
  return `Wanderer-${accountId.slice(0, 4).toUpperCase()}`;
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Error && /UNIQUE constraint failed/i.test(e.message);
}

/** The guest account bound to a clientId, or null — lets callers rate-limit the MINT path only. */
export function findGuestAccount(clientId: string): AccountRow | null {
  return (guestByClientIdStmt.get(clientId) as AccountRow | null) ?? null;
}

/**
 * Reuse-or-mint the guest account bound to a clientId (§4.2). Minting also backfills
 * `run_seats.account_id` for this client's unattributed rows (pre-accounts history and any
 * crash-recovered active run attribute to the new guest). The unique-violation catch is
 * uniqueness-RACE resolution (two racing sockets, same clientId) — both resolve to one account.
 */
export function resolveGuestAccount(clientId: string): AccountRow {
  const existing = guestByClientIdStmt.get(clientId) as AccountRow | null;
  if (existing) return existing;

  const id = crypto.randomUUID();
  const now = nowIso();
  try {
    const mint = db.transaction(() => {
      insertAccountStmt.run(id, null, null, null, 1, clientId, now, now);
      insertProfileStmt.run(id, mintedGuestName(id), now, now);
      backfillSeatsStmt.run(id, clientId);
    });
    mint();
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const raced = guestByClientIdStmt.get(clientId) as AccountRow | null;
    if (!raced) throw e;
    return raced;
  }
  return accountById(id);
}

const profileNameStmt = db.prepare("SELECT display_name FROM profiles WHERE account_id = ?");
const setProfileNameStmt = db.prepare(
  "UPDATE profiles SET display_name = ?, updated_at = ? WHERE account_id = ?",
);

/**
 * Upgrade a guest account in place (§4.3). Clearing guest_client_id is load-bearing: it frees the
 * unique binding so a later sessionless hello from the device mints a fresh guest instead of
 * silently logging into the claimed account (password-bypass otherwise).
 */
export async function claimAccount(
  accountId: string,
  username: string,
  password: string,
  email?: string,
): Promise<AccountRow> {
  validateUsername(username);
  validatePassword(password);
  const cleanEmail = email !== undefined ? validateEmail(email) : null;
  const account = accountById(accountId);
  if (!account.is_guest) throw new AccountError("NOT_A_GUEST", "This account is already claimed");

  const hash = await Bun.password.hash(password, { algorithm: "argon2id" });
  let changes: number;
  try {
    changes = claimAccountStmt.run(username, hash, cleanEmail, nowIso(), accountId).changes;
  } catch (e) {
    if (isUniqueViolation(e)) throw new AccountError("USERNAME_TAKEN", "That username is taken");
    throw e;
  }
  // A concurrent claim won the race during the hash await: the guard above passed for both, but
  // only one UPDATE may land (else the second silently overwrites the first credentials).
  if (changes === 0) throw new AccountError("NOT_A_GUEST", "This account is already claimed");
  const profile = profileNameStmt.get(accountId) as { display_name: string } | null;
  if (profile && profile.display_name === mintedGuestName(accountId)) {
    setProfileNameStmt.run(username, nowIso(), accountId);
  }
  return accountById(accountId);
}

/** A fresh claimed account (+profile) — for users who want a new name without upgrading the guest. */
export async function registerAccount(username: string, password: string, email?: string): Promise<AccountRow> {
  validateUsername(username);
  validatePassword(password);
  const cleanEmail = email !== undefined ? validateEmail(email) : null;

  const hash = await Bun.password.hash(password, { algorithm: "argon2id" });
  const id = crypto.randomUUID();
  const now = nowIso();
  try {
    const create = db.transaction(() => {
      insertAccountStmt.run(id, username, hash, cleanEmail, 0, null, now, now);
      insertProfileStmt.run(id, username, now, now);
    });
    create();
  } catch (e) {
    if (isUniqueViolation(e)) throw new AccountError("USERNAME_TAKEN", "That username is taken");
    throw e;
  }
  return accountById(id);
}

/** Same INVALID_CREDENTIALS for unknown user and wrong password — no username enumeration. */
export async function verifyCredentials(username: string, password: string): Promise<AccountRow> {
  const account = accountByUsername(username);
  const ok = account?.password_hash ? await Bun.password.verify(password, account.password_hash) : false;
  if (!account || !ok) throw new AccountError("INVALID_CREDENTIALS", "Wrong username or password");
  return account;
}

// --- Sessions (bearer authToken; raw token never stored — sha256 only) ---

const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;
// A device that never persists its token (localStorage disabled) mints a session per connect; keep
// only the newest N per account so rows cannot accumulate for a year. An evicted device re-logs in.
const MAX_SESSIONS_PER_ACCOUNT = 20;

const insertSessionStmt = db.prepare(
  `INSERT INTO account_sessions (id, account_id, token_hash, created_at, last_seen_at, expires_at)
   VALUES (?, ?, ?, ?, ?, ?)`,
);
// rowid tiebreak: same-millisecond mints must evict in insertion order, not random-UUID order.
const trimSessionsStmt = db.prepare(
  `DELETE FROM account_sessions WHERE account_id = ?1 AND id NOT IN (
     SELECT id FROM account_sessions WHERE account_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT ?2
   )`,
);
const sessionByHashStmt = db.prepare("SELECT * FROM account_sessions WHERE token_hash = ?");
const touchSessionStmt = db.prepare(
  "UPDATE account_sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?",
);
const deleteSessionStmt = db.prepare("DELETE FROM account_sessions WHERE token_hash = ?");
const purgeSessionsStmt = db.prepare("DELETE FROM account_sessions WHERE expires_at < ?");

function tokenHash(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function mintSession(accountId: string): string {
  const raw = randomBytes(32).toString("hex");
  const now = Date.now();
  insertSessionStmt.run(
    crypto.randomUUID(),
    accountId,
    tokenHash(raw),
    new Date(now).toISOString(),
    new Date(now).toISOString(),
    new Date(now + SESSION_TTL_MS).toISOString(),
  );
  trimSessionsStmt.run(accountId, MAX_SESSIONS_PER_ACCOUNT);
  return raw;
}

export type SessionValidation =
  | { ok: true; accountId: string }
  | { ok: false; reason: "invalid" | "expired" };

/** Validate + slide (touch last_seen_at, extend expires_at by the full TTL). */
export function validateSession(rawToken: string): SessionValidation {
  const row = sessionByHashStmt.get(tokenHash(rawToken)) as
    | { account_id: string; expires_at: string }
    | null;
  if (!row) return { ok: false, reason: "invalid" };
  const now = Date.now();
  if (new Date(row.expires_at).getTime() <= now) return { ok: false, reason: "expired" };
  touchSessionStmt.run(new Date(now).toISOString(), new Date(now + SESSION_TTL_MS).toISOString(), tokenHash(rawToken));
  return { ok: true, accountId: row.account_id };
}

export function revokeSession(rawToken: string): void {
  deleteSessionStmt.run(tokenHash(rawToken));
}

export function purgeExpiredSessions(): number {
  return purgeSessionsStmt.run(nowIso()).changes;
}

// --- Profiles ---

interface ProfileRow {
  account_id: string;
  display_name: string;
  xp: number;
  equipped_title_id: string | null;
  created_at: string;
  updated_at: string;
}

const profileStmt = db.prepare("SELECT * FROM profiles WHERE account_id = ?");
const addXpStmt = db.prepare("UPDATE profiles SET xp = xp + ?, updated_at = ? WHERE account_id = ?");
const equipTitleStmt = db.prepare(
  "UPDATE profiles SET equipped_title_id = ?, updated_at = ? WHERE account_id = ?",
);

function profileRow(accountId: string): ProfileRow {
  const row = profileStmt.get(accountId) as ProfileRow | null;
  if (!row) throw new Error(`accounts: missing profile row for account ${accountId}`);
  return row;
}

export function loadProfilePayload(accountId: string): ProfilePayload {
  const account = accountById(accountId);
  const profile = profileRow(accountId);
  const stats = getStats(accountId);
  const statsPayload: AccountStatsPayload = {
    encountersWon: stats["encounters_won"] ?? 0,
    hexesCharted: stats["hexes_charted"] ?? 0,
    dimensionsDiscovered: stats["dimensions_discovered"] ?? 0,
    wipes: stats["wipes"] ?? 0,
    contractsCompleted: stats["contracts_completed"] ?? 0,
    dimensionsTraveled: stats["dimensions_traveled"] ?? 0,
    designsRecovered: stats["designs_recovered"] ?? 0,
    firstsRecovered: stats["firsts_recovered"] ?? 0,
  };
  return {
    accountId,
    displayName: profile.display_name,
    isGuest: account.is_guest === 1,
    username: account.username,
    xp: profile.xp,
    level: levelForXp(profile.xp),
    equippedTitleId: profile.equipped_title_id,
    titles: ownedTitleIds(accountId),
    stats: statsPayload,
    createdAt: account.created_at,
  };
}

/** The roster-card slice, cached on the in-memory Seat (broadcasts never hit the DB). */
export function loadCardProfile(accountId: string): {
  displayName: string;
  level: number;
  equippedTitleId: string | null;
} {
  const profile = profileRow(accountId);
  return {
    displayName: profile.display_name,
    level: levelForXp(profile.xp),
    equippedTitleId: profile.equipped_title_id,
  };
}

export function setDisplayName(accountId: string, name: string): string {
  const clean = validateDisplayName(name);
  profileRow(accountId); // loud on missing
  setProfileNameStmt.run(clean, nowIso(), accountId);
  return clean;
}

export function equipTitle(accountId: string, titleId: string | null): void {
  profileRow(accountId);
  if (titleId !== null && !ownedTitleIds(accountId).includes(titleId)) {
    throw new AccountError("INVALID_INPUT", "You have not earned that title");
  }
  equipTitleStmt.run(titleId, nowIso(), accountId);
}

// --- XP / stats ---

// Accounts-domain XP primitive. Since feature 2, src encounter/contract XP flows through the
// per-run pending ledger (db.accruePendingXp + finalizeRun banking); this direct writer is kept
// for the accounts unit tests and any future non-run grant.
export function awardXp(accountId: string, amount: number): { xp: number; level: number; leveledUp: boolean } {
  const before = profileRow(accountId).xp;
  addXpStmt.run(amount, nowIso(), accountId);
  const xp = before + amount;
  const level = levelForXp(xp);
  return { xp, level, leveledUp: level > levelForXp(before) };
}

const bumpStatStmt = db.prepare(
  `INSERT INTO account_stats (account_id, stat, value, updated_at) VALUES (?, ?, ?, ?)
   ON CONFLICT(account_id, stat) DO UPDATE SET value = value + excluded.value, updated_at = excluded.updated_at`,
);
const statsForAccountStmt = db.prepare("SELECT stat, value FROM account_stats WHERE account_id = ?");

export function bumpStat(accountId: string, stat: string, delta: number): void {
  bumpStatStmt.run(accountId, stat, delta, nowIso());
}

export function getStats(accountId: string): Record<string, number> {
  const rows = statsForAccountStmt.all(accountId) as { stat: string; value: number }[];
  const stats: Record<string, number> = {};
  for (const row of rows) stats[row.stat] = row.value;
  return stats;
}

const insertAccountDimensionStmt = db.prepare(
  "INSERT OR IGNORE INTO account_dimensions (account_id, dimension_id, first_seen_at) VALUES (?, ?, ?)",
);

/** Also feature 4's "charted addresses per account" source. Returns true iff first-ever for this account. */
export function recordDimensionSeen(accountId: string, dimensionId: number): boolean {
  const first = insertAccountDimensionStmt.run(accountId, dimensionId, nowIso()).changes > 0;
  if (first) bumpStat(accountId, "dimensions_discovered", 1);
  return first;
}

// --- Titles ---

const upsertTitleStmt = db.prepare(
  `INSERT INTO titles (id, name, description, sort_order) VALUES (?, ?, ?, ?)
   ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, sort_order = excluded.sort_order`,
);
const grantTitleStmt = db.prepare(
  "INSERT OR IGNORE INTO account_titles (account_id, title_id, earned_at) VALUES (?, ?, ?)",
);
const titlesForAccountStmt = db.prepare(
  "SELECT title_id FROM account_titles WHERE account_id = ? ORDER BY title_id",
);

/** Boot-time seed from the shared TITLES catalog — copy edits reach existing DBs without a migration. */
export function seedTitles(): void {
  const seed = db.transaction(() => {
    for (const t of TITLES) upsertTitleStmt.run(t.id, t.name, t.description, t.sortOrder);
  });
  seed();
}

export function ownedTitleIds(accountId: string): string[] {
  return (titlesForAccountStmt.all(accountId) as { title_id: string }[]).map((r) => r.title_id);
}

/** Grant every title the account's stats/level now satisfy; returns only the NEWLY granted ids. */
export function evaluateTitles(accountId: string): string[] {
  const level = levelForXp(profileRow(accountId).xp);
  const earned = earnedTitleIds(getStats(accountId), level);
  const now = nowIso();
  const newlyGranted: string[] = [];
  for (const titleId of earned) {
    if (grantTitleStmt.run(accountId, titleId, now).changes > 0) newlyGranted.push(titleId);
  }
  return newlyGranted;
}

// --- Friends ---

interface FriendRow {
  account_id: string;
  friend_id: string;
  status: "pending" | "accepted";
  created_at: string;
}

const friendEdgeStmt = db.prepare(
  "SELECT * FROM friends WHERE (account_id = ?1 AND friend_id = ?2) OR (account_id = ?2 AND friend_id = ?1)",
);
const insertFriendStmt = db.prepare(
  "INSERT INTO friends (account_id, friend_id, status, created_at) VALUES (?, ?, 'pending', ?)",
);
const acceptFriendStmt = db.prepare(
  "UPDATE friends SET status = 'accepted' WHERE account_id = ? AND friend_id = ? AND status = 'pending'",
);
const deletePendingEitherStmt = db.prepare(
  `DELETE FROM friends WHERE status = 'pending'
   AND ((account_id = ?1 AND friend_id = ?2) OR (account_id = ?2 AND friend_id = ?1))`,
);
const deleteAcceptedEitherStmt = db.prepare(
  `DELETE FROM friends WHERE status = 'accepted'
   AND ((account_id = ?1 AND friend_id = ?2) OR (account_id = ?2 AND friend_id = ?1))`,
);
const friendRowsForAccountStmt = db.prepare(
  "SELECT * FROM friends WHERE account_id = ? OR friend_id = ?",
);

function requireClaimed(accountId: string): AccountRow {
  const account = accountById(accountId);
  if (account.is_guest) throw new AccountError("CLAIM_REQUIRED", "Claim your account to add friends");
  return account;
}

/**
 * Username-keyed friend request (§5 friends rules). An opposite-direction pending request
 * auto-accepts (mutual intent). Returns the target account id and whether it auto-accepted.
 */
export function sendFriendRequest(fromAccountId: string, toUsername: string): { toAccountId: string; autoAccepted: boolean } {
  requireClaimed(fromAccountId);
  const target = accountByUsername(toUsername);
  if (!target || target.is_guest) throw new AccountError("NO_SUCH_USER", "No player with that username");
  if (target.id === fromAccountId) throw new AccountError("INVALID_INPUT", "You cannot befriend yourself");

  const edge = friendEdgeStmt.get(fromAccountId, target.id) as FriendRow | null;
  if (edge) {
    if (edge.status === "accepted") throw new AccountError("INVALID_INPUT", "You are already friends");
    if (edge.account_id === fromAccountId) throw new AccountError("INVALID_INPUT", "Request already sent");
    // They already asked us: mutual intent -> auto-accept their pending request.
    acceptFriendStmt.run(edge.account_id, edge.friend_id);
    return { toAccountId: target.id, autoAccepted: true };
  }
  insertFriendStmt.run(fromAccountId, target.id, nowIso());
  return { toAccountId: target.id, autoAccepted: false };
}

/** Only the pending row's TARGET may accept. */
export function acceptFriend(accountId: string, requesterId: string): void {
  requireClaimed(accountId);
  if (acceptFriendStmt.run(requesterId, accountId).changes === 0) {
    throw new AccountError("INVALID_INPUT", "No pending request from that player");
  }
}

/** Decline an incoming request OR cancel one's own outgoing (either side of a pending row). */
export function declineFriend(accountId: string, otherId: string): void {
  if (deletePendingEitherStmt.run(accountId, otherId).changes === 0) {
    throw new AccountError("INVALID_INPUT", "No pending request with that player");
  }
}

export function removeFriend(accountId: string, otherId: string): void {
  if (deleteAcceptedEitherStmt.run(accountId, otherId).changes === 0) {
    throw new AccountError("INVALID_INPUT", "You are not friends with that player");
  }
}

export interface FriendLists {
  friends: string[];
  incoming: { accountId: string; sentAt: string }[];
  outgoing: { accountId: string; sentAt: string }[];
}

/** Raw id-level friend lists; the social layer decorates with profile/presence/roomCode. */
export function listFriends(accountId: string): FriendLists {
  const rows = friendRowsForAccountStmt.all(accountId, accountId) as FriendRow[];
  const lists: FriendLists = { friends: [], incoming: [], outgoing: [] };
  for (const row of rows) {
    const other = row.account_id === accountId ? row.friend_id : row.account_id;
    if (row.status === "accepted") lists.friends.push(other);
    else if (row.account_id === accountId) lists.outgoing.push({ accountId: other, sentAt: row.created_at });
    else lists.incoming.push({ accountId: other, sentAt: row.created_at });
  }
  return lists;
}

export function acceptedFriendIds(accountId: string): string[] {
  return listFriends(accountId).friends;
}
