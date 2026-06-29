/**
 * Self-contained menu screenshotter. Starts a private vite dev server on a free port, loads each
 * menu surface from the dev harness (client/dev/menu-preview.html), screenshots it, then tears the
 * server down. No external setup — just `bun scripts/shot-menus.ts [--out <dir>]`.
 *
 * Each capture is a desktop-sized viewport so the design is judged the way a player sees it.
 */
import puppeteer from "puppeteer";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLIENT = resolve(ROOT, "client");

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const OUT = resolve(flag("--out") ?? resolve(ROOT, "shots"));
const ATTEMPT = flag("--attempt"); // when set, screenshots dev/variants/attempt-<id>.ts instead of the real screens
mkdirSync(OUT, { recursive: true });

const PORT = 5300 + Math.floor(Math.random() * 600);
const VIEWPORT = { width: 1440, height: 900, deviceScaleFactor: 1 };

const attemptParam = ATTEMPT ? `&attempt=${ATTEMPT}` : "";
const SHOTS = ["home", "home-rooms", "lobby", "gameover"].map((name) => ({
  name,
  url: `screen=${name}${attemptParam}`,
}));

async function waitForServer(base: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(base);
      if (r.ok) return;
    } catch {
      // server not up yet
    }
    await new Promise((res) => setTimeout(res, 200));
  }
  throw new Error(`vite did not come up on ${base} within ${timeoutMs}ms`);
}

const vite = spawn("bunx", ["vite", "--port", String(PORT), "--strictPort"], {
  cwd: CLIENT,
  stdio: ["ignore", "ignore", "inherit"],
});

const base = `http://localhost:${PORT}`;
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
try {
  await waitForServer(base, 30_000);
  browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--force-color-profile=srgb"],
  });
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);

  for (const shot of SHOTS) {
    const url = `${base}/dev/menu-preview.html?${shot.url}`;
    await page.goto(url, { waitUntil: "networkidle0", timeout: 20_000 });
    await page
      .waitForFunction("window.__menuReady === true", { timeout: 5_000 })
      .catch(() => {});
    await new Promise((res) => setTimeout(res, 350)); // let webp art + the parchment frame paint
    const file = resolve(OUT, `${shot.name}.png`);
    await page.screenshot({ path: file as `${string}.png` });
    console.log(`shot: ${file}`);
  }
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
console.log(`\nAll menu shots written to ${OUT}`);
process.exit(0);
