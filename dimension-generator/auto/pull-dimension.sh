#!/usr/bin/env bash
# Pull one generated dimension from the desktop to this machine.
#
# The sprite/spec files are git-tracked, so they move via commit+push+pull. The
# hex-discovery.sqlite DB is gitignored, so the dimension's rows are transferred
# surgically (dimensions + enemy_templates + items for that id only) — other
# dimensions in the local DB are never touched. The local DB is backed up first.
#
# Usage: pull-dimension.sh <dimId> [desktopHost] [repoPathOnBoth]
set -euo pipefail

DIM="${1:?usage: pull-dimension.sh <dimId> [host] [repoPath]}"
HOST="${2:-desktop}"
REPO="${3:-Projects/turn-based-game}"        # relative to $HOME on the remote
LOCAL_REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DB_REL="server/hex-discovery.sqlite"
LOCAL_DB="$LOCAL_REPO/$DB_REL"
BRANCH="$(git -C "$LOCAL_REPO" rev-parse --abbrev-ref HEAD)"

echo "==> pulling dimension $DIM from $HOST:$REPO (branch $BRANCH)"

# 1. Remote: commit any uncommitted dimension assets, push the branch.
ssh -o ConnectTimeout=10 "$HOST" "cd $REPO
  git add -A
  if ! git diff --cached --quiet; then
    git commit -q -m 'assets(dimension-$DIM): sync generated art and spec' \
      -m 'Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>'
  fi
  git push -q origin $BRANCH" && echo "    remote committed + pushed"

# 2. Remote: dump this dimension's rows as SQL (idempotent — deletes then inserts).
ssh -o ConnectTimeout=10 "$HOST" "cd $REPO
  {
    echo 'BEGIN;'
    echo 'DELETE FROM items WHERE dimension_id=$DIM;'
    echo 'DELETE FROM enemy_templates WHERE dimension_id=$DIM;'
    echo 'DELETE FROM dimensions WHERE id=$DIM;'
    sqlite3 $DB_REL \".mode insert dimensions\"      'SELECT * FROM dimensions WHERE id=$DIM;'
    sqlite3 $DB_REL \".mode insert enemy_templates\" 'SELECT * FROM enemy_templates WHERE dimension_id=$DIM;'
    sqlite3 $DB_REL \".mode insert items\"           'SELECT * FROM items WHERE dimension_id=$DIM;'
    echo 'COMMIT;'
  } > /tmp/dim-$DIM.sql
  test -s /tmp/dim-$DIM.sql"
ROWS=$(ssh -o ConnectTimeout=10 "$HOST" "grep -c '^INSERT' /tmp/dim-$DIM.sql")
echo "    remote dumped $ROWS rows"

# 3. Local: pull the branch (fast-forward only), bringing sprite/spec files.
git -C "$LOCAL_REPO" fetch -q origin
git -C "$LOCAL_REPO" pull -q --ff-only origin "$BRANCH"
echo "    local branch fast-forwarded"

# 4. Local: back up the DB, then apply the dumped rows.
BAK="$LOCAL_DB.bak-$(date +%Y%m%d-%H%M%S)"
cp "$LOCAL_DB" "$BAK"
scp -q "$HOST:/tmp/dim-$DIM.sql" "/tmp/dim-$DIM.sql"
sqlite3 "$LOCAL_DB" < "/tmp/dim-$DIM.sql"
echo "    local DB updated (backup: $BAK)"

# 5. Repair: ensure every enemy template carries its sprite URLs. The generator
#    has historically produced the PNGs but omitted the `sprites` field, which
#    makes enemies render blank. Backfill by filename convention if missing.
python3 - "$LOCAL_DB" "$DIM" "$LOCAL_REPO" <<'PY'
import sqlite3, json, os, sys
db, dim, repo = sys.argv[1], int(sys.argv[2]), sys.argv[3]
sprite_dir = os.path.join(repo, f"server/sprites/enemies/dimension-{dim}")
states = ["idle", "attack", "hit", "move"]
con = sqlite3.connect(db); cur = con.cursor()
fixed, missing = 0, []
for eid, tj in cur.execute("SELECT id,template_json FROM enemy_templates WHERE dimension_id=?", (dim,)).fetchall():
    d = json.loads(tj)
    if isinstance(d.get("sprites"), dict) and d["sprites"]:
        continue
    for s in states:
        if not os.path.exists(f"{sprite_dir}/{eid}-{s}.png"):
            missing.append(f"{eid}-{s}")
    d["sprites"] = {s: f"/api/sprites/enemies/dimension-{dim}/{eid}-{s}.png" for s in states}
    cur.execute("UPDATE enemy_templates SET template_json=? WHERE id=? AND dimension_id=?", (json.dumps(d), eid, dim))
    fixed += 1
con.commit()
if missing:
    print(f"    WARNING: backfilled sprites but these PNGs are missing: {missing}")
print(f"    sprite backfill: {fixed} template(s) repaired" if fixed else "    sprites: already present, no repair needed")
con.close()
PY

# 6. Report final state.
sqlite3 "$LOCAL_DB" "SELECT '    result: dimension '||id||' \"'||name||'\" ['||status||'], '||
  (SELECT COUNT(*) FROM enemy_templates WHERE dimension_id=$DIM)||' enemies, '||
  (SELECT COUNT(*) FROM items WHERE dimension_id=$DIM)||' items' FROM dimensions WHERE id=$DIM;"
echo "==> done. Restart the local server (or start a fresh encounter) to see dimension $DIM."
