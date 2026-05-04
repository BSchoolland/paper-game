import type { TeamId } from "shared";

type MessageHandler = (msg: any) => void;

export class Connection {
  private ws: WebSocket;
  private handlers = new Map<string, MessageHandler[]>();
  private _team: TeamId | null = null;
  private _ready: Promise<void>;

  get team(): TeamId | null {
    return this._team;
  }

  constructor(url: string) {
    let resolveReady: () => void;
    this._ready = new Promise((r) => (resolveReady = r));

    this.ws = new WebSocket(url);
    this.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data as string);
      if (msg.type === "team") {
        this._team = msg.team;
        resolveReady!();
      }
      const handlers = this.handlers.get(msg.type);
      if (handlers) {
        for (const h of handlers) h(msg);
      }
    });
  }

  on(type: string, handler: MessageHandler) {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  send(msg: object) {
    this.ws.send(JSON.stringify(msg));
  }

  ready(): Promise<void> {
    return this._ready;
  }
}
