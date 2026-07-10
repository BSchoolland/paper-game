/** Drives browser-entry.ts in headless Chromium via playwright-core. */
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";

const dir = new URL(".", import.meta.url).pathname;
const html = `<!doctype html><meta charset="utf-8"><title>mod-sandbox spike</title><script src="./browser-bundle.js"></script>`;
writeFileSync(`${dir}dist/index.html`, html);

const candidates = [
  "/usr/bin/google-chrome",
  `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell`,
];
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) throw new Error("no chromium executable found");

const browser = await chromium.launch({ executablePath, headless: true });
const page = await browser.newPage();
await page.goto(`file://${dir}dist/index.html`);
const result = await page.evaluate(() => (window as unknown as { __spikeResult: Promise<unknown> }).__spikeResult);
await browser.close();
console.log(JSON.stringify({ executablePath, ...(result as object) }, null, 2));
