import { describe, it, expect } from "bun:test";
import { createHash } from "node:crypto";

// db.ts/accounts.ts open the Database at module load from GAME_DB_PATH, so set the env BEFORE
// importing (a static import would hoist above these assignments). :memory: keeps it hermetic.
process.env.GAME_DB_PATH = ":memory:";
process.env.GAME_SKIP_SEED = "1";
const dbmod = await import("../db.js");
const accounts = await import("../accounts.js");
accounts.seedTitles();

const rawDb = dbmod.db;

function errCode(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof accounts.AccountError ? e.code : `OTHER:${String(e)}`;
  }
}

async function errCodeAsync(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof accounts.AccountError ? e.code : `OTHER:${String(e)}`;
  }
}

let seq = 0;
function uname(prefix: string): string {
  return `${prefix}${++seq}${Math.random().toString(36).slice(2, 8)}`.slice(0, 20);
}

describe("accounts: guest mint", () => {
  it("is idempotent per clientId; distinct clientIds get distinct accounts", () => {
    const a1 = accounts.resolveGuestAccount("mint-dev-a");
    const a2 = accounts.resolveGuestAccount("mint-dev-a");
    const b = accounts.resolveGuestAccount("mint-dev-b");
    expect(a1.id).toBe(a2.id);
    expect(a1.is_guest).toBe(1);
    expect(a1.guest_client_id).toBe("mint-dev-a");
    expect(b.id).not.toBe(a1.id);
    expect(accounts.loadCardProfile(a1.id).displayName).toBe(`Wanderer-${a1.id.slice(0, 4).toUpperCase()}`);
  });

  it("mint backfills pre-existing NULL-account run_seats rows for the clientId", () => {
    const runId = dbmod.startNewRun(1, "backfill-dev", 2);
    dbmod.upsertRunSeat(runId, 0, {
      clientId: "backfill-dev",
      displayName: "Old",
      controllerKind: "human",
      tokenSalt: dbmod.newTokenSalt(),
      accountId: null,
    });
    const account = accounts.resolveGuestAccount("backfill-dev");
    expect(dbmod.loadRunSeats(runId)[0]!.account_id).toBe(account.id);
  });

  it("a simulated unique-race (insert conflict) resolves both callers to ONE account", () => {
    const clientId = "race-dev";
    const winnerId = crypto.randomUUID();
    const realTransaction = rawDb.transaction.bind(rawDb);
    // Interleave the "other socket" between our SELECT-miss and INSERT: when resolveGuestAccount
    // asks for its mint transaction, first commit the racing winner's rows, then let the real
    // transaction run — its INSERT hits the guest_client_id UNIQUE and must re-select the winner.
    (rawDb as { transaction: unknown }).transaction = (fn: () => void) => {
      (rawDb as { transaction: unknown }).transaction = realTransaction;
      const now = new Date().toISOString();
      rawDb
        .prepare(
          `INSERT INTO accounts (id, username, password_hash, email, is_guest, guest_client_id, created_at, updated_at)
           VALUES (?, NULL, NULL, NULL, 1, ?, ?, ?)`,
        )
        .run(winnerId, clientId, now, now);
      rawDb
        .prepare(
          `INSERT INTO profiles (account_id, display_name, xp, equipped_title_id, created_at, updated_at)
           VALUES (?, 'Wanderer-RACE', 0, NULL, ?, ?)`,
        )
        .run(winnerId, now, now);
      return realTransaction(fn);
    };
    try {
      const resolved = accounts.resolveGuestAccount(clientId);
      expect(resolved.id).toBe(winnerId);
    } finally {
      (rawDb as { transaction: unknown }).transaction = realTransaction;
    }
    const rows = rawDb.prepare("SELECT count(*) AS n FROM accounts WHERE guest_client_id = ?").get(clientId) as {
      n: number;
    };
    expect(rows.n).toBe(1);
  });
});

