#!/usr/bin/env python3
"""
Extract individual decoration sprites from a spritesheet on a parchment/colored
background. Uses flood-fill from edges to identify background (which respects
sprite boundaries even when sprite colors are similar to the background), then
connected components to find individual sprites.

Usage:
  python3 scripts/process-decoration-sheet.py <input-image> <output-dir>
      [--names name1,name2,...] [--tolerance 0] [--format png] [--debug]

Output:
  - sprite-00.png, sprite-01.png, ... (or the provided --names, row-major)
  - manifest.json: a JSON array of the base names, in order. The game's hex
    decoration loader reads this; harmless for map-object/structure sheets.

Defaults to PNG because that's what the game's loaders expect.
"""

import argparse
import json
import os
import numpy as np
from PIL import Image
from scipy import ndimage

from _sheet_utils import (
    flood_fill_from_edges,
    rgba_from_bg_mask,
    remove_small_clusters,
    crop_to_content,
)


def parse_args():
    p = argparse.ArgumentParser(description="Extract decoration sprites from a sheet.")
    p.add_argument("input", help="Path to the spritesheet image")
    p.add_argument("output_dir", help="Output directory for individual sprites")
    p.add_argument("--names", default="", help="Comma-separated sprite names (row-major)")
    p.add_argument("--tolerance", type=int, default=0, help="Flood-fill color tolerance (0 = auto-calibrate)")
    p.add_argument("--min-size", type=int, default=40, help="Minimum sprite dimension")
    p.add_argument("--padding", type=int, default=4, help="Padding around sprite")
    p.add_argument("--format", default="png", choices=["png", "webp"])
    p.add_argument("--quality", type=int, default=90, help="WebP quality (ignored for PNG)")
    p.add_argument("--row-height", type=int, default=80, help="Row band height for sort")
    p.add_argument("--min-cluster", type=int, default=50, help="Minimum pixel cluster size to keep")
    p.add_argument("--debug", action="store_true", help="Save debug image")
    return p.parse_args()


