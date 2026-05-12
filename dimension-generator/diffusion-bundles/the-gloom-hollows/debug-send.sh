#!/usr/bin/env bash
set -euo pipefail

# Single-folder automated send with diagnostic logging.
# Usage: ./debug-send.sh [folder-name]   (default: 01-background)
# Logs to debug-send.log next to this script.

BUNDLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FOLDER_NAME="${1:-01-background}"
FOLDER="$BUNDLE_DIR/$FOLDER_NAME"
LOG="$BUNDLE_DIR/debug-send.log"
URL="https://chatgpt.com"

LOAD_WAIT=${LOAD_WAIT:-8}
UPLOAD_WAIT=${UPLOAD_WAIT:-8}

exec > >(tee "$LOG") 2>&1

log() { echo "[$(date +%H:%M:%S)] $*"; }

[[ -d "$FOLDER" ]] || { log "no folder: $FOLDER"; exit 1; }

prompt="$FOLDER/prompt.txt"
img=""
for ext in jpeg jpg png; do
  for f in "$FOLDER"/*.$ext; do [[ -f "$f" ]] && { img="$f"; break 2; }; done
done
[[ -n "$img" && -f "$prompt" ]] || { log "missing img or prompt"; exit 1; }

mime=$(file -b --mime-type "$img")
log "img=$img"
log "prompt=$prompt"
log "mime=$mime"

log "STEP 1: load clipboard"
# Embed paths/mime directly (daemon-safe; daemon does not inherit client env).
copyq eval "
  var fi = new File('$img'); fi.open(); var img = fi.readAll(); fi.close();
  var ft = new File('$prompt'); ft.open(); var txt = str(ft.readAll()); ft.close();
  copy('$mime', img, 'text/plain', txt);
"
log "clipboard targets: $(xclip -selection clipboard -t TARGETS -o 2>/dev/null | tr '\n' ',' )"

log "STEP 2: snapshot existing windows"
before=$(xdotool search --name "ChatGPT" 2>/dev/null | sort -u || true)
log "ChatGPT windows before: $(echo "$before" | tr '\n' ' ')"

log "STEP 3: open $URL"
xdg-open "$URL" >/dev/null 2>&1 &
disown || true

log "STEP 4: wait up to ${LOAD_WAIT}s for new ChatGPT window"
target=""
for i in $(seq 1 "$LOAD_WAIT"); do
  sleep 1
  after=$(xdotool search --name "ChatGPT" 2>/dev/null | sort -u || true)
  new=$(comm -13 <(echo "$before") <(echo "$after") | tail -n 1)
  if [[ -n "$new" ]]; then target="$new"; log "found new window: $target after ${i}s"; break; fi
done

if [[ -z "$target" ]]; then
  # fallback: pick most-recent ChatGPT-titled window
  target=$(xdotool search --name "ChatGPT" 2>/dev/null | tail -n 1 || true)
  log "no new window detected; falling back to most-recent ChatGPT window: $target"
fi
[[ -n "$target" ]] || { log "ERROR: no ChatGPT window found"; exit 1; }

log "target window name: $(xdotool getwindowname "$target")"

log "STEP 5: activate target window + small settle delay"
xdotool windowactivate --sync "$target"
sleep 2
active=$(xdotool getactivewindow)
log "active window after activate: $active ($(xdotool getwindowname "$active" 2>/dev/null || echo '?'))"

log "STEP 6: send Ctrl+V to active window"
xdotool key --clearmodifiers --window "$target" ctrl+v || xdotool key --clearmodifiers ctrl+v

log "STEP 7: wait ${UPLOAD_WAIT}s for image upload"
sleep "$UPLOAD_WAIT"

log "STEP 8: re-activate window and press Return"
xdotool windowactivate --sync "$target"
sleep 1
xdotool key --clearmodifiers --window "$target" Return || xdotool key --clearmodifiers Return

log "done. Check the browser to see what happened. Full log at: $LOG"
