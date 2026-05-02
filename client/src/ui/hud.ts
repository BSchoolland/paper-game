import type { ClientState } from "../state/client-state.js";

const BUTTON_STYLE = `
  background: rgba(0,0,0,0.7); color: #ddd; border: 1px solid #555;
  padding: 8px 14px; border-radius: 6px; cursor: pointer;
  font-family: monospace; font-size: 13px;
`;

export class Hud {
  private container: HTMLDivElement;
  private info: HTMLDivElement;
  private attackBtn: HTMLButtonElement;

  constructor(
    parent: HTMLElement,
    private clientState: ClientState
  ) {
    this.container = document.createElement("div");
    this.container.style.cssText = `
      position: absolute; top: 10px; left: 10px; right: 10px;
      display: flex; justify-content: space-between; align-items: flex-start;
      pointer-events: none; font-family: monospace; color: #ddd;
    `;

    this.info = document.createElement("div");
    this.info.style.cssText = `
      background: rgba(0,0,0,0.7); padding: 8px 14px; border-radius: 6px;
      font-size: 14px; line-height: 1.6;
    `;
    this.container.appendChild(this.info);

    const controls = document.createElement("div");
    controls.style.cssText = `display: flex; gap: 8px; pointer-events: auto;`;

    this.attackBtn = this.makeButton("Attack Mode (A)", () =>
      clientState.toggleAttackMode()
    );
    controls.appendChild(this.attackBtn);
    controls.appendChild(
      this.makeButton("End Turn (E)", () => clientState.endTurn())
    );
    controls.appendChild(
      this.makeButton("Reset (R)", () => clientState.reset())
    );

    this.container.appendChild(controls);
    parent.appendChild(this.container);
  }

  private makeButton(text: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = text;
    btn.style.cssText = BUTTON_STYLE;
    btn.addEventListener("click", onClick);
    return btn;
  }

  update() {
    const state = this.clientState.getState();
    const selected = this.clientState.selectedEntityId
      ? state.entities.get(this.clientState.selectedEntityId)
      : null;

    let html = `<div style="font-size:16px;font-weight:bold;color:${
      state.activeTeam === "red" ? "#cc4444" : "#4488cc"
    }">`;
    html += `${state.activeTeam.toUpperCase()}'s Turn (${state.turnNumber})`;
    html += `</div>`;

    if (state.winner) {
      html += `<div style="font-size:18px;color:#ffcc00;margin-top:6px;">`;
      html += `${state.winner.toUpperCase()} WINS!`;
      html += `</div>`;
    }

    if (selected) {
      html += `<div style="margin-top:6px;font-size:12px;">`;
      html += `<b>${selected.name}</b> (${selected.weapon.name}) | `;
      html += `HP: ${selected.hp}/${selected.maxHp} | `;
      html += `Move: ${Math.round(selected.movementRemaining)} | `;
      html += `Actions: ${selected.actionsRemaining}`;
      html += `</div>`;
    }

    if (this.clientState.inputMode === "attack") {
      html += `<div style="margin-top:4px;font-size:12px;color:#ffcc00;">ATTACK MODE</div>`;
    }

    html += `<div style="margin-top:8px;font-size:11px;color:#888;">`;
    html += `Click: select | Right-click: move | A: attack mode | E: end turn | R: reset`;
    html += `</div>`;

    this.info.innerHTML = html;
    this.attackBtn.style.borderColor =
      this.clientState.inputMode === "attack" ? "#ffcc00" : "#555";
  }
}
