import type { ClientState } from "../state/client-state.js";

const PANEL_BG = "rgba(26, 20, 14, 0.88)";
const PANEL_BORDER = "1px solid rgba(139, 115, 85, 0.4)";
const PANEL_RADIUS = "8px";
const FONT = "'Segoe UI', system-ui, sans-serif";

const TEAM_STYLES = {
  red: { color: "#e74c3c", label: "RED" },
  blue: { color: "#3498db", label: "BLUE" },
} as const;

const WEAPON_COLORS: Record<string, string> = {
  "short-sword": "#f1c40f",
  spear: "#e67e22",
  bow: "#3498db",
};

export class Hud {
  private container: HTMLDivElement;
  private info: HTMLDivElement;
  private attackBtn: HTMLButtonElement;
  private endTurnBtn: HTMLButtonElement;

  constructor(
    parent: HTMLElement,
    private clientState: ClientState
  ) {
    this.container = document.createElement("div");
    this.container.style.cssText = `
      position: absolute; top: 0; left: 0; right: 0; bottom: 0;
      pointer-events: none; font-family: ${FONT}; color: #d4c4a8;
    `;

    this.info = document.createElement("div");
    this.info.style.cssText = `
      position: absolute; top: 12px; left: 12px;
      background: ${PANEL_BG}; border: ${PANEL_BORDER};
      padding: 12px 16px; border-radius: ${PANEL_RADIUS};
      font-size: 13px; line-height: 1.7; min-width: 220px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    `;
    this.container.appendChild(this.info);

    const controls = document.createElement("div");
    controls.style.cssText = `
      position: absolute; top: 12px; right: 12px;
      display: flex; gap: 6px; pointer-events: auto;
    `;

    this.attackBtn = this.makeButton("Attack (A)", "#f39c12");
    controls.appendChild(this.attackBtn);
    this.attackBtn.addEventListener("click", () => clientState.toggleAttackMode());

    this.endTurnBtn = this.makeButton("End Turn (E)", "#8fbc6a");
    controls.appendChild(this.endTurnBtn);
    this.endTurnBtn.addEventListener("click", () => clientState.endTurn());

    const resetBtn = this.makeButton("Reset (R)", "#95a5a6");
    controls.appendChild(resetBtn);
    resetBtn.addEventListener("click", () => clientState.reset());

    this.container.appendChild(controls);

    const help = document.createElement("div");
    help.style.cssText = `
      position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%);
      background: ${PANEL_BG}; border: ${PANEL_BORDER};
      padding: 6px 14px; border-radius: ${PANEL_RADIUS};
      font-size: 11px; color: #7a6f60; white-space: nowrap;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    `;
    help.textContent = "Click: select · Right-click: move · A: attack · E: end turn · R: reset · Esc: cancel";
    this.container.appendChild(help);

    parent.appendChild(this.container);
  }

  private makeButton(text: string, accentColor: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = text;
    btn.style.cssText = `
      background: ${PANEL_BG}; color: #d4c4a8;
      border: 1px solid rgba(139, 115, 85, 0.3);
      padding: 8px 14px; border-radius: 6px; cursor: pointer;
      font-family: ${FONT}; font-size: 12px; font-weight: 500;
      transition: border-color 0.15s, background 0.15s;
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    `;
    btn.dataset.accent = accentColor;
    btn.addEventListener("mouseenter", () => {
      btn.style.borderColor = accentColor;
      btn.style.background = "rgba(40, 32, 22, 0.95)";
    });
    btn.addEventListener("mouseleave", () => {
      if (!btn.dataset.active) {
        btn.style.borderColor = "rgba(139, 115, 85, 0.3)";
        btn.style.background = PANEL_BG;
      }
    });
    return btn;
  }

  update() {
    const state = this.clientState.getState();
    const teamStyle = TEAM_STYLES[state.activeTeam];
    const selected = this.clientState.selectedEntityId
      ? state.entities.get(this.clientState.selectedEntityId)
      : null;

    let html = `<div style="font-size:15px;font-weight:600;color:${teamStyle.color};letter-spacing:0.5px;">`;
    html += `${teamStyle.label}'s Turn`;
    html += `<span style="color:#7a6f60;font-weight:400;font-size:12px;margin-left:8px;">Turn ${state.turnNumber}</span>`;
    html += `</div>`;

    if (state.winner) {
      const winStyle = TEAM_STYLES[state.winner];
      html += `<div style="font-size:16px;color:${winStyle.color};margin-top:8px;font-weight:700;letter-spacing:1px;">`;
      html += `${winStyle.label} WINS`;
      html += `</div>`;
    }

    if (selected) {
      const weaponColor = WEAPON_COLORS[selected.weapon.id] ?? "#d4c4a8";
      html += `<div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(139,115,85,0.2);">`;
      html += `<div style="font-weight:600;font-size:13px;">${selected.name}</div>`;
      html += `<div style="font-size:11px;color:${weaponColor};margin-top:2px;">${selected.weapon.name}</div>`;
      html += `<div style="margin-top:6px;font-size:12px;color:#a89880;">`;
      html += `HP <span style="color:#d4c4a8">${selected.hp}/${selected.maxHp}</span>`;
      html += ` · Move <span style="color:#d4c4a8">${Math.round(selected.movementRemaining)}</span>`;
      html += ` · Act <span style="color:#d4c4a8">${selected.actionsRemaining}</span>`;
      html += `</div></div>`;
    }

    if (this.clientState.inputMode === "attack") {
      const weaponColor = selected ? (WEAPON_COLORS[selected.weapon.id] ?? "#f39c12") : "#f39c12";
      html += `<div style="margin-top:8px;font-size:11px;color:${weaponColor};font-weight:600;letter-spacing:0.5px;">ATTACK MODE</div>`;
    }

    this.info.innerHTML = html;

    const isAttackMode = this.clientState.inputMode === "attack";
    this.attackBtn.style.borderColor = isAttackMode ? "#f39c12" : "rgba(139, 115, 85, 0.3)";
    this.attackBtn.style.background = isAttackMode ? "rgba(243, 156, 18, 0.15)" : PANEL_BG;
    this.attackBtn.dataset.active = isAttackMode ? "1" : "";
  }
}