def find_sprite_boxes(bg_mask: np.ndarray, min_size: int, row_h: int):
    fg = (~bg_mask).astype(np.uint8)
    struct = np.ones((3, 3))
    fg = ndimage.binary_dilation(fg, structure=struct, iterations=2).astype(np.uint8)
    fg = ndimage.binary_erosion(fg, structure=struct, iterations=1).astype(np.uint8)

    labeled, num = ndimage.label(fg)
    h, w = bg_mask.shape
    sheet_area = h * w
    boxes = []
    for i in range(1, num + 1):
        ys, xs = np.where(labeled == i)
        x0, x1 = int(xs.min()), int(xs.max()) + 1
        y0, y1 = int(ys.min()), int(ys.max()) + 1
        bw, bh = x1 - x0, y1 - y0
        if bw < min_size or bh < min_size:
            continue
        # Skip the whole-sheet false positive (a box covering most of the image).
        if bw * bh > 0.5 * sheet_area:
            continue
        boxes.append((x0, y0, x1, y1))

    boxes.sort(key=lambda b: (b[1] // row_h, b[0]))
    return boxes


def count_sprites_at_tolerance(arr: np.ndarray, tolerance: int, min_size: int, row_h: int) -> int:
    bg_mask = flood_fill_from_edges(arr, tolerance)
    boxes = find_sprite_boxes(bg_mask, min_size, row_h)
    return len(boxes)


def auto_calibrate_tolerance(arr: np.ndarray, min_size: int, row_h: int) -> int:
    """Find the lowest tolerance that produces the correct sprite count.

    Strategy: run at a moderate tolerance to discover how many sprites exist,
    then binary-search down for the lowest tolerance that still finds that many.
    """
    high = 50
    target_count = count_sprites_at_tolerance(arr, high, min_size, row_h)
    print(f"  Calibration: {target_count} sprites at tolerance {high}")

    if target_count <= 1:
        print(f"  Warning: only {target_count} sprite(s) even at tolerance {high}, using {high}")
        return high

    lo, hi = 1, high
    best = high
    while lo <= hi:
        mid = (lo + hi) // 2
        count = count_sprites_at_tolerance(arr, mid, min_size, row_h)
        print(f"  Calibration: {count} sprites at tolerance {mid}")
        if count >= target_count:
            best = mid
            hi = mid - 1
        else:
            lo = mid + 1

    print(f"  Auto-calibrated tolerance: {best} (finds {target_count} sprites)")
    return best


def main():
    args = parse_args()
    os.makedirs(args.output_dir, exist_ok=True)

    print(f"Loading {args.input}...")
    img = Image.open(args.input).convert("RGB")
    arr = np.array(img)
    h, w = arr.shape[:2]
    print(f"  Size: {w}x{h}")

    tolerance = args.tolerance
    if tolerance == 0:
        print("Auto-calibrating tolerance...")
        tolerance = auto_calibrate_tolerance(arr, args.min_size, args.row_height)

    print(f"Flood-filling background (tolerance={tolerance})...")
    bg_mask = flood_fill_from_edges(arr, tolerance)
    print(f"  Background: {bg_mask.sum() / (h * w) * 100:.1f}% of image")

    print("Finding sprites...")
    boxes = find_sprite_boxes(bg_mask, args.min_size, args.row_height)
    print(f"  Found {len(boxes)} sprites")

    rgba = rgba_from_bg_mask(arr, bg_mask)

    if args.debug:
        from PIL import ImageDraw
        debug = rgba.copy()
        draw = ImageDraw.Draw(debug)
        for i, (x0, y0, x1, y1) in enumerate(boxes):
            draw.rectangle([x0, y0, x1, y1], outline=(255, 0, 0, 255), width=2)
            draw.text((x0 + 2, y0 - 14), str(i), fill=(255, 0, 0, 255))
        debug.save(os.path.join(args.output_dir, "_debug.png"))
        print("  Debug saved")

    # Filter out size outliers (>3x or <1/3 of the average dimension).
    if len(boxes) > 2:
        widths = [x1 - x0 for x0, y0, x1, y1 in boxes]
        heights = [y1 - y0 for x0, y0, x1, y1 in boxes]
        avg_w = sum(widths) / len(widths)
        avg_h = sum(heights) / len(heights)
        filtered = []
        for b in boxes:
            bw, bh = b[2] - b[0], b[3] - b[1]
            if bw > avg_w * 3 or bw < avg_w / 3 or bh > avg_h * 3 or bh < avg_h / 3:
                print(f"  Discarding outlier: {bw}x{bh} (avg {avg_w:.0f}x{avg_h:.0f})")
            else:
                filtered.append(b)
        boxes = filtered
        print(f"  After outlier filter: {len(boxes)} sprites")

    names_arg = [n.strip() for n in args.names.split(",") if n.strip()] if args.names else []
    ext = args.format
    save_kwargs = {"quality": args.quality} if ext == "webp" else {}
    saved_names = []

    for i, (x0, y0, x1, y1) in enumerate(boxes):
        pad = args.padding
        rx0, ry0 = max(0, x0 - pad), max(0, y0 - pad)
        rx1, ry1 = min(w, x1 + pad), min(h, y1 + pad)
        sprite = rgba.crop((rx0, ry0, rx1, ry1))
        sprite_arr = remove_small_clusters(np.array(sprite), args.min_cluster)
        sprite = Image.fromarray(sprite_arr)
        sprite = crop_to_content(sprite, padding=2)
        name = names_arg[i] if i < len(names_arg) else f"sprite-{i:02d}"
        sprite.save(os.path.join(args.output_dir, f"{name}.{ext}"), ext.upper(), **save_kwargs)
        saved_names.append(name)
        print(f"  [{i:02d}] {name}: {sprite.size[0]}x{sprite.size[1]}")

    with open(os.path.join(args.output_dir, "manifest.json"), "w") as f:
        json.dump(saved_names, f, indent=2)

    print(f"\nDone! {len(saved_names)} sprites + manifest.json saved to {args.output_dir}")


if __name__ == "__main__":
    main()
