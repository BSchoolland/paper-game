/** Drives fuel-browser-entry.ts in headless Chromium. */
import { chromium } from "playwright-core";
import { writeFileSync } from "node:fs";

const dir = new URL(".", import.meta.url).pathname;
writeFileSync(`${dir}dist/fuel.html`, `<!doctype html><meta charset="utf-8"><script src="./fuel-bundle.js"></script>`);
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", headless: true });
const page = await browser.newPage();
await page.goto(`file://${dir}dist/fuel.html`);
const result = await page.evaluate(() => (window as unknown as { __fuelResult: Promise<unknown> }).__fuelResult);
await browser.close();
console.log(JSON.stringify(result));