describe("accounts: claim / register / login lookup", () => {
  it("claim preserves username casing, clears guest_client_id, flips is_guest, hashes the password", async () => {
    const guest = accounts.resolveGuestAccount("claim-dev-1");
    const username = uname("CasePreserve_");
    const claimed = await accounts.claimAccount(guest.id, username, "password123");
    expect(claimed.id).toBe(guest.id); // upgrade in place — XP/stats/titles carry over
    expect(claimed.username).toBe(username); // stored as typed
    expect(claimed.is_guest).toBe(0);
    expect(claimed.guest_client_id).toBeNull();
    expect(await Bun.password.verify("password123", claimed.password_hash!)).toBe(true);
    // The minted Wanderer default display name upgrades to the username.
    expect(accounts.loadCardProfile(guest.id).displayName).toBe(username);
  });

  it("second claim is NOT_A_GUEST; username collision is case-insensitive USERNAME_TAKEN", async () => {
    const guest = accounts.resolveGuestAccount("claim-dev-2");
    const username = uname("Bob_");
    await accounts.claimAccount(guest.id, username, "password123");
    expect(await errCodeAsync(accounts.claimAccount(guest.id, uname("Again_"), "password123"))).toBe("NOT_A_GUEST");

    const other = accounts.resolveGuestAccount("claim-dev-3");
    expect(await errCodeAsync(accounts.claimAccount(other.id, username.toLowerCase(), "password123"))).toBe(
      "USERNAME_TAKEN",
    );
  });

  it("two claims racing across the hash await: exactly one lands, the loser gets NOT_A_GUEST", async () => {
    const guest = accounts.resolveGuestAccount("claim-race-dev");
    const winner = uname("First_");
    const loser = uname("Second_");
    // Both pass the synchronous is_guest pre-check before either hash resolves.
    const [a, b] = await Promise.allSettled([
      accounts.claimAccount(guest.id, winner, "password123"),
      accounts.claimAccount(guest.id, loser, "password456"),
    ]);
    const outcomes = [a, b];
    expect(outcomes.filter((o) => o.status === "fulfilled").length).toBe(1);
    const rejected = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as InstanceType<typeof accounts.AccountError>).code).toBe("NOT_A_GUEST");
    // The stored credentials belong to the single winner — never a silent overwrite.
    const account = accounts.accountById(guest.id);
    expect([winner, loser]).toContain(account.username!);
    const won = account.username === winner ? "password123" : "password456";
    expect(await Bun.password.verify(won, account.password_hash!)).toBe(true);
  });

  it("claim validates input (INVALID_INPUT on bad username / short password / bad email)", async () => {
    const guest = accounts.resolveGuestAccount("claim-dev-4");
    expect(await errCodeAsync(accounts.claimAccount(guest.id, "x", "password123"))).toBe("INVALID_INPUT");
    expect(await errCodeAsync(accounts.claimAccount(guest.id, uname("Ok_"), "short"))).toBe("INVALID_INPUT");
    expect(await errCodeAsync(accounts.claimAccount(guest.id, uname("Ok_"), "password123", "not-an-email"))).toBe(
      "INVALID_INPUT",
    );
  });

  it("verifyCredentials: wrong password and unknown user share INVALID_CREDENTIALS (no enumeration)", async () => {
    const username = uname("Login_");
    await accounts.registerAccount(username, "password123");
    const ok = await accounts.verifyCredentials(username.toLowerCase(), "password123"); // ci lookup
    expect(ok.username).toBe(username);
    expect(await errCodeAsync(accounts.verifyCredentials(username, "wrongpassword"))).toBe("INVALID_CREDENTIALS");
    expect(await errCodeAsync(accounts.verifyCredentials("no_such_user_xyz", "password123"))).toBe(
      "INVALID_CREDENTIALS",
    );
  });

  it("logout->guest: the same device re-resolves its PRIOR guest; a claimed account is never resolved sessionlessly", async () => {
    const g1 = accounts.resolveGuestAccount("logout-dev");
    await accounts.claimAccount(g1.id, uname("Claimer_"), "password123");
    // Sessionless resolution now mints a FRESH guest (claiming freed the guest_client_id binding).
    const g2 = accounts.resolveGuestAccount("logout-dev");
    expect(g2.id).not.toBe(g1.id);
    expect(g2.is_guest).toBe(1);
    // ...and that fresh guest is the device's stable fallback identity from here on.
    expect(accounts.resolveGuestAccount("logout-dev").id).toBe(g2.id);
  });
});

