import type { ClientMessage } from "shared";
import type { GameSocket } from "../src/net/socket.js";
import { setSocket } from "../src/net/client.js";
import { clearStoredSeat } from "../src/net/identity.js";
import { dispatch, onStatus } from "../src/state/dispatch.js";
import { FIXTURES, type Fixture, type FixtureCtx } from "./fixtures.js";

/**
 * The dev harness: a GameSocket whose "server" is a scripted fixture. Everything flows through
 * the real dispatch, so what renders is exactly what those wire messages would render live.
 */
class MockSocket implements GameSocket {
  constructor(private fixture: Fixture) {}

  readonly ctx: FixtureCtx = {
    push: (msg) => dispatch(msg),
    status: (s) => onStatus(s),
  };

  boot(): void {
    this.fixture.boot(this.ctx);
  }

  send(msg: ClientMessage): void {
    // Fixtures pre-push snapshot answers in boot(); respond() covers only what should feel live.
    this.fixture.respond?.(msg, this.ctx);
  }

  retryNow(): void {}
  close(): void {}
}

export function bootMock(name: string): void {
  const fixture = FIXTURES[name] ?? FIXTURES["lv1"]!;
  // A real stored seat would make the welcome handler fire a reclaim probe no fixture answers.
  clearStoredSeat();
  const socket = new MockSocket(fixture);
  setSocket(socket);
  socket.boot();
}

export function fixtureNames(): [string, string][] {
  return Object.entries(FIXTURES).map(([name, f]) => [name, f.label]);
}
