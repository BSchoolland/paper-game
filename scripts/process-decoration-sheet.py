#!/usr/bin/env python3
"""
Extract individual decoration sprites from a spritesheet on a parchment/colored
background. Uses flood-fill from edges to identify background (which respects
sprite boundaries even when sprite colors are similar to the background), then
connected components to find individual sprites.

Usage:
  python3 scripts/process-decoration-sheet.py <input-image> <output-dir>
      [--names name1,name2,...] [--tolerance 35] [--min-size 40] [--debug]

If --names is provided, sprites are named in row-major order (top-to-bottom,
left-to-right). Otherwise they're saved as sprite-00.webp, sprite-01.webp, ...
"""

import argparse
import os
import numpy as np
from PIL import Image
from scipy import ndimage
from collections import deque


def parse_args():
    p = argparse.ArgumentParser(description="Extract decoration sprites from a sheet.")
    p.add_argument("input", help="Path to the spritesheet image")
    p.add_argument("output_dir", help="Output directory for individual sprites")
    p.add_argument("--names", default="", help="Comma-separated sprite names (row-major)")
    p.add_argument("--tolerance", type=int, default=25, help="Flood-fill color tolerance")
    p.add_argument("--min-size", type=int, default=40, help="Minimum sprite dimension")
    p.add_argument("--padding", type=int, default=4, help="Padding around sprite")
    p.add_argument("--quality", type=int, default=90, help="WebP quality")
    p.add_argument("--row-height", type=int, default=80, help="Row band height for sort")
    p.add_argument("--min-cluster", type=int, default=50, help="Minimum pixel cluster size to keep")
    p.add_argument("--debug", action="store_true", help="Save debug image")
    return p.parse_args()


def flood_fill_background(arr: np.ndarray, tolerance: int) -> np.ndarray:
    """Flood-fill from edges; returns boolean mask where True = background."""
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


def find_sprite_boxes(bg_mask: np.ndarray, min_size: int, row_h: int):
    fg = (~bg_mask).astype(np.uint8)
    struct = np.ones((3, 3))
    fg = ndimage.binary_dilation(fg, structure=struct, iterations=2).astype(np.uint8)
    fg = ndimage.binary_erosion(fg, structure=struct, iterations=1).astype(np.uint8)

    labeled, num = ndimage.label(fg)
    boxes = []
    for i in range(1, num + 1):
        ys, xs = np.where(labeled == i)
        x0, x1 = int(xs.min()), int(xs.max()) + 1
        y0, y1 = int(ys.min()), int(ys.max()) + 1
        if (x1 - x0) >= min_size and (y1 - y0) >= min_size:
            boxes.append((x0, y0, x1, y1))

    boxes.sort(key=lambda b: (b[1] // row_h, b[0]))
    return boxes


def make_rgba(arr: np.ndarray, bg_mask: np.ndarray) -> Image.Image:
    alpha = np.where(bg_mask, 0, 255).astype(np.uint8)
    alpha_f = ndimage.gaussian_filter(alpha.astype(float), sigma=0.6)
    alpha = np.clip(alpha_f, 0, 255).astype(np.uint8)
    return Image.fromarray(np.dstack([arr, alpha]), "RGBA")


def remove_small_clusters(pixels: np.ndarray, min_cluster: int) -> np.ndarray:
    alpha = pixels[:, :, 3]
    mask = alpha > 10
    labeled_arr, num_features = ndimage.label(mask)
    for i in range(1, num_features + 1):
        cluster = labeled_arr == i
        if cluster.sum() < min_cluster:
            pixels[cluster, 3] = 0
    return pixels


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
    os.makedirs(args.output_dir, exist_ok=True)

    print(f"Loading {args.input}...")
    img = Image.open(args.input).convert("RGB")
    arr = np.array(img)
    h, w = arr.shape[:2]
    print(f"  Size: {w}x{h}")

    print(f"Flood-filling background (tolerance={args.tolerance})...")
    bg_mask = flood_fill_background(arr, args.tolerance)
    print(f"  Background: {bg_mask.sum() / (h * w) * 100:.1f}% of image")

    print("Finding sprites...")
    boxes = find_sprite_boxes(bg_mask, args.min_size, args.row_height)
    print(f"  Found {len(boxes)} sprites")

    rgba = make_rgba(arr, bg_mask)

    if args.debug:
        from PIL import ImageDraw
        debug = rgba.copy()
        draw = ImageDraw.Draw(debug)
        for i, (x0, y0, x1, y1) in enumerate(boxes):
            draw.rectangle([x0, y0, x1, y1], outline=(255, 0, 0, 255), width=2)
            draw.text((x0 + 2, y0 - 14), str(i), fill=(255, 0, 0, 255))
        debug.save(os.path.join(args.output_dir, "_debug.png"))
        print(f"  Debug saved")

    names = [n.strip() for n in args.names.split(",") if n.strip()] if args.names else []

    for i, (x0, y0, x1, y1) in enumerate(boxes):
        pad = args.padding
        rx0, ry0 = max(0, x0 - pad), max(0, y0 - pad)
        rx1, ry1 = min(w, x1 + pad), min(h, y1 + pad)
        sprite = rgba.crop((rx0, ry0, rx1, ry1))
        sprite_arr = remove_small_clusters(np.array(sprite), args.min_cluster)
        sprite = Image.fromarray(sprite_arr)
        sprite = crop_to_content(sprite, padding=2)
        name = names[i] if i < len(names) else f"sprite-{i:02d}"
        out_path = os.path.join(args.output_dir, f"{name}.webp")
        sprite.save(out_path, "WEBP", quality=args.quality)
        print(f"  [{i:02d}] {name}: {sprite.size[0]}x{sprite.size[1]}")

    print(f"\nDone! {len(boxes)} sprites saved to {args.output_dir}")


if __name__ == "__main__":
    main()
