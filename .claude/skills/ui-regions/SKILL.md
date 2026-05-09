---
name: ui-regions
description: Define clickable regions on a UI sprite image, then rename them semantically
user_invocable: true
---

# UI Region Editor Workflow

This skill helps define named interactive regions (buttons, slots, areas) on UI sprite images.

The argument should be a sprite image path (e.g. `client/public/sprites/ui/inventory-panel.png`).

## Step 1: Launch the editor

Start a local HTTP server from the project root and open the editor with the image pre-loaded.

**Important:** Run the server start and the browser open as **separate sequential commands** with a sleep in between so the server is ready before the browser requests the image.

First, check if a regions JSON already exists for this image at `client/public/sprites/ui/<image-name>-regions.json`. If it does, include it via the `&regions=` query param so existing regions are loaded for editing.

```bash
python3 -m http.server 8190 --directory . &
SERVER_PID=$!
sleep 1

# Without existing regions:
xdg-open "http://localhost:8190/scripts/ui-region-editor.html?image=/<IMAGE_PATH>"

# With existing regions (append &regions= param):
xdg-open "http://localhost:8190/scripts/ui-region-editor.html?image=/<IMAGE_PATH>&regions=/<REGIONS_JSON_PATH>"
```

Both paths need a leading `/` — without it the browser resolves relative to `/scripts/` and gets a 404.

Then tell the user:
- Edit existing regions or draw new ones
- Click **Export JSON** when done
- Let you know when it's ready

Wait for the user to confirm they've exported the JSON.

## Step 2: Post-process the JSON

1. Kill the background HTTP server (`kill $SERVER_PID`).
2. Find the exported JSON. Check `~/Downloads/` for recent `*-regions.json` files first (that's where browsers save by default), then check `client/public/sprites/ui/`.
3. Read the corresponding sprite image to understand what each region covers visually.
4. Rename each region from its `region_X_Y` placeholder to a descriptive name based on what it visually covers in the image. Keep any regions that already have good names unchanged. Use kebab-case names like `close-button`, `slot-0`, `title-banner`, etc.
5. Save the renamed JSON to `client/public/sprites/ui/<image-name>-regions.json` (next to the source image).
6. Show the user the final region map for confirmation.
