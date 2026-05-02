import { Application, Container, Graphics } from "pixi.js";
import type { GameState, Vec2 } from "shared";
import { resolveAction, sub, normalize, distance } from "shared";
import { createInitialGameState } from "./create-game.js";
import { createGridGraphics } from "./renderer/grid-renderer.js";
import { createEntityGraphics } from "./renderer/entity-renderer.js";
import { createTargetingArc } from "./renderer/targeting-renderer.js";
import { createMovePreview } from "./renderer/move-preview-renderer.js";

type InputMode = "select" | "attack";

export class GameLoop {
  private state: GameState;
  private app: Application;
  private worldContainer = new Container();
  private entityLayer = new Container();
  private overlayLayer = new Container();
  private selectedEntityId: string | null = null;
  private mouseWorld: Vec2 = { x: 0, y: 0 };
  private inputMode: InputMode = "select";
  private hud!: HTMLDivElement;

  constructor(app: Application) {
    this.app = app;
    this.state = createInitialGameState();
  }

  init() {
    this.app.stage.addChild(this.worldContainer);

    const gridGraphics = createGridGraphics(this.state.grid);
    this.worldContainer.addChild(gridGraphics);
    this.worldContainer.addChild(this.entityLayer);
    this.worldContainer.addChild(this.overlayLayer);

    this.createHUD();
    this.bindInput();
    this.render();
  }

  private createHUD() {
    this.hud = document.createElement("div");
    this.hud.style.cssText = `
      position: absolute; top: 10px; left: 10px; right: 10px;
      display: flex; justify-content: space-between; align-items: flex-start;
      pointer-events: none; font-family: monospace; color: #ddd;
    `;

    const info = document.createElement("div");
    info.id = "game-info";
    info.style.cssText = `
      background: rgba(0,0,0,0.7); padding: 8px 14px; border-radius: 6px;
      font-size: 14px; line-height: 1.6;
    `;
    this.hud.appendChild(info);

    const controls = document.createElement("div");
    controls.style.cssText = `display: flex; gap: 8px; pointer-events: auto;`;

    const attackBtn = document.createElement("button");
    attackBtn.id = "attack-btn";
    attackBtn.textContent = "Attack Mode (A)";
    attackBtn.style.cssText = this.buttonStyle();
    attackBtn.addEventListener("click", () => this.toggleAttackMode());
    controls.appendChild(attackBtn);

    const endBtn = document.createElement("button");
    endBtn.textContent = "End Turn (E)";
    endBtn.style.cssText = this.buttonStyle();
    endBtn.addEventListener("click", () => this.endTurn());
    controls.appendChild(endBtn);

    const resetBtn = document.createElement("button");
    resetBtn.textContent = "Reset (R)";
    resetBtn.style.cssText = this.buttonStyle();
    resetBtn.addEventListener("click", () => this.reset());
    controls.appendChild(resetBtn);

    this.hud.appendChild(controls);
    document.getElementById("game-container")!.appendChild(this.hud);
  }

  private buttonStyle(): string {
    return `
      background: rgba(0,0,0,0.7); color: #ddd; border: 1px solid #555;
      padding: 8px 14px; border-radius: 6px; cursor: pointer;
      font-family: monospace; font-size: 13px;
    `;
  }

