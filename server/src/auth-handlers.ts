import type { ServerWebSocket } from "bun";
import type { AuthStatePayload, ClientMessage, ErrorCode } from "shared";
import type { SocketData } from "./room.js";
import {
  AccountError,
  accountById,
  findGuestAccount,
  resolveGuestAccount,
  claimAccount,
  registerAccount,
  verifyCredentials,
  mintSession,
  validateSession,
  revokeSession,
  loadProfilePayload,
} from "./accounts.js";
import * as presence from "./presence.js";
import { pushFriendsListTo, pushPresenceDelta, refreshSeatIdentity } from "./social-handlers.js";
import { sendTo } from "./wire-transport.js";

/**
 * Connection-account resolution + claim/register/login/logout (docs/meta-loop/01-accounts.md §4).
 * The HMAC seat token machinery is a separate, untouched credential (§4.5) — never conflate.
 */

function sendError(ws: ServerWebSocket<SocketData>, code: ErrorCode, message: string): void {
  sendTo(ws, { type: "error", code, message, recoverable: true });
}

/** Sliding-window rate limiter keyed by string. Sweeps stale keys once the map grows large, so
 *  attacker-chosen keys (usernames, rotating addresses) cannot accumulate unbounded. */
class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string): boolean {
    const now = Date.now();
    if (this.hits.size > 10_000) this.sweep(now);
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  private sweep(now: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
    }
  }
}

// Per-socket limiter: max 5 login/register/claim attempts per 60s (§4.4).
const AUTH_ATTEMPT_LIMIT = 5;
const AUTH_ATTEMPT_WINDOW_MS = 60_000;
const authAttempts = new WeakMap<ServerWebSocket<SocketData>, number[]>();

// Reconnect-proof backstops: the per-socket budget resets on every fresh socket, so credential
// attempts are ALSO capped per address and (login) per target username — otherwise a reconnect loop
// gets unlimited guesses, each costing the server an argon2 verify (CPU amplification).
const addressAuthLimiter = new SlidingWindowLimiter(30, 10 * 60_000);
const usernameLoginLimiter = new SlidingWindowLimiter(10, 60_000);
// Guest-account minting writes 3 durable rows per novel clientId; cap mints per address so a
// connect loop with random clientIds cannot flood accounts/profiles/sessions.
const guestMintLimiter = new SlidingWindowLimiter(120, 10 * 60_000);

function allowAuthAttempt(ws: ServerWebSocket<SocketData>): boolean {
  const now = Date.now();
  const recent = (authAttempts.get(ws) ?? []).filter((t) => now - t < AUTH_ATTEMPT_WINDOW_MS);
  authAttempts.set(ws, recent);
  if (recent.length >= AUTH_ATTEMPT_LIMIT) return false;
  recent.push(now);
  return addressAuthLimiter.allow(ws.remoteAddress);
}

export interface AccountResolution {
  readonly isGuest: boolean;
  readonly authRejected?: "expired" | "invalid";
}

/**
 * Hello-time account resolution (§4.2): a valid authToken restores its account (sliding expiry);
 * an invalid/expired one is SURFACED via authRejected and falls through to guest resolution
 * (reuse-or-mint keyed on guest_client_id). Sets ws.data.accountId/authToken and registers presence.
 * Throws AccountError("RATE_LIMITED") when the address exhausted its guest-mint budget — the hello
 * handler surfaces it and closes the socket.
 */
export function resolveConnectionAccount(
  ws: ServerWebSocket<SocketData>,
  msg: Extract<ClientMessage, { type: "hello" }>,
): AccountResolution {
  let authRejected: "expired" | "invalid" | undefined;
  let accountId: string | null = null;
  let rawToken: string | null = null;

  if (msg.authToken) {
    const result = validateSession(msg.authToken);
    if (result.ok) {
      accountId = result.accountId;
      rawToken = msg.authToken;
    } else {
      authRejected = result.reason;
    }
  }
  if (!accountId) {
    let guest = findGuestAccount(ws.data.clientId);
    if (!guest) {
      if (!guestMintLimiter.allow(ws.remoteAddress)) {
        throw new AccountError("RATE_LIMITED", "Too many new connections from this address; try again later");
      }
      guest = resolveGuestAccount(ws.data.clientId);
    }
    accountId = guest.id;
    rawToken = mintSession(accountId);
  }

  // A repeated hello may resolve differently (new token); drop any prior registration first so
  // the socket is never presence-registered under two accounts.
  if (ws.data.accountId && ws.data.accountId !== accountId) {
    const prev = presence.unregister(ws);
    if (prev?.wentOffline) pushPresenceDelta(prev.accountId);
  }
  ws.data.accountId = accountId;
  ws.data.authToken = rawToken;
  if (presence.register(accountId, ws)) pushPresenceDelta(accountId);

  return { isGuest: accountById(accountId).is_guest === 1, ...(authRejected ? { authRejected } : {}) };
}

/** Build the welcome/authState payload from the socket's resolved account. Throws if hello never ran. */
export function buildAuthState(
  ws: ServerWebSocket<SocketData>,
  authRejected?: "expired" | "invalid",
): AuthStatePayload {
  const { accountId, authToken } = ws.data;
  if (!accountId || !authToken) {
    throw new Error("buildAuthState: no resolved account on this socket (hello must run first)");
  }
  const account = accountById(accountId);
  return {
    accountId,
    isGuest: account.is_guest === 1,
    username: account.username,
    authToken,
    profile: loadProfilePayload(accountId),
    ...(authRejected ? { authRejected } : {}),
  };
}

