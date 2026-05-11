#!/usr/bin/env python3
"""
Split an item sprite sheet into individual sprites on a clean grid (no
animation states — each cell is one item). Removes the parchment background
via flood-fill from the cell edges and tightly crops to content.

Usage:
  python3 scripts/process-item-sheet.py <input-image> <output-dir> \
      --cols 4 --rows 4 --names item1,item2,...,item16

Names are applied in row-major order (left-to-right, top-to-bottom).
"""

import argparse
import os
import numpy as np
from PIL import Image
from scipy import ndimage
from collections import deque


def parse_args():
    p = argparse.ArgumentParser(description="Split an item spritesheet by grid.")
    p.add_argument("input")
    p.add_argument("output_dir")
    p.add_argument("--cols", type=int, default=4)
    p.add_argument("--rows", type=int, default=4)
    p.add_argument("--names", required=True, help="Comma-separated, row-major")
    p.add_argument("--tolerance", type=int, default=35, help="Flood-fill color tolerance")
    p.add_argument("--padding", type=int, default=4)
    p.add_argument("--quality", type=int, default=90)
    p.add_argument("--inset", type=int, default=8, help="Pixels to crop in from each cell edge to skip grid lines")
    return p.parse_args()


def flood_fill_bg(arr: np.ndarray, tolerance: int) -> np.ndarray:
    h, w = arr.shape[:2]
    img_f = arr.astype(float)
    visited = np.zeros((h, w), dtype=bool)
    is_bg = np.zeros((h, w), dtype=bool)
    queue = deque()
    for x in range(w):
        for y in (0, h - 1):
            if not visited[y, x]:
                visited[y, x] = True
                is_bg[y, x] = True
                queue.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if not visited[y, x]:
                visited[y, x] = True
                is_bg[y, x] = True
                queue.append((y, x))
    while queue:
        cy, cx = queue.popleft()
        center = img_f[cy, cx]
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            ny, nx = cy + dy, cx + dx
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx]:
                visited[ny, nx] = True
                if np.sqrt(np.sum((img_f[ny, nx] - center) ** 2)) < tolerance:
                    is_bg[ny, nx] = True
                    queue.append((ny, nx))
    return is_bg


def keep_largest_cluster(alpha: np.ndarray) -> np.ndarray:
    """Zero out all but the largest connected foreground cluster."""
    mask = alpha > 30
    # Dilate slightly so a single item doesn't fragment across thin gaps
    struct = np.ones((3, 3))
    dilated = ndimage.binary_dilation(mask, structure=struct, iterations=2)
    labeled, num = ndimage.label(dilated)
    if num == 0:
        return alpha
    sizes = ndimage.sum(dilated, labeled, range(1, num + 1))
    biggest = int(np.argmax(sizes)) + 1
    keep = labeled == biggest
    return np.where(keep, alpha, 0).astype(np.uint8)


def cell_to_rgba(arr: np.ndarray, tolerance: int) -> Image.Image:
    bg_mask = flood_fill_bg(arr, tolerance)
    alpha = np.where(bg_mask, 0, 255).astype(np.uint8)
    alpha_f = ndimage.gaussian_filter(alpha.astype(float), sigma=0.6)
    alpha = np.clip(alpha_f, 0, 255).astype(np.uint8)
    alpha = keep_largest_cluster(alpha)
    return Image.fromarray(np.dstack([arr, alpha]), "RGBA")


def crop_to_content(img: Image.Image, padding: int) -> Image.Image:
    bbox = img.getbbox()
    if bbox is None:
        return img
    x0, y0, x1, y1 = bbox
    x0 = max(0, x0 - padding)
    y0 = max(0, y0 - padding)
    x1 = min(img.width, x1 + padding)
    y1 = min(img.height, y1 + padding)
    return img.crop((x0, y0, x1, y1))


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
            out = os.path.join(args.output_dir, f"{name}.webp")
            cropped.save(out, "WEBP", quality=args.quality)
            print(f"  {name}: {cropped.size[0]}x{cropped.size[1]}")

    print(f"\nDone! {expected} items saved to {args.output_dir}")


if __name__ == "__main__":
    main()
