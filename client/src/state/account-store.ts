import type { AuthStatePayload, FriendsListPayload, ProfilePayload } from "shared";

type Listener = () => void;

/**
 * The live holder for this connection's account identity: the latest auth state
 * (`welcome.auth` / `authState`), the own profile (auth payloads + `profile` pushes),
 * and the friends snapshot (`friendsList` pushes). Fed from RoomConnection messages by
 * main.ts; UI components subscribe and re-render in place. No fallback defaults —
 * everything is null until the server speaks.
 */
export class AccountStore {
  auth: AuthStatePayload | null = null;
  profile: ProfilePayload | null = null;
  friends: FriendsListPayload | null = null;
  /** Set when the last hello presented a bad token (`welcome.auth.authRejected`). */
  authRejected: "expired" | "invalid" | null = null;
  private listeners: Listener[] = [];

  setAuth(auth: AuthStatePayload): void {
    // Identity switch (login/logout): the old account's friends snapshot no longer applies.
    if (this.auth && this.auth.accountId !== auth.accountId) this.friends = null;
    this.auth = auth;
    this.profile = auth.profile;
    this.authRejected = auth.authRejected ?? null;
    this.notify();
  }

  setProfile(profile: ProfilePayload): void {
    // `profile` holds the CONNECTION's identity. Award pushes carry the SEAT account's
    // profile, which differs after an expired-token mid-run reclaim (01-accounts.md §4.6)
    // — a foreign profile must never overwrite it.
    if (profile.accountId !== this.auth?.accountId) return;
    this.profile = profile;
    this.notify();
  }

  setFriends(friends: FriendsListPayload): void {
    this.friends = friends;
    this.notify();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }
}
