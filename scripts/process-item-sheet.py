#!/usr/bin/env python3
"""
Split an item sprite sheet into individual sprites on a clean grid (no
animation states — each cell is one item). Removes the parchment background
via flood-fill from the cell edges and tightly crops to content.

Usage:
  python3 scripts/process-item-sheet.py <input-image> <output-dir> \
      --cols 4 --rows 4 --names item1,item2,...,item16

Names are applied in row-major order (left-to-right, top-to-bottom).
Outputs PNG by default (what the game's loaders expect).
"""

import argparse
import os
import numpy as np
from PIL import Image

from _sheet_utils import flood_fill_from_edges, rgba_from_bg_mask, keep_largest_cluster, crop_to_content


def parse_args():
    p = argparse.ArgumentParser(description="Split an item spritesheet by grid.")
    p.add_argument("input")
    p.add_argument("output_dir")
    p.add_argument("--cols", type=int, default=4)
    p.add_argument("--rows", type=int, default=4)
    p.add_argument("--names", required=True, help="Comma-separated, row-major")
    p.add_argument("--tolerance", type=int, default=35, help="Flood-fill color tolerance")
    p.add_argument("--padding", type=int, default=4)
    p.add_argument("--format", default="png", choices=["png", "webp"])
    p.add_argument("--quality", type=int, default=90, help="WebP quality (ignored for PNG)")
    p.add_argument("--inset", type=int, default=8, help="Pixels to crop in from each cell edge to skip grid lines")
    return p.parse_args()


def cell_to_rgba(arr: np.ndarray, tolerance: int) -> Image.Image:
    bg_mask = flood_fill_from_edges(arr, tolerance)
    rgba = rgba_from_bg_mask(arr, bg_mask)
    pixels = np.array(rgba)
    pixels[:, :, 3] = keep_largest_cluster(pixels[:, :, 3])
    return Image.fromarray(pixels)


def main():
    args = parse_args()
    names = [n.strip() for n in args.names.split(",")]
    expected = args.cols * args.rows
    if len(names) != expected:
        raise SystemExit(f"Expected {expected} names ({args.cols}x{args.rows}), got {len(names)}")

    os.makedirs(args.output_dir, exist_ok=True)
    src = Image.open(args.input).convert("RGB")
    w, h = src.size
    cell_w = w / args.cols
    cell_h = h / args.rows
    print(f"Source: {w}x{h}, grid {args.cols}x{args.rows}, cell ~{cell_w:.0f}x{cell_h:.0f}")

    ext = args.format
    save_kwargs = {"quality": args.quality} if ext == "webp" else {}
    for row in range(args.rows):
        for col in range(args.cols):
            x1 = round(col * cell_w) + args.inset
            y1 = round(row * cell_h) + args.inset
            x2 = round((col + 1) * cell_w) - args.inset
            y2 = round((row + 1) * cell_h) - args.inset
            cell_arr = np.array(src.crop((x1, y1, x2, y2)))
            rgba = cell_to_rgba(cell_arr, args.tolerance)
            cropped = crop_to_content(rgba, args.padding)
            name = names[row * args.cols + col]
            cropped.save(os.path.join(args.output_dir, f"{name}.{ext}"), ext.upper(), **save_kwargs)
            print(f"  {name}: {cropped.size[0]}x{cropped.size[1]}")

    print(f"\nDone! {expected} items saved to {args.output_dir}")


if __name__ == "__main__":
    main()