/** Swap the socket onto another account: presence unregister/register with friend pushes for both. */
function switchAccount(ws: ServerWebSocket<SocketData>, accountId: string, rawToken: string): void {
  const prev = presence.unregister(ws);
  if (prev?.wentOffline) pushPresenceDelta(prev.accountId);
  ws.data.accountId = accountId;
  ws.data.authToken = rawToken;
  if (presence.register(accountId, ws)) pushPresenceDelta(accountId);
}

function handleAuthFailure(ws: ServerWebSocket<SocketData>, kind: string, e: unknown): void {
  if (e instanceof AccountError) {
    if (ws.readyState === 1) sendError(ws, e.code, e.message);
    return;
  }
  // Fail loud both ways: server log + client error (a rejected promise must never vanish, §5).
  console.error(`[auth] ${kind} failed:`, e);
  if (ws.readyState === 1) sendError(ws, "MALFORMED", `The server could not process that ${kind}`);
}

/** Claim: guest -> named account, allowed anytime, even mid-run (upgrade-in-place, §4.3). */
export async function handleClaimAccount(
  ws: ServerWebSocket<SocketData>,
  msg: Extract<ClientMessage, { type: "claimAccount" }>,
): Promise<void> {
  try {
    if (!allowAuthAttempt(ws)) throw new AccountError("RATE_LIMITED", "Too many attempts; wait a minute");
    const accountId = ws.data.accountId;
    if (!accountId) throw new Error("claimAccount before hello account resolution");
    await claimAccount(accountId, msg.username, msg.password, msg.email);
    if (ws.readyState !== 1) return;
    refreshSeatIdentity(ws); // seated claims rename the roster card + durable row
    sendTo(ws, { type: "authState", auth: buildAuthState(ws) });
    pushFriendsListTo(accountId);
  } catch (e) {
    handleAuthFailure(ws, "claim", e);
  }
}

/** Register: a brand-new claimed account (does NOT upgrade the current guest), then log into it. */
export async function handleRegister(
  ws: ServerWebSocket<SocketData>,
  msg: Extract<ClientMessage, { type: "register" }>,
): Promise<void> {
  try {
    if (ws.data.roomCode !== null) throw new AccountError("AUTH_IN_ROOM", "Leave your room before switching accounts");
    if (!allowAuthAttempt(ws)) throw new AccountError("RATE_LIMITED", "Too many attempts; wait a minute");
    const account = await registerAccount(msg.username, msg.password, msg.email);
    if (ws.readyState !== 1) return;
    // Re-check AFTER the await: a joinRoom processed during the password hash may have seated this
    // socket, and a seated socket must never switch accounts (§4.4 — attribution frozen per seat).
    // The account row was already created; its owner can simply log into it later.
    if (ws.data.roomCode !== null) throw new AccountError("AUTH_IN_ROOM", "Leave your room before switching accounts");
    switchAccount(ws, account.id, mintSession(account.id));
    sendTo(ws, { type: "authState", auth: buildAuthState(ws) });
    pushFriendsListTo(account.id);
  } catch (e) {
    handleAuthFailure(ws, "register", e);
  }
}

export async function handleLogin(
  ws: ServerWebSocket<SocketData>,
  msg: Extract<ClientMessage, { type: "login" }>,
): Promise<void> {
  try {
    if (ws.data.roomCode !== null) throw new AccountError("AUTH_IN_ROOM", "Leave your room before switching accounts");
    if (!allowAuthAttempt(ws) || !usernameLoginLimiter.allow(msg.username.toLowerCase())) {
      throw new AccountError("RATE_LIMITED", "Too many attempts; wait a minute");
    }
    const account = await verifyCredentials(msg.username, msg.password);
    if (ws.readyState !== 1) return;
    // Re-check AFTER the await: a joinRoom processed during the argon2 verify may have seated this
    // socket, and a seated socket must never switch accounts (§4.4 — attribution frozen per seat).
    if (ws.data.roomCode !== null) throw new AccountError("AUTH_IN_ROOM", "Leave your room before switching accounts");
    switchAccount(ws, account.id, mintSession(account.id)); // one session row per device
    sendTo(ws, { type: "authState", auth: buildAuthState(ws) });
    pushFriendsListTo(account.id);
  } catch (e) {
    handleAuthFailure(ws, "login", e);
  }
}

/** Logout: revoke the session, fall back to this device's guest account (always an account underneath). */
export function handleLogout(ws: ServerWebSocket<SocketData>): void {
  try {
    if (ws.data.roomCode !== null) throw new AccountError("AUTH_IN_ROOM", "Leave your room before logging out");
    if (!ws.data.authToken) throw new Error("logout before hello account resolution");
    revokeSession(ws.data.authToken);
    const guest = resolveGuestAccount(ws.data.clientId);
    switchAccount(ws, guest.id, mintSession(guest.id));
    sendTo(ws, { type: "authState", auth: buildAuthState(ws) });
  } catch (e) {
    if (e instanceof AccountError) return sendError(ws, e.code, e.message);
    throw e;
  }
}
