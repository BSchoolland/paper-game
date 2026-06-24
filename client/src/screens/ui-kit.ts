/** Shared building blocks for the full-screen menu surfaces (home / staging lobby / game over). */

export function panelCard(): HTMLDivElement {
  const card = document.createElement("div");
  card.style.cssText = `
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 280px;
    padding: 24px;
    background: rgba(245, 235, 215, 0.97);
    border: 2px solid #6b5b4a;
    border-radius: 10px;
    box-shadow: 0 6px 24px rgba(35, 24, 14, 0.3);
  `;
  return card;
}

export function btn(label: string, primary = false): HTMLButtonElement {
  const b = document.createElement("button");
  b.textContent = label;
  b.tabIndex = -1;
  b.style.cssText = `
    padding: 10px 16px;
    font-family: monospace;
    font-size: 14px;
    font-weight: bold;
    color: ${primary ? "#fffaf0" : "#4a3728"};
    background: ${primary ? "#6b5b4a" : "#d4c8a0"};
    border: 2px solid #6b5b4a;
    border-radius: 6px;
    cursor: pointer;
  `;
  return b;
}
