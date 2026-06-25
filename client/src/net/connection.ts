import type { ClientMessage, ServerEnvelope, ServerMessage, ServerMessageType, WireLogRecord } from "shared";
import { PROTOCOL_VERSION, summarizeEvent } from "shared";
import { getClientId, setStoredSeat } from "./player-token.js";
import { clientEventLog } from "./client-event-log.js";

/** A handler for one server message variant, narrowed to that variant's shape. */
type Handler<T extends ServerMessageType> = (msg: Extract<ServerMessage, { type: T }>) => void;

export type ConnectionStatus = "connecting" | "open" | "reconnecting";

const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 8000;

/**
 * The single client<->server socket. Sends `hello` on open, resolves `ready()` when the
 * server's first `welcome` lands, persists the room+seat from a `reconnected` welcome, and
 * dispatches every incoming {@link ServerMessage} to typed `on(...)` subscribers. On an
 * unexpected close it reconnects with backoff (a fresh `hello` re-binds via the persisted
 * clientId; the server auto-reclaims a dead-socket seat).
 */
export class RoomConnection {
  private ws!: WebSocket;
  private handlers = new Map<ServerMessageType, Array<(msg: ServerMessage) => void>>();
  private statusListeners: Array<(status: ConnectionStatus) => void> = [];
  private _ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (err: Error) => void;
  private _welcomed = false;
  private _sessionToken: string | null = null;
  private reconnectAttempts = 0;
  private closedByUs = false;
  private lastSeq = 0;
  private dispatchEnvelope: ServerEnvelope | null = null;

  constructor(
    private url: string,
    private displayName?: string,
  ) {
    this._ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.open();
  }

  private open(): void {
    this.notifyStatus(this._welcomed ? "reconnecting" : "connecting");
    this.lastSeq = 0;
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener("open", () => this.sendHello());
    this.ws.addEventListener("message", (event) => this.handleMessage(event));
    this.ws.addEventListener("close", () => this.handleClose());
    this.ws.addEventListener("error", () => this.ws.close());
  }

  private handleClose(): void {
    if (this.closedByUs) return;
    if (!this._welcomed) {
      // Failed before the first welcome: surface the failure rather than hang init().
      this.rejectReady(new Error("Could not reach the game server."));
      return;
    }
    this.notifyStatus("reconnecting");
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.reconnectAttempts);
    this.reconnectAttempts++;
    setTimeout(() => {
      if (!this.closedByUs) this.open();
    }, delay);
  }

  get sessionToken(): string | null {
    return this._sessionToken;
  }

  private sendHello(): void {
    this.send({ type: "hello", protocolVersion: PROTOCOL_VERSION, clientId: getClientId(), displayName: this.displayName });
  }

  private handleMessage(event: MessageEvent): void {
    const env = JSON.parse(event.data as string) as ServerEnvelope;
    this.checkSeq(env);
    clientEventLog.record(this.buildRecvRecord(env));
    const msg = env.msg;
    if (msg.type === "displaced") {
      // Another tab took this seat; do not fight to reconnect — the user must refresh to re-enter.
      this.closedByUs = true;
    }
    if (msg.type === "protocolMismatch") {
      // Terminal: the server closes after this. Don't reconnect, and reject ready() with a code so
      // boot doesn't show a misleading "could not reach server" on top of the mismatch banner.
      this.closedByUs = true;
      if (!this._welcomed) this.rejectReady(new Error("protocolMismatch"));
    }
    if (msg.type === "welcome") {
      this._sessionToken = msg.sessionToken;
      if (msg.reconnected) setStoredSeat(msg.reconnected);
      if (!this._welcomed) {
        this._welcomed = true;
        this.resolveReady();
      }
      this.reconnectAttempts = 0;
      this.notifyStatus("open");
    }
    const list = this.handlers.get(msg.type);
    if (list) {
      this.dispatchEnvelope = env;
      try {
        for (const h of list) h(msg);
      } finally {
        this.dispatchEnvelope = null;
      }
    }
  }

  private checkSeq(env: ServerEnvelope): void {
    const expected = this.lastSeq + 1;
    if (env.seq !== expected) {
      const note = env.seq <= this.lastSeq ? "seq-regress" : "seq-gap";
      const record = this.buildRecvRecord(env, note);
      clientEventLog.record(record);
      console.warn("[wire] server message sequence anomaly", { expected, got: env.seq, record });
      if (import.meta.env.DEV) throw new Error(`Server message sequence anomaly: expected ${expected}, got ${env.seq}`);
    }
    this.lastSeq = env.seq;
  }

  private buildRecvRecord(env: ServerEnvelope, note?: string): WireLogRecord {
    const stateMsg = env.msg.type === "state" ? env.msg : null;
    return {
      dir: "recv",
      seq: env.seq,
      t: env.t,
      type: env.msg.type,
      actionCount: stateMsg?.state.actionCount,
      events: stateMsg?.events.map(summarizeEvent),
      note,
    };
  }

  /** Subscribe to one server message type with a handler narrowed to that variant. */
  on<T extends ServerMessageType>(type: T, handler: Handler<T>): () => void {
    const list = this.handlers.get(type) ?? [];
    const erased = handler as (msg: ServerMessage) => void;
    list.push(erased);
    this.handlers.set(type, list);
    return () => {
      const cur = this.handlers.get(type);
      if (cur) this.handlers.set(type, cur.filter((h) => h !== erased));
    };
  }

  onStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  private notifyStatus(status: ConnectionStatus): void {
    for (const l of this.statusListeners) l(status);
  }

  currentServerEnvelope(): ServerEnvelope | null {
    return this.dispatchEnvelope;
  }

  send(msg: ClientMessage): void {
    this.ws.send(JSON.stringify(msg));
  }

  /** Resolves once the server's first `welcome` arrives; rejects if the first connect fails. */
  ready(): Promise<void> {
    return this._ready;
  }

  close(): void {
    this.closedByUs = true;
    this.ws.close();
  }
}
