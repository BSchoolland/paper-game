#!/usr/bin/env python3
"""
Split a sprite sheet into individual sprites with HSV-based background removal.
Targets parchment-colored backgrounds specifically while preserving visual effects
(sword slashes, magic orbs, etc).

Usage:
  python3 scripts/process-spritesheet-v2.py <input-image> <output-dir> [options]
"""

import argparse
import os
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import label, binary_dilation, binary_erosion


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("input")
    p.add_argument("output_dir")
    p.add_argument("--cols", type=int, default=6)
    p.add_argument("--rows", type=int, default=4)
    p.add_argument("--names", default="sword,spear,bow,staff,two-handed,dual-wield")
    p.add_argument("--states", default="idle,attack,hit,move")
    p.add_argument("--format", default="webp", choices=["webp", "png"])
    p.add_argument("--quality", type=int, default=90)
    p.add_argument("--foot-threshold", type=float, default=0.05)
    p.add_argument("--border-margin", type=int, default=8,
                   help="Pixels from cell edge to consider as border zone for artifact removal")
    return p.parse_args()


def rgb_to_hsv_array(rgb):
    """Convert RGB array (H x W x 3, uint8) to HSV (H x W x 3, float: H=0-360, S=0-1, V=0-1)."""
    rgb_f = rgb.astype(np.float32) / 255.0
    r, g, b = rgb_f[:, :, 0], rgb_f[:, :, 1], rgb_f[:, :, 2]

    cmax = np.maximum(np.maximum(r, g), b)
    cmin = np.minimum(np.minimum(r, g), b)
    delta = cmax - cmin

    h = np.zeros_like(cmax)
    mask = delta > 0
    rm = mask & (cmax == r)
    gm = mask & (cmax == g)
    bm = mask & (cmax == b)
    h[rm] = 60 * (((g[rm] - b[rm]) / delta[rm]) % 6)
    h[gm] = 60 * (((b[gm] - r[gm]) / delta[gm]) + 2)
    h[bm] = 60 * (((r[bm] - g[bm]) / delta[bm]) + 4)

    s = np.zeros_like(cmax)
    s[cmax > 0] = delta[cmax > 0] / cmax[cmax > 0]

    return np.stack([h, s, cmax], axis=-1)


def sample_bg_color(pixels):
    """Sample background color from cell corners."""
    rgb = pixels[:, :, :3].astype(float)
    corners = [rgb[5, 5], rgb[5, -5], rgb[-5, 5], rgb[-5, -5]]
    return np.mean(corners, axis=0)


def make_bg_mask(rgb, bg_color, tolerance):
    """Create background color mask using RGB distance."""
    diff = np.sqrt(np.sum((rgb.astype(float) - bg_color) ** 2, axis=2))
    return diff < tolerance


def remove_background(pixels, border_margin=8):
    """Remove parchment background while preserving visual effects.

    Uses HSV to identify "protected" pixels (non-parchment effects like white
    sword slashes and green magic orbs) that block the flood fill from spreading."""
    rgb = pixels[:, :, :3]
    alpha = pixels[:, :, 3].copy()
    h, w = alpha.shape

    bg_color = sample_bg_color(pixels)
    diff = np.sqrt(np.sum((rgb.astype(float) - bg_color) ** 2, axis=2))

    hsv = rgb_to_hsv_array(rgb)
    hue, sat, val = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]

    # Parchment: warm hue (35-50°), moderate saturation (20-45%), medium+ value
    is_parchment_hue = (hue >= 30) & (hue <= 55) & (sat >= 0.15) & (sat <= 0.50)

    # Effects to protect:
    # - White/gray (low saturation, any hue) — sword slashes, wind effects
    is_desaturated = sat < 0.12
    # - Green-tinted (hue 60-180°) — magic orbs
    is_green = (hue >= 60) & (hue <= 180) & (sat >= 0.08)
    # - Very dark (ink outlines that shouldn't be eaten)
    is_dark = val < 0.25

    protected = (is_desaturated | is_green | is_dark) & (~is_parchment_hue)

    # Background mask: must match parchment color AND not be protected
    bg_mask = (diff < 80) & (~protected)

    # Edge-connected flood fill
    labeled, _ = label(bg_mask)
    edge_labels = set()
    edge_labels.update(labeled[0, :].tolist())
    edge_labels.update(labeled[h - 1, :].tolist())
    edge_labels.update(labeled[:, 0].tolist())
    edge_labels.update(labeled[:, w - 1].tolist())
    edge_labels.discard(0)

    bg_final = np.isin(labeled, list(edge_labels))

    # Fringe cleanup — expand into adjacent parchment-like pixels, but not protected
    dilated = binary_dilation(bg_final, iterations=2)
    fringe = dilated & (~bg_final) & (diff < 100) & (~protected)
    bg_final = bg_final | fringe

    alpha[bg_final] = 0

    # Remove interior parchment pockets (e.g., between legs)
    # These are small parchment-colored regions not connected to edges
    # Remove interior parchment pockets (not edge-connected but still bg-colored).
    # These are patches like the gap between legs that the flood fill can't reach.
    interior_bg = bg_mask & (~bg_final)
    labeled_int, n_int = label(interior_bg)
    for i in range(1, n_int + 1):
        cluster = labeled_int == i
        if cluster.sum() > 30:
            alpha[cluster] = 0
            # Also clean the fringe around interior pockets
            int_dilated = binary_dilation(cluster, iterations=2)
            int_fringe = int_dilated & (~cluster) & (diff < 100) & (~protected)
            alpha[int_fringe] = 0

    # Soft boundary
    boundary = binary_dilation(bg_final, iterations=1) & (~bg_final)
    edge_alpha = np.clip((diff[boundary] / 80) * 255, 0, 255).astype(np.uint8)
    alpha[boundary] = np.minimum(alpha[boundary], edge_alpha)

    pixels[:, :, 3] = alpha
    return pixels


