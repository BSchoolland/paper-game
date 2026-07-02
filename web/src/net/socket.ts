import type { ClientMessage, ServerEnvelope, ServerMessage } from "shared";
import { PROTOCOL_VERSION } from "shared";
import { getAuthToken, getClientId } from "./identity.js";

export type SocketStatus = "connecting" | "open" | "reconnecting";

/** What the app plugs into a socket. `onMessage` is the single dispatch entry point. */
export interface SocketSinks {
  onMessage(msg: ServerMessage): void;
  onStatus(status: SocketStatus): void;
}

/** The transport surface screens/actions are allowed to touch (real and mock implement it). */
export interface GameSocket {
  send(msg: ClientMessage): void;
  /** Skip the current backoff wait and reconnect immediately (the connect face's "retry now"). */
  retryNow(): void;
  close(): void;
}

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8000;

/**
 * The single client<->server WebSocket. Pure transport: sends `hello` on open, verifies the
 * envelope sequence, reconnects with backoff on unexpected close (including before the first
 * welcome — the connect face covers the wait), and goes quiet permanently on the two terminal
 * pushes (`displaced`, `protocolMismatch`). All state meaning lives in the dispatch layer.
 */
export class RealSocket implements GameSocket {
  private ws!: WebSocket;
  private lastSeq = 0;
  private attempts = 0;
  private halted = false;
  private welcomedOnce = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private url: string,
    private sinks: SocketSinks,
  ) {
    this.open();
  }

  private open(): void {
    this.retryTimer = null;
    this.sinks.onStatus(this.welcomedOnce ? "reconnecting" : "connecting");
    this.lastSeq = 0;
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener("open", () => {
      this.send({ type: "hello", protocolVersion: PROTOCOL_VERSION, clientId: getClientId(), authToken: getAuthToken() ?? undefined });
    });
    this.ws.addEventListener("message", (event) => this.handleMessage(event));
    this.ws.addEventListener("close", () => this.scheduleReconnect());
    this.ws.addEventListener("error", () => this.ws.close());
  }

  private scheduleReconnect(): void {
    if (this.halted) return;
    this.sinks.onStatus(this.welcomedOnce ? "reconnecting" : "connecting");
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.attempts);
    this.attempts++;
    this.retryTimer = setTimeout(() => {
      if (!this.halted) this.open();
    }, delay);
  }

  private handleMessage(event: MessageEvent): void {
    const env = JSON.parse(event.data as string) as ServerEnvelope;
    this.checkSeq(env);
    const msg = env.msg;
    // Terminal pushes: the server closes after these; reconnecting would fight the takeover.
    if (msg.type === "displaced" || msg.type === "protocolMismatch") this.halted = true;
    if (msg.type === "welcome") {
      this.welcomedOnce = true;
      this.attempts = 0;
      this.sinks.onStatus("open");
    }
    this.sinks.onMessage(msg);
  }

  private checkSeq(env: ServerEnvelope): void {
    const expected = this.lastSeq + 1;
    if (env.seq !== expected) {
      console.warn("[wire] server message sequence anomaly", { expected, got: env.seq, type: env.msg.type });
      if (import.meta.env.DEV) throw new Error(`Server message sequence anomaly: expected ${expected}, got ${env.seq}`);
    }
    this.lastSeq = env.seq;
  }

  send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg));
  }

  retryNow(): void {
    if (this.halted || !this.retryTimer) return;
    clearTimeout(this.retryTimer);
    this.attempts = 0;
    this.open();
  }

  close(): void {
    this.halted = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.ws.close();
  }
}