describe("accounts: sessions", () => {
  function sessionRow(raw: string): { account_id: string; expires_at: string } | null {
    const hash = createHash("sha256").update(raw).digest("hex");
    return rawDb.prepare("SELECT account_id, expires_at FROM account_sessions WHERE token_hash = ?").get(hash) as {
      account_id: string;
      expires_at: string;
    } | null;
  }

  it("validates the happy path; the raw token is never stored (sha256 only)", () => {
    const account = accounts.resolveGuestAccount("sess-dev-1");
    const raw = accounts.mintSession(account.id);
    const result = accounts.validateSession(raw);
    expect(result).toEqual({ ok: true, accountId: account.id });
    const stored = rawDb.prepare("SELECT token_hash FROM account_sessions WHERE account_id = ?").get(account.id) as {
      token_hash: string;
    };
    expect(stored.token_hash).not.toBe(raw);
    expect(stored.token_hash).toBe(createHash("sha256").update(raw).digest("hex"));
  });

  it("rejects garbage as invalid and past-expiry as expired; revocation (logout) rejects", () => {
    const account = accounts.resolveGuestAccount("sess-dev-2");
    expect(accounts.validateSession("garbage")).toEqual({ ok: false, reason: "invalid" });

    const raw = accounts.mintSession(account.id);
    const hash = createHash("sha256").update(raw).digest("hex");
    rawDb
      .prepare("UPDATE account_sessions SET expires_at = ? WHERE token_hash = ?")
      .run(new Date(Date.now() - 1000).toISOString(), hash);
    expect(accounts.validateSession(raw)).toEqual({ ok: false, reason: "expired" });

    const raw2 = accounts.mintSession(account.id);
    accounts.revokeSession(raw2);
    expect(accounts.validateSession(raw2)).toEqual({ ok: false, reason: "invalid" });
  });

  it("sliding expiry: a validate pushes expires_at out", () => {
    const account = accounts.resolveGuestAccount("sess-dev-3");
    const raw = accounts.mintSession(account.id);
    const hash = createHash("sha256").update(raw).digest("hex");
    const nearPast = new Date(Date.now() + 60_000).toISOString(); // still valid, but nearly "old"
    rawDb.prepare("UPDATE account_sessions SET expires_at = ? WHERE token_hash = ?").run(nearPast, hash);
    expect(accounts.validateSession(raw).ok).toBe(true);
    const after = sessionRow(raw)!;
    expect(new Date(after.expires_at).getTime()).toBeGreaterThan(new Date(nearPast).getTime());
  });

  it("mintSession keeps only the newest 20 rows per account (token-less devices cannot flood)", () => {
    const account = accounts.resolveGuestAccount("sess-cap-dev");
    const raws: string[] = [];
    for (let i = 0; i < 25; i++) raws.push(accounts.mintSession(account.id));
    const { n } = rawDb
      .prepare("SELECT COUNT(*) AS n FROM account_sessions WHERE account_id = ?")
      .get(account.id) as { n: number };
    expect(n).toBe(20);
    expect(accounts.validateSession(raws[0]!)).toEqual({ ok: false, reason: "invalid" }); // oldest evicted
    expect(accounts.validateSession(raws[24]!).ok).toBe(true); // newest survives
  });

  it("purgeExpiredSessions deletes only expired rows", () => {
    const account = accounts.resolveGuestAccount("sess-dev-4");
    const live = accounts.mintSession(account.id);
    const dead = accounts.mintSession(account.id);
    rawDb
      .prepare("UPDATE account_sessions SET expires_at = ? WHERE token_hash = ?")
      .run(new Date(Date.now() - 1000).toISOString(), createHash("sha256").update(dead).digest("hex"));
    accounts.purgeExpiredSessions();
    expect(sessionRow(dead)).toBeNull();
    expect(accounts.validateSession(live).ok).toBe(true);
  });
});

