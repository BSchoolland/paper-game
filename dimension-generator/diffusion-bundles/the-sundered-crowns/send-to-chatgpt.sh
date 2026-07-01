#!/usr/bin/env bash
set -euo pipefail

# Send each subfolder's prompt+image to a new chatgpt.com tab.
BUNDLE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
URL="https://chatgpt.com"

LOAD_WAIT=${LOAD_WAIT:-5}
UPLOAD_WAIT=${UPLOAD_WAIT:-5}

shopt -s nullglob
for folder in "$BUNDLE_DIR"/*/; do
  name=$(basename "$folder")
  prompt="${folder}prompt.txt"

  img=""
  for ext in jpeg jpg png; do
    for f in "$folder"*.$ext; do [[ -f "$f" ]] && { img="$f"; break 2; }; done
  done

  if [[ -z "$img" || ! -f "$prompt" ]]; then
    echo "[$name] skip (no img or prompt)"; continue
  fi

  mime=$(file -b --mime-type "$img")
  echo "[$name] $(basename "$img") ($mime)"

  before=$(xdotool search --name "ChatGPT" 2>/dev/null | sort -u || true)

  echo "[$name] opening tab..."
  xdg-open "$URL" >/dev/null 2>&1 &
  disown || true

  target=""
  for i in $(seq 1 "$LOAD_WAIT"); do
    sleep 1
    after=$(xdotool search --name "ChatGPT" 2>/dev/null | sort -u || true)
    new=$(comm -13 <(echo "$before") <(echo "$after") | tail -n 1)
    [[ -n "$new" ]] && { target="$new"; break; }
  done
  [[ -z "$target" ]] && target=$(xdotool search --name "ChatGPT" 2>/dev/null | tail -n 1 || true)
  [[ -n "$target" ]] || { echo "[$name] no ChatGPT window found"; continue; }

  echo "[$name] loading clipboard..."
  copyq eval "
    var fi = new File('$img'); fi.open(); var img = fi.readAll(); fi.close();
    var ft = new File('$prompt'); ft.open(); var txt = str(ft.readAll()); ft.close();
    copy('$mime', img, 'text/plain', txt);
  "

  echo "[$name] activating window $target..."
  xdotool windowactivate --sync "$target"
  sleep 1

  echo "[$name] pasting..."
  xdotool key --clearmodifiers ctrl+v

  echo "[$name] waiting ${UPLOAD_WAIT}s for upload..."
  sleep "$UPLOAD_WAIT"

  echo "[$name] sending..."
  xdotool windowactivate --sync "$target"
  xdotool key --clearmodifiers Return
  sleep 1
done

echo "done."
