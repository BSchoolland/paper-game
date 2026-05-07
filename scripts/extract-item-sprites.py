#!/usr/bin/env python3
"""
Extract individual item sprites from a 4x4 grid sprite sheet.

Usage:
  python3 scripts/extract-item-sprites.py <input-image> <output-dir>

Outputs one .webp per item, named by the item grid position. Also writes
a manifest.json mapping item IDs to filenames.
"""

import argparse
import json
import os
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import binary_dilation, binary_fill_holes, label

ITEM_GRID = [
    ["short-sword", "long-sword", "spear", "axe"],
    ["bow", "broadsword", "battle-axe", "mace"],
    ["round-shield", "kite-shield", "buckler", "quiver"],
    ["staff", "spellbook", "potion", "bomb"],
]


def parse_args():
    p = argparse.ArgumentParser(description="Extract item sprites from a grid sheet.")
    p.add_argument("input", help="Path to the sprite sheet image")
    p.add_argument("output_dir", help="Output directory for individual sprites")
    p.add_argument("--cols", type=int, default=4)
    p.add_argument("--rows", type=int, default=4)
    p.add_argument("--bg-tolerance", type=int, default=55)
    p.add_argument("--min-cluster", type=int, default=30)
    p.add_argument("--format", default="webp", choices=["webp", "png"])
    p.add_argument("--quality", type=int, default=90)
    p.add_argument("--padding", type=int, default=4)
    return p.parse_args()


def estimate_background(rgb: np.ndarray) -> np.ndarray:
    border = np.concatenate([
        rgb[:10].reshape(-1, 3),
        rgb[-10:].reshape(-1, 3),
        rgb[:, :10].reshape(-1, 3),
        rgb[:, -10:].reshape(-1, 3),
    ])
    return np.median(border, axis=0)


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


def remove_small_clusters(pixels: np.ndarray, min_cluster: int) -> np.ndarray:
    alpha = pixels[:, :, 3]
    mask = alpha > 10
    labeled_arr, num_features = label(mask)

    for i in range(1, num_features + 1):
        cluster = labeled_arr == i
        if cluster.sum() < min_cluster:
            pixels[cluster, 3] = 0

    return pixels


def tight_crop(pixels: np.ndarray, padding: int) -> np.ndarray:
    alpha = pixels[:, :, 3]
    rows = np.where(alpha.max(axis=1) > 10)[0]
    cols = np.where(alpha.max(axis=0) > 10)[0]
    if len(rows) == 0 or len(cols) == 0:
        return pixels

    top = max(0, rows[0] - padding)
    bottom = min(pixels.shape[0], rows[-1] + 1 + padding)
    left = max(0, cols[0] - padding)
    right = min(pixels.shape[1], cols[-1] + 1 + padding)
    return pixels[top:bottom, left:right]


def main():
    args = parse_args()
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    src = Image.open(args.input).convert("RGBA")
    w, h = src.size
    cell_w = w / args.cols
    cell_h = h / args.rows
    bg = estimate_background(np.array(src.convert("RGB")).astype(float))
    print(f"Source: {w}x{h}, grid: {args.cols}x{args.rows}, bg color: {bg.astype(int)}")

    manifest = {}
    fmt = args.format.upper()
    save_kwargs = {"quality": args.quality} if fmt == "WEBP" else {}

    for row in range(args.rows):
        for col in range(args.cols):
            item_id = ITEM_GRID[row][col]

            x1 = round(col * cell_w)
            y1 = round(row * cell_h)
            x2 = round((col + 1) * cell_w)
            y2 = round((row + 1) * cell_h)

            cell = np.array(src.crop((x1, y1, x2, y2)).convert("RGBA"))
            cell = remove_background(cell, bg, args.bg_tolerance)
            cell = remove_small_clusters(cell, args.min_cluster)
            cell = tight_crop(cell, args.padding)

            filename = f"{item_id}.{args.format}"
            Image.fromarray(cell).save(out_dir / filename, fmt, **save_kwargs)
            manifest[item_id] = filename
            print(f"  Saved: {filename} ({cell.shape[1]}x{cell.shape[0]})")

    with open(out_dir / "manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")

    print(f"\nDone! {len(manifest)} item sprites saved to {os.fspath(out_dir)}")


if __name__ == "__main__":
    main()