describe("accounts: stats / XP / titles", () => {
  it("bumpStat upserts and accumulates; awardXp totals and reports level-ups", () => {
    const account = accounts.resolveGuestAccount("xp-dev-1");
    accounts.bumpStat(account.id, "hexes_charted", 1);
    accounts.bumpStat(account.id, "hexes_charted", 2);
    expect(accounts.getStats(account.id)["hexes_charted"]).toBe(3);

    expect(accounts.awardXp(account.id, 25)).toEqual({ xp: 25, level: 1, leveledUp: false });
    expect(accounts.awardXp(account.id, 75)).toEqual({ xp: 100, level: 2, leveledUp: true });
    expect(accounts.loadProfilePayload(account.id).xp).toBe(100);
  });

  it("evaluateTitles grants greenhorn at 1 win and veteran at level 5, idempotently", () => {
    const account = accounts.resolveGuestAccount("title-dev-1");
    expect(accounts.evaluateTitles(account.id)).toEqual([]);
    accounts.bumpStat(account.id, "encounters_won", 1);
    expect(accounts.evaluateTitles(account.id)).toEqual(["greenhorn"]);
    expect(accounts.evaluateTitles(account.id)).toEqual([]); // already granted

    accounts.awardXp(account.id, 1000); // level 5
    expect(accounts.evaluateTitles(account.id)).toEqual(["veteran"]);
    expect(accounts.ownedTitleIds(account.id).sort()).toEqual(["greenhorn", "veteran"]);
  });

  it("equipTitle rejects unowned titles and accepts owned / null", () => {
    const account = accounts.resolveGuestAccount("title-dev-2");
    expect(errCode(() => accounts.equipTitle(account.id, "slayer"))).toBe("INVALID_INPUT");
    accounts.bumpStat(account.id, "encounters_won", 1);
    accounts.evaluateTitles(account.id);
    accounts.equipTitle(account.id, "greenhorn");
    expect(accounts.loadProfilePayload(account.id).equippedTitleId).toBe("greenhorn");
    accounts.equipTitle(account.id, null);
    expect(accounts.loadProfilePayload(account.id).equippedTitleId).toBeNull();
  });

  it("recordDimensionSeen is first-insert-only for the dimensions_discovered stat", () => {
    const account = accounts.resolveGuestAccount("dim-dev-1");
    expect(accounts.recordDimensionSeen(account.id, 1)).toBe(true);
    expect(accounts.recordDimensionSeen(account.id, 1)).toBe(false);
    expect(accounts.recordDimensionSeen(account.id, 2)).toBe(true);
    expect(accounts.getStats(account.id)["dimensions_discovered"]).toBe(2);
  });
});

