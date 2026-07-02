// PM2 process definition for the game server. Run on the server with:
//   pm2 start ecosystem.config.cjs
// Secrets and host-specific values (GAME_TOKEN_SECRET, GAME_DB_PATH) come from a server-only
// .env.production (gitignored), so nothing sensitive is committed.
const fs = require("node:fs");
const path = require("node:path");

function loadEnvFile(p) {
  const env = {};
  if (!fs.existsSync(p)) return env;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

module.exports = {
  apps: [
    {
      name: "paper-game",
      script: "server/src/index.ts",
      interpreter: "bun",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      env: {
        NODE_ENV: "production",
        PORT: "3001",
        ...loadEnvFile(path.join(__dirname, ".env.production")),
      },
    },
  ],
};
