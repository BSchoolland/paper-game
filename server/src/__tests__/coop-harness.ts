/**
 * Multi-client integration harness for the co-op Room server (Phases 5b/6).
 *
 * Boots the real `server/src/index.ts` on an ephemeral port against an in-memory SQLite DB,
 * seeded (NOT GAME_SKIP_SEED) so dimension 0 exists for real encounters. Each mock client is a
 * Bun `WebSocket` with a distinct `clientId`, typed `send(ClientMessage)`, and a buffered inbox
 * with `await client.waitFor(predicate)` / `nextOf(type)` helpers.
 *
 * IMPORTANT: the server is imported DYNAMICALLY *after* env is set — a static import would hoist
 * above the env assignments and open the DB / pick the port too early.
 */
import type { ClientMessage, ServerMessage, ServerMessageType, ClientId } from "shared";
import { PROTOCOL_VERSION } from "shared";

// A per-process base port derived from the PID, so if `bun test` ever forks files into separate
// processes they will not collide. Within ONE process, index.ts binds Bun.serve exactly once
// (module cache); every subsequent startServer() reads back the real bound port from the export.
const BASE_PORT = 3100 + (process.pid % 4000);

export interface HarnessServer {
  port: number;
  url: string;
  stop(): Promise<void>;
}

/**
 * Boot (or reuse) the singleton co-op server. Env MUST be set before the dynamic import — a static
 * import would hoist above these assignments and open the DB / pick the port too early. Bun's
 * module cache means index.ts's `Bun.serve` runs exactly once per process; we read the ACTUAL bound
 * port back from the exported `server.port` (the requested PORT may differ on re-entry). All tests
 * share this one instance; isolation comes from unique clientIds + the in-memory DB.
 */
export async function startServer(): Promise<HarnessServer> {
  process.env.PORT ??= String(BASE_PORT);
  process.env.GAME_DB_PATH = ":memory:";
  // Do NOT set GAME_SKIP_SEED — we want dimension 0 seeded for real encounters.
  delete process.env.GAME_SKIP_SEED;
  process.env.GAME_TOKEN_SECRET ??= "test-secret-0123456789abcdef0123456789abcdef";

  const mod = (await import("../index.js")) as { server: { port: number; stop?(): void } };
  const realPort = mod.server.port;

  return {
    port: realPort,
    url: `ws://localhost:${realPort}/ws`,
    async stop() {
      // index.ts owns the singleton Bun.serve for the process lifetime; closing client sockets
      // (done per-test) is what releases seats. No teardown needed.
    },
  };
}

export interface MockClient {
  readonly clientId: ClientId;
  readonly ws: WebSocket;
  /** All messages received, in order. */
  readonly inbox: ServerMessage[];
  send(msg: ClientMessage): void;
  /** Resolve with the next (or already-buffered) message matching `pred`. */
  waitFor<T extends ServerMessage>(
    pred: (m: ServerMessage) => m is T,
    opts?: { timeoutMs?: number; consumeBuffered?: boolean },
  ): Promise<T>;
  /** Convenience: wait for the next message of a given `type`. */
  nextOf<K extends ServerMessageType>(
    type: K,
    opts?: { timeoutMs?: number; fromNow?: boolean },
  ): Promise<Extract<ServerMessage, { type: K }>>;
  /** True if a message of `type` is already buffered (and unconsumed by a marker). */
  has(type: ServerMessageType): boolean;
  /** Latest buffered message of `type`, or undefined. */
  latest<K extends ServerMessageType>(type: K): Extract<ServerMessage, { type: K }> | undefined;
  /** Drop all buffered messages and reset the consumption cursor to "now". */
  clear(): void;
  /** Mark the inbox cursor so `nextOf(type, {fromNow:true})` only sees messages after this point. */
  mark(): void;
  close(): void;
  readonly closed: Promise<void>;
}

let clientSeq = 0;

export function connectClient(server: HarnessServer, clientId?: ClientId): Promise<MockClient> {
  const id = clientId ?? `client-${++clientSeq}-${Math.random().toString(36).slice(2, 8)}`;
  const ws = new WebSocket(server.url);
  const inbox: ServerMessage[] = [];
  type Waiter = { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void; reject: (e: Error) => void };
  const waiters: Waiter[] = [];
  let cursor = 0; // index into inbox; nextOf(fromNow) advances this

  let closeResolve!: () => void;
  const closed = new Promise<void>((res) => (closeResolve = res));

  ws.addEventListener("message", (ev: MessageEvent) => {
    const data = typeof ev.data === "string" ? ev.data : String(ev.data);
    const msg = JSON.parse(data) as ServerMessage;
    inbox.push(msg);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i]!.pred(msg)) {
        const w = waiters.splice(i, 1)[0]!;
        w.resolve(msg);
      }
    }
  });
  ws.addEventListener("close", () => closeResolve());

  const client: MockClient = {
    clientId: id,
    ws,
    inbox,
    send(msg) {
      ws.send(JSON.stringify(msg));
    },
    waitFor(pred, opts) {
      const consumeBuffered = opts?.consumeBuffered ?? true;
      if (consumeBuffered) {
        const found = inbox.find((m) => pred(m));
        if (found) return Promise.resolve(found);
      }
      const timeoutMs = opts?.timeoutMs ?? 4000;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = waiters.findIndex((w) => w.resolve === wrappedResolve);
          if (idx >= 0) waiters.splice(idx, 1);
          reject(new Error(`waitFor timed out after ${timeoutMs}ms (client ${id})`));
        }, timeoutMs);
        const wrappedResolve = (m: ServerMessage) => {
          clearTimeout(timer);
          resolve(m as never);
        };
        waiters.push({ pred: pred as (m: ServerMessage) => boolean, resolve: wrappedResolve, reject });
      });
    },
    nextOf(type, opts) {
      const fromNow = opts?.fromNow ?? false;
      if (fromNow) {
        for (let i = cursor; i < inbox.length; i++) {
          if (inbox[i]!.type === type) {
            cursor = i + 1;
            return Promise.resolve(inbox[i] as never);
          }
        }
        cursor = inbox.length;
      }
      return client.waitFor(
        (m): m is Extract<ServerMessage, { type: typeof type }> => m.type === type,
        { timeoutMs: opts?.timeoutMs, consumeBuffered: !fromNow },
      ) as never;
    },
    has(type) {
      return inbox.some((m) => m.type === type);
    },
    latest(type) {
      for (let i = inbox.length - 1; i >= 0; i--) {
        if (inbox[i]!.type === type) return inbox[i] as never;
      }
      return undefined;
    },
    clear() {
      inbox.length = 0;
      cursor = 0;
    },
    mark() {
      cursor = inbox.length;
    },
    close() {
      ws.close();
    },
    closed,
  };

  return new Promise((resolve, reject) => {
    const openTimer = setTimeout(() => reject(new Error(`WS open timed out (client ${id})`)), 4000);
    ws.addEventListener("open", () => {
      clearTimeout(openTimer);
      resolve(client);
    });
    ws.addEventListener("error", (e) => {
      clearTimeout(openTimer);
      reject(new Error(`WS error (client ${id}): ${String(e)}`));
    });
  });
}

/** hello -> welcome handshake; returns the welcome payload. */
export async function hello(
  client: MockClient,
  displayName?: string,
): Promise<Extract<ServerMessage, { type: "welcome" }>> {
  client.send({ type: "hello", protocolVersion: PROTOCOL_VERSION, clientId: client.clientId, ...(displayName ? { displayName } : {}) });
  return client.nextOf("welcome");
}

/** Small sleep helper for letting timers / event-loop turns flush. */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