describe("accounts: friends", () => {
  async function claimedPair(): Promise<[{ id: string; username: string }, { id: string; username: string }]> {
    const a = await accounts.registerAccount(uname("FrA_"), "password123");
    const b = await accounts.registerAccount(uname("FrB_"), "password123");
    return [
      { id: a.id, username: a.username! },
      { id: b.id, username: b.username! },
    ];
  }

  it("request -> accept -> remove round-trips both directions", async () => {
    const [a, b] = await claimedPair();
    const req = accounts.sendFriendRequest(a.id, b.username);
    expect(req).toEqual({ toAccountId: b.id, autoAccepted: false });
    expect(accounts.listFriends(a.id).outgoing.map((r) => r.accountId)).toEqual([b.id]);
    expect(accounts.listFriends(b.id).incoming.map((r) => r.accountId)).toEqual([a.id]);

    accounts.acceptFriend(b.id, a.id); // only the target may accept
    expect(accounts.listFriends(a.id).friends).toEqual([b.id]);
    expect(accounts.listFriends(b.id).friends).toEqual([a.id]);

    accounts.removeFriend(a.id, b.id); // either direction removes
    expect(accounts.listFriends(a.id).friends).toEqual([]);
    expect(accounts.listFriends(b.id).friends).toEqual([]);
  });

  it("decline works from either side of a pending row", async () => {
    const [a, b] = await claimedPair();
    accounts.sendFriendRequest(a.id, b.username);
    accounts.declineFriend(b.id, a.id); // target declines
    expect(accounts.listFriends(a.id).outgoing).toEqual([]);

    accounts.sendFriendRequest(a.id, b.username);
    accounts.declineFriend(a.id, b.id); // requester cancels own outgoing
    expect(accounts.listFriends(b.id).incoming).toEqual([]);
  });

  it("a reciprocal pending request auto-accepts (mutual intent)", async () => {
    const [a, b] = await claimedPair();
    accounts.sendFriendRequest(a.id, b.username);
    const back = accounts.sendFriendRequest(b.id, a.username);
    expect(back.autoAccepted).toBe(true);
    expect(accounts.listFriends(a.id).friends).toEqual([b.id]);
    expect(accounts.listFriends(b.id).friends).toEqual([a.id]);
  });

  it("rejects self, duplicate, unknown target, wrong-side accept, and guest senders", async () => {
    const [a, b] = await claimedPair();
    expect(errCode(() => accounts.sendFriendRequest(a.id, a.username))).toBe("INVALID_INPUT");
    expect(errCode(() => accounts.sendFriendRequest(a.id, "no_such_user_zz"))).toBe("NO_SUCH_USER");

    accounts.sendFriendRequest(a.id, b.username);
    expect(errCode(() => accounts.sendFriendRequest(a.id, b.username))).toBe("INVALID_INPUT"); // duplicate outgoing
    expect(errCode(() => accounts.acceptFriend(a.id, b.id))).toBe("INVALID_INPUT"); // requester cannot self-accept
    accounts.acceptFriend(b.id, a.id);
    expect(errCode(() => accounts.sendFriendRequest(a.id, b.username))).toBe("INVALID_INPUT"); // already friends

    const guest = accounts.resolveGuestAccount("friend-guest-dev");
    expect(errCode(() => accounts.sendFriendRequest(guest.id, a.username))).toBe("CLAIM_REQUIRED");
  });
});

describe("run_seats attribution primitives", () => {
  it("upsertRunSeat throws on bot + non-null accountId", () => {
    const runId = dbmod.startNewRun(1, "attr-dev-1", 2);
    expect(() =>
      dbmod.upsertRunSeat(runId, 0, {
        clientId: null,
        displayName: "Bot",
        controllerKind: "bot",
        tokenSalt: null,
        accountId: "some-account",
      }),
    ).toThrow(/bot seat/);
  });

  it("setSeatAccountIfNull fills a NULL account_id and NEVER overwrites a non-NULL one", () => {
    const runId = dbmod.startNewRun(1, "attr-dev-2", 2);
    dbmod.upsertRunSeat(runId, 0, {
      clientId: "attr-dev-2",
      displayName: "A",
      controllerKind: "human",
      tokenSalt: dbmod.newTokenSalt(),
      accountId: null,
    });
    dbmod.setSeatAccountIfNull(runId, 0, "account-first");
    expect(dbmod.loadRunSeats(runId)[0]!.account_id).toBe("account-first");
    dbmod.setSeatAccountIfNull(runId, 0, "account-second");
    expect(dbmod.loadRunSeats(runId)[0]!.account_id).toBe("account-first"); // frozen at first attribution
  });
});
