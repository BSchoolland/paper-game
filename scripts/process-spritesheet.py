#!/usr/bin/env python3
"""
Split a sprite sheet into individual sprites, remove background, clean up
stray pixels, and normalize alignment so feet are consistent across all frames.

Usage:
  python3 scripts/process-spritesheet.py <input-image> <output-dir> [--cols 6] [--rows 4] [--bg-tolerance 55] [--min-cluster 50]

The grid layout is configured via --names: a comma-separated list of output
base names, row-major order. Animation states are given via --states.

Example (the default):
  python3 scripts/process-spritesheet.py spritesheet.png client/public/sprites/ \
    --names red-warrior,red-spearman,red-archer,blue-warrior,blue-spearman,blue-archer \
    --states idle,attack,hit,move
"""

import argparse
import os
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import label, binary_dilation

from _sheet_utils import remove_small_clusters


def parse_args():
    p = argparse.ArgumentParser(description="Process a sprite sheet into individual sprites.")
    p.add_argument("input", help="Path to the sprite sheet image")
    p.add_argument("output_dir", help="Output directory for individual sprites")
    p.add_argument("--cols", type=int, default=6)
    p.add_argument("--rows", type=int, default=4)
    p.add_argument("--names", default="red-warrior,red-spearman,red-archer,blue-warrior,blue-spearman,blue-archer")
    p.add_argument("--states", default="idle,attack,hit,move")
    p.add_argument("--bg-tolerance", type=int, default=55, help="Color distance threshold for background removal")
    p.add_argument("--min-cluster", type=int, default=50, help="Minimum pixel cluster size to keep")
    p.add_argument("--format", default="png", choices=["png", "webp"])
    p.add_argument("--quality", type=int, default=90, help="WebP quality (ignored for PNG)")
    p.add_argument("--foot-threshold", type=float, default=0.05, help="Fraction of row width to count as 'real' content")
    p.add_argument("--strip-grid", action=argparse.BooleanOptionalAction, default=True,
                   help="Whiten full-sheet-spanning dark separator lines before slicing (handles sheets the model drew with a grid)")
    p.add_argument("--grid-dark", type=int, default=130, help="Max channel value for a pixel to count as part of a dark separator line")
    p.add_argument("--grid-cover", type=float, default=0.7, help="Fraction of a full row/col that must be dark to call it a separator line")
    return p.parse_args()


def sample_background_color(img: Image.Image) -> np.ndarray:
    rgb = np.array(img.convert("RGB"))
    corners = [
        rgb[5, 5], rgb[5, -5], rgb[-5, 5], rgb[-5, -5]
    ]
    return np.mean(corners, axis=0).astype(float)


def strip_grid_lines(pixels: np.ndarray, dark: int, cover: float) -> int:
    """Whiten dark separator lines that span the whole sheet (cell-grid borders).

    A grid line is the one thing nothing else here produces: a near-black run covering
    most of a full row or column. We detect those rows/cols, then repaint only their
    non-white pixels to white so the existing per-cell background removal deletes them.
    Returns the number of pixels repainted (0 if the sheet has no full-span lines)."""
    rgb = pixels[:, :, :3]
    is_dark = rgb.max(axis=2) < dark
    line_rows = is_dark.mean(axis=1) > cover
    line_cols = is_dark.mean(axis=0) > cover
    if not line_rows.any() and not line_cols.any():
        return 0

    # Widen each detected band by 1px to catch the line's anti-aliased fringe.
    def grow1(a):
        g = a.copy(); g[1:] |= a[:-1]; g[:-1] |= a[1:]; return g
    line_rows, line_cols = grow1(line_rows), grow1(line_cols)

    on_line = line_rows[:, None] | line_cols[None, :]
    not_white = rgb.max(axis=2) < 220
    mask = on_line & not_white
    pixels[mask, 0:3] = 255
    return int(mask.sum())


def remove_background(pixels: np.ndarray, bg: np.ndarray, tolerance: int) -> np.ndarray:
    diff = np.sqrt(np.sum((pixels[:, :, :3].astype(float) - bg) ** 2, axis=2))
    bg_mask = diff < tolerance

    labeled_arr, _ = label(bg_mask)
    h, w = bg_mask.shape
    edge_labels = set()
    edge_labels.update(labeled_arr[0, :].tolist())
    edge_labels.update(labeled_arr[h - 1, :].tolist())
    edge_labels.update(labeled_arr[:, 0].tolist())
    edge_labels.update(labeled_arr[:, w - 1].tolist())
    edge_labels.discard(0)

    final_mask = np.isin(labeled_arr, list(edge_labels))
    dilated = binary_dilation(final_mask, iterations=2)
    fringe = dilated & (~final_mask) & (diff < tolerance * 1.5)
    combined = final_mask | fringe

    alpha = pixels[:, :, 3].copy()
    alpha[combined] = 0

    boundary = binary_dilation(combined, iterations=1) & (~combined)
    alpha[boundary] = np.clip((diff[boundary] / tolerance) * 255, 0, 255).astype(np.uint8)

    pixels[:, :, 3] = alpha
    return pixels


