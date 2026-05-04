import type { ClientState } from "../state/client-state.js";

const PANEL_BG = "rgba(245, 235, 215, 0.92)";
const PANEL_BORDER = "1px solid rgba(74, 55, 40, 0.3)";
const PANEL_RADIUS = "4px";
const FONT = "Georgia, 'Times New Roman', serif";
const INK = "#4a3728";
const INK_LIGHT = "#6b5a48";

const TEAM_STYLES = {
  red: { color: "#8b3a3a", label: "RED" },
  blue: { color: "#3a5a8b", label: "BLUE" },
} as const;

const WEAPON_COLORS: Record<string, string> = {
  "short-sword": "#6b5a48",
  spear: "#6b5a48",
  bow: "#6b5a48",
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
      pointer-events: none; font-family: ${FONT}; color: ${INK};
    `;

    this.info = document.createElement("div");
    this.info.style.cssText = `
      position: absolute; top: 12px; left: 12px;
      background: ${PANEL_BG}; border: ${PANEL_BORDER};
      padding: 12px 16px; border-radius: ${PANEL_RADIUS};
      font-size: 13px; line-height: 1.7; min-width: 220px;
      box-shadow: 0 2px 8px rgba(74, 55, 40, 0.15);
    `;
    this.container.appendChild(this.info);

    const controls = document.createElement("div");
    controls.style.cssText = `
      position: absolute; top: 12px; right: 12px;
      display: flex; gap: 6px; pointer-events: auto;
    `;

    this.attackBtn = this.makeButton("Attack (A)", "#8b3a3a");
    controls.appendChild(this.attackBtn);
    this.attackBtn.addEventListener("click", () =>
      clientState.toggleAttackMode()
    );

    this.endTurnBtn = this.makeButton("End Turn (E)", "#5a7a3a");
    controls.appendChild(this.endTurnBtn);
    this.endTurnBtn.addEventListener("click", () => clientState.endTurn());

    const resetBtn = this.makeButton("Reset (R)", "#6b5a48");
    controls.appendChild(resetBtn);
    resetBtn.addEventListener("click", () => clientState.reset());

    this.container.appendChild(controls);

    const help = document.createElement("div");
    help.style.cssText = `
      position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%);
      background: ${PANEL_BG}; border: ${PANEL_BORDER};
      padding: 6px 14px; border-radius: ${PANEL_RADIUS};
      font-size: 11px; color: ${INK_LIGHT}; white-space: nowrap;
      box-shadow: 0 2px 6px rgba(74, 55, 40, 0.12);
    `;
    help.textContent =
      "Click: select · Right-click: move · A: attack · E: end turn · R: reset · Esc: cancel · F3: debug walls";
    this.container.appendChild(help);

    parent.appendChild(this.container);
  }

  private makeButton(text: string, accentColor: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.textContent = text;
    btn.style.cssText = `
      background: ${PANEL_BG}; color: ${INK};
      border: 1px solid rgba(74, 55, 40, 0.25);
      padding: 8px 14px; border-radius: ${PANEL_RADIUS}; cursor: pointer;
      font-family: ${FONT}; font-size: 12px; font-weight: normal;
      transition: border-color 0.15s, background 0.15s;
      box-shadow: 0 1px 4px rgba(74, 55, 40, 0.12);
    `;
    btn.dataset.accent = accentColor;
    btn.addEventListener("mouseenter", () => {
      btn.style.borderColor = accentColor;
      btn.style.background = "rgba(245, 235, 215, 0.98)";
    });
    btn.addEventListener("mouseleave", () => {
      if (!btn.dataset.active) {
        btn.style.borderColor = "rgba(74, 55, 40, 0.25)";
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
    html += `<span style="color:${INK_LIGHT};font-weight:400;font-size:12px;margin-left:8px;">Turn ${state.turnNumber}</span>`;
    html += `</div>`;

    if (state.winner) {
      const winStyle = TEAM_STYLES[state.winner];
      html += `<div style="font-size:16px;color:${winStyle.color};margin-top:8px;font-weight:700;letter-spacing:1px;">`;
      html += `${winStyle.label} WINS`;
      html += `</div>`;
    }

    if (selected) {
      const weaponColor = WEAPON_COLORS[selected.weapon.id] ?? INK;
      html += `<div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(74,55,40,0.15);">`;
      html += `<div style="font-weight:600;font-size:13px;">${selected.name}</div>`;
      html += `<div style="font-size:11px;color:${weaponColor};margin-top:2px;font-style:italic;">${selected.weapon.name}</div>`;
      html += `<div style="margin-top:6px;font-size:12px;color:${INK_LIGHT};">`;
      html += `HP <span style="color:${INK}">${selected.hp}/${selected.maxHp}</span>`;
      html += ` · Move <span style="color:${INK}">${Math.round(selected.movementRemaining)}</span>`;
      html += ` · Act <span style="color:${INK}">${selected.actionsRemaining}</span>`;
      html += `</div></div>`;
    }

    if (this.clientState.inputMode === "attack") {
      html += `<div style="margin-top:8px;font-size:11px;color:#8b3a3a;font-weight:600;letter-spacing:0.5px;font-style:italic;">ATTACK MODE</div>`;
    }

    this.info.innerHTML = html;

    const isAttackMode = this.clientState.inputMode === "attack";
    this.attackBtn.style.borderColor = isAttackMode
      ? "#8b3a3a"
      : "rgba(74, 55, 40, 0.25)";
    this.attackBtn.style.background = isAttackMode
      ? "rgba(139, 58, 58, 0.1)"
      : PANEL_BG;
    this.attackBtn.dataset.active = isAttackMode ? "1" : "";
  }
}