def remove_border_artifacts(pixels, border_margin=12):
    """Remove clusters that are neighboring-cell bleed-in artifacts.

    Strategy: artifacts from neighboring cells appear near cell borders and are
    not spatially close to the main character. Effects (sword slashes, magic orbs)
    are near the character even if disconnected, so we keep those."""
    alpha = pixels[:, :, 3]
    h, w = alpha.shape
    mask = alpha > 10
    labeled, num_features = label(mask)

    if num_features == 0:
        return pixels

    sizes = []
    for i in range(1, num_features + 1):
        sizes.append((labeled == i).sum())
    main_label = np.argmax(sizes) + 1
    main_size = sizes[main_label - 1]

    # Get main cluster bounding box
    main_mask = labeled == main_label
    main_rows = np.where(main_mask.any(axis=1))[0]
    main_cols = np.where(main_mask.any(axis=0))[0]
    main_top, main_bottom = main_rows[0], main_rows[-1]
    main_left, main_right = main_cols[0], main_cols[-1]

    # Dilate main cluster to create a "proximity zone" — effects within
    # this zone are kept, everything outside is suspect
    proximity = binary_dilation(main_mask, iterations=25)

    for i in range(1, num_features + 1):
        if i == main_label:
            continue
        cluster = labeled == i
        cluster_size = sizes[i - 1]

        rows = np.where(cluster.any(axis=1))[0]
        cols = np.where(cluster.any(axis=0))[0]

        touches_top = rows[0] < border_margin
        touches_bottom = rows[-1] > h - border_margin
        touches_left = cols[0] < border_margin
        touches_right = cols[-1] > w - border_margin
        touches_border = touches_top or touches_bottom or touches_left or touches_right

        near_main = np.any(cluster & proximity)

        # Remove if: near cell border AND not near the main character
        if touches_border and not near_main:
            pixels[cluster, 3] = 0
        # Remove tiny noise clusters
        elif cluster_size < 20:
            pixels[cluster, 3] = 0
        # Remove border-touching clusters that are very small
        elif touches_border and cluster_size < 200:
            pixels[cluster, 3] = 0

    return pixels


def find_foot_row(alpha, threshold):
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
    cell_w = w / args.cols
    cell_h = h / args.rows
    print(f"Source: {w}x{h}, grid: {args.cols}x{args.rows}")

    cells = {}
    for row in range(args.rows):
        for col in range(args.cols):
            x1 = round(col * cell_w)
            y1 = round(row * cell_h)
            x2 = round((col + 1) * cell_w)
            y2 = round((row + 1) * cell_h)

            cell = src.crop((x1, y1, x2, y2)).convert("RGBA")
            pixels = np.array(cell)
            pixels = remove_background(pixels, args.border_margin)
            pixels = remove_border_artifacts(pixels, args.border_margin)

            name = f"{names[col]}-{states[row]}"
            cells[name] = pixels
            print(f"  Extracted: {name} ({x2 - x1}x{y2 - y1})")

    # Find content bounds and normalize canvas size
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

    # Place content bottom-aligned, horizontally centered
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

    # Align feet
    foot_rows = {}
    for name, pixels in normalized.items():
        foot_rows[name] = find_foot_row(pixels[:, :, 3], args.foot_threshold)

    idle_names = [n for n in normalized if n.endswith("-idle")]
    target_foot = max(foot_rows[n] for n in idle_names) if idle_names else max(foot_rows.values())
    print(f"Target foot row: {target_foot}")

    # Save
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
