export const meta = {
  name: "promote",
  description:
    "Promote a reviewed dimension: flip its lifecycle status to 'approved' so the server serves it to everyone.",
  phases: [{ title: "Promote" }],
};

const dimId = args?.dimId;
if (dimId == null) {
  throw new Error("dimId is REQUIRED.");
}
const dbPath = args?.dbPath;
if (!dbPath) {
  throw new Error("dbPath is REQUIRED (absolute path) so this targets the same db the dimension lives in.");
}
if (!dbPath.startsWith("/")) {
  throw new Error(`dbPath must be an absolute path, got: ${dbPath}`);
}

const DB_TS = "/home/ben/Projects/turn-based-game/server/src/db.ts";

phase("Promote");

const out = await agent(
  [
    "You are a deterministic shim. Flip the dimension's lifecycle status to approved. Run exactly this command:",
    "",
    `  GAME_DB_PATH=${dbPath} bun -e 'import { setDimensionStatus } from "${DB_TS}"; setDimensionStatus(${dimId}, "approved"); console.log(JSON.stringify({ dimId: ${dimId}, status: "approved" }));'`,
    "",
    "Return its stdout. Fail loud if it errors.",
  ].join("\n"),
  { label: "promote-approved", phase: "Promote", model: "haiku" },
);

return { dimId, status: "approved", result: out };