def find_foot_row(alpha: np.ndarray, threshold: float) -> int:
    h, w = alpha.shape
    min_pixels = w * threshold
    for row in range(h - 1, -1, -1):
        if np.count_nonzero(alpha[row] > 10) >= min_pixels:
            return row
    return h - 1


def main():
    args = parse_args()
    names = args.names.split(",")
    states = args.states.split(",")

    if len(names) != args.cols:
        print(f"Error: {len(names)} names but {args.cols} columns", file=sys.stderr)
        sys.exit(1)
    if len(states) != args.rows:
        print(f"Error: {len(states)} states but {args.rows} rows", file=sys.stderr)
        sys.exit(1)

    os.makedirs(args.output_dir, exist_ok=True)

    src = Image.open(args.input).convert("RGBA")
    w, h = src.size

    if args.strip_grid:
        arr = np.array(src)
        painted = strip_grid_lines(arr, args.grid_dark, args.grid_cover)
        if painted:
            src = Image.fromarray(arr)
            print(f"Stripped grid separator lines: {painted} px repainted to white")
        else:
            print("Grid strip: no full-span dark lines found")

    cell_w = w / args.cols
    cell_h = h / args.rows
    bg = sample_background_color(src)
    print(f"Source: {w}x{h}, grid: {args.cols}x{args.rows}, bg color: {bg.astype(int)}")

    # Step 1: Extract cells, remove background, clean clusters
    cells = {}
    for row in range(args.rows):
        for col in range(args.cols):
            x1 = round(col * cell_w)
            y1 = round(row * cell_h)
            x2 = round((col + 1) * cell_w)
            y2 = round((row + 1) * cell_h)

            cell = src.crop((x1, y1, x2, y2)).convert("RGBA")
            pixels = np.array(cell)
            pixels = remove_background(pixels, bg, args.bg_tolerance)
            pixels = remove_small_clusters(pixels, args.min_cluster)

            name = f"{names[col]}-{states[row]}"
            cells[name] = pixels
            print(f"  Extracted: {name} ({x2 - x1}x{y2 - y1})")

    # Step 2: Find content bounds and normalize canvas size
    bounds = {}
    for name, pixels in cells.items():
        alpha = pixels[:, :, 3]
        rows_with = np.where(alpha.max(axis=1) > 10)[0]
        cols_with = np.where(alpha.max(axis=0) > 10)[0]
        if len(rows_with) == 0:
            bounds[name] = None
            continue
        bounds[name] = {
            "top": rows_with[0], "bottom": rows_with[-1],
            "left": cols_with[0], "right": cols_with[-1],
            "content_h": rows_with[-1] - rows_with[0] + 1,
            "content_w": cols_with[-1] - cols_with[0] + 1,
        }

    valid_bounds = [b for b in bounds.values() if b is not None]
    max_h = max(b["content_h"] for b in valid_bounds)
    max_w = max(b["content_w"] for b in valid_bounds)
    pad = 4
    canvas_w = max_w + pad * 2
    canvas_h = max_h + pad * 2
    print(f"\nCanvas size: {canvas_w}x{canvas_h}")

    # Step 3: Place content bottom-aligned, horizontally centered
    normalized = {}
    for name, pixels in cells.items():
        b = bounds[name]
        if b is None:
            normalized[name] = np.zeros((canvas_h, canvas_w, 4), dtype=np.uint8)
            continue

        content = pixels[b["top"]:b["bottom"] + 1, b["left"]:b["right"] + 1]
        canvas = np.zeros((canvas_h, canvas_w, 4), dtype=np.uint8)
        paste_x = (canvas_w - b["content_w"]) // 2
        paste_y = canvas_h - pad - b["content_h"]
        canvas[paste_y:paste_y + b["content_h"], paste_x:paste_x + b["content_w"]] = content
        normalized[name] = canvas

    # Step 4: Align feet across all sprites
    foot_rows = {}
    for name, pixels in normalized.items():
        foot_rows[name] = find_foot_row(pixels[:, :, 3], args.foot_threshold)

    idle_names = [n for n in normalized if n.endswith("-idle")]
    target_foot = max(foot_rows[n] for n in idle_names) if idle_names else max(foot_rows.values())
    print(f"Target foot row: {target_foot}")

    # Step 5: Shift and save
    fmt = args.format.upper()
    save_kwargs = {"quality": args.quality} if fmt == "WEBP" else {}

    for name, pixels in normalized.items():
        shift = target_foot - foot_rows[name]
        if shift > 0:
            shifted = np.zeros_like(pixels)
            shifted[shift:, :] = pixels[:canvas_h - shift, :]
            pixels = shifted
        elif shift < 0:
            shifted = np.zeros_like(pixels)
            shifted[:canvas_h + shift, :] = pixels[-shift:, :]
            pixels = shifted

        out_path = os.path.join(args.output_dir, f"{name}.{args.format}")
        Image.fromarray(pixels).save(out_path, fmt, **save_kwargs)
        shift_info = f" (shifted {shift}px)" if shift != 0 else ""
        print(f"  Saved: {name}.{args.format}{shift_info}")

    print(f"\nDone! {len(normalized)} sprites saved to {args.output_dir}")


if __name__ == "__main__":
    main()