  private bindInput() {
    const canvas = this.app.canvas;

    canvas.addEventListener("mousemove", (e) => {
      const rect = canvas.getBoundingClientRect();
      this.mouseWorld = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
      this.renderOverlay();
    });

    canvas.addEventListener("click", (e) => {
      const rect = canvas.getBoundingClientRect();
      const pos: Vec2 = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      if (this.state.winner) return;

      if (this.inputMode === "attack" && this.selectedEntityId) {
        this.doAttack(pos);
        return;
      }

      const clicked = this.findEntityAt(pos);
      if (clicked && clicked.team === this.state.activeTeam) {
        this.selectedEntityId = clicked.id;
        this.inputMode = "select";
        this.render();
      }
    });

    canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (this.state.winner) return;
      if (!this.selectedEntityId) return;

      const rect = canvas.getBoundingClientRect();
      const pos: Vec2 = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      this.doMove(pos);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "e" || e.key === "E") this.endTurn();
      if (e.key === "a" || e.key === "A") this.toggleAttackMode();
      if (e.key === "r" || e.key === "R") this.reset();
      if (e.key === "Escape") {
        this.inputMode = "select";
        this.selectedEntityId = null;
        this.render();
      }
    });
  }

  private findEntityAt(pos: Vec2): ReturnType<ReadonlyMap<string, import("shared").Entity>["get"]> {
    for (const entity of this.state.entities.values()) {
      if (distance(pos, entity.position) <= entity.collisionRadius) {
        return entity;
      }
    }
    return undefined;
  }

  private doMove(destination: Vec2) {
    if (!this.selectedEntityId) return;
    const newState = resolveAction(this.state, {
      type: "move",
      entityId: this.selectedEntityId,
      destination,
    });
    if (newState !== this.state) {
      this.state = newState;
      this.render();
    }
  }

  private doAttack(mousePos: Vec2) {
    if (!this.selectedEntityId) return;
    const entity = this.state.entities.get(this.selectedEntityId);
    if (!entity) return;

    const dir = sub(mousePos, entity.position);
    const aimDirection = normalize(dir);

    const newState = resolveAction(this.state, {
      type: "attack",
      entityId: this.selectedEntityId,
      aimDirection,
    });
    if (newState !== this.state) {
      this.state = newState;
      this.inputMode = "select";

      if (!this.state.entities.has(this.selectedEntityId)) {
        this.selectedEntityId = null;
      }
      this.render();
    }
  }

  private toggleAttackMode() {
    if (!this.selectedEntityId) return;
    this.inputMode = this.inputMode === "attack" ? "select" : "attack";
    this.render();
  }

  private endTurn() {
    this.state = resolveAction(this.state, { type: "endTurn" });
    this.selectedEntityId = null;
    this.inputMode = "select";
    this.render();
  }

  private reset() {
    this.state = createInitialGameState();
    this.selectedEntityId = null;
    this.inputMode = "select";

    this.worldContainer.removeChildren();
    const gridGraphics = createGridGraphics(this.state.grid);
    this.worldContainer.addChild(gridGraphics);
    this.entityLayer = new Container();
    this.overlayLayer = new Container();
    this.worldContainer.addChild(this.entityLayer);
    this.worldContainer.addChild(this.overlayLayer);
    this.render();
  }

  private render() {
    this.entityLayer.removeChildren();

    for (const entity of this.state.entities.values()) {
      const isSelected = entity.id === this.selectedEntityId;
      const gfx = createEntityGraphics(entity, isSelected);
      this.entityLayer.addChild(gfx);
    }

    this.renderOverlay();
    this.renderHUD();
  }

  private renderOverlay() {
    this.overlayLayer.removeChildren();

    if (!this.selectedEntityId || this.state.winner) return;
    const entity = this.state.entities.get(this.selectedEntityId);
    if (!entity) return;

    if (this.inputMode === "attack" && entity.actionsRemaining > 0) {
      const arc = createTargetingArc(entity, this.mouseWorld);
      if (arc) this.overlayLayer.addChild(arc);
    } else if (this.inputMode === "select" && entity.movementRemaining > 1) {
      const preview = createMovePreview(entity, this.mouseWorld);
      this.overlayLayer.addChild(preview);
    }
  }

  private renderHUD() {
    const info = document.getElementById("game-info")!;
    const selected = this.selectedEntityId
      ? this.state.entities.get(this.selectedEntityId)
      : null;

    let html = `<div style="font-size:16px;font-weight:bold;color:${
      this.state.activeTeam === "red" ? "#cc4444" : "#4488cc"
    }">`;
    html += `${this.state.activeTeam.toUpperCase()}'s Turn (${this.state.turnNumber})`;
    html += `</div>`;

    if (this.state.winner) {
      html += `<div style="font-size:18px;color:#ffcc00;margin-top:6px;">`;
      html += `${this.state.winner.toUpperCase()} WINS!`;
      html += `</div>`;
    }

    if (selected) {
      html += `<div style="margin-top:6px;font-size:12px;">`;
      html += `<b>${selected.id}</b> | `;
      html += `HP: ${selected.hp}/${selected.maxHp} | `;
      html += `Move: ${Math.round(selected.movementRemaining)} | `;
      html += `Actions: ${selected.actionsRemaining}`;
      html += `</div>`;
    }

    if (this.inputMode === "attack") {
      html += `<div style="margin-top:4px;font-size:12px;color:#ffcc00;">ATTACK MODE</div>`;
    }

    html += `<div style="margin-top:8px;font-size:11px;color:#888;">`;
    html += `Click: select | Right-click: move | A: attack mode | E: end turn | R: reset`;
    html += `</div>`;

    info.innerHTML = html;

    const attackBtn = document.getElementById("attack-btn") as HTMLButtonElement | null;
    if (attackBtn) {
      attackBtn.style.borderColor =
        this.inputMode === "attack" ? "#ffcc00" : "#555";
    }
  }
}
