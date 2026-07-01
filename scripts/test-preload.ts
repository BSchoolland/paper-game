// bun-test preload: db.ts opens (and migrates) its Database at module load from GAME_DB_PATH.
// Some test files import db.ts statically, which hoists above the harness's env assignment — run
// standalone, they would open the real server/hex-discovery.sqlite. Default to :memory: so no
// `bun test` invocation can ever touch the real DB. An explicit GAME_DB_PATH still wins.
process.env.GAME_DB_PATH ??= ":memory:";
