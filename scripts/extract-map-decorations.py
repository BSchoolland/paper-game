#!/usr/bin/env python3
"""
Extract individual map decoration sprites from a hand-painted sheet.

The sheet has irregular spacing, so this uses foreground segmentation instead
of a fixed grid. It writes transparent PNG sprites and a manifest consumed by
the Pixi hex map renderer.
"""

import argparse
import json
import os
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import binary_dilation, binary_fill_holes, find_objects, label


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("output_dir")
    parser.add_argument("--prefix", default="forest-decor")
    parser.add_argument("--min-area", type=int, default=120)
    parser.add_argument("--padding", type=int, default=8)
    parser.add_argument("--cols", type=int, default=0)
    parser.add_argument("--rows", type=int, default=0)
    parser.add_argument(
        "--crop-margins",
        default="0,0,0,0",
        help="Fixed grid crop margins as left,top,right,bottom.",
    )
    return parser.parse_args()


def estimate_background(rgb: np.ndarray) -> np.ndarray:
    border = np.concatenate(
        [
            rgb[:20].reshape(-1, 3),
            rgb[-20:].reshape(-1, 3),
            rgb[:, :20].reshape(-1, 3),
            rgb[:, -20:].reshape(-1, 3),
        ]
    )
    return np.median(border, axis=0)


def foreground_mask(rgb: np.ndarray) -> np.ndarray:
    bg = estimate_background(rgb)
    diff = np.sqrt(np.sum((rgb - bg) ** 2, axis=2))
    saturation = (rgb.max(axis=2) - rgb.min(axis=2)) / (rgb.max(axis=2) + 1)
    luminance = 0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2]

    mask = ((diff > 50) & (saturation > 0.21)) | (luminance < 175)
    mask = binary_dilation(mask, iterations=2)
    mask = binary_fill_holes(mask)
    mask = binary_dilation(mask, iterations=1)
    return mask


def transparent_crop(pixels: np.ndarray, min_area: int) -> np.ndarray | None:
    crop_mask = foreground_mask(pixels[:, :, :3].astype(float))
    labeled, _ = label(crop_mask)
    keep = np.zeros(crop_mask.shape, dtype=bool)

    for component_id, slices in enumerate(find_objects(labeled), start=1):
        if slices is None:
            continue

        ys, xs = slices
        component = labeled[slices] == component_id
        area = int(component.sum())
        width = xs.stop - xs.start
        height = ys.stop - ys.start

        if area >= min_area and width >= 8 and height >= 8:
            keep[labeled == component_id] = True

    pixels = pixels.copy()
    pixels[:, :, 3] = np.where(keep, pixels[:, :, 3], 0).astype(np.uint8)

    rows = np.where(pixels[:, :, 3].max(axis=1) > 0)[0]
    cols = np.where(pixels[:, :, 3].max(axis=0) > 0)[0]
    if len(rows) == 0 or len(cols) == 0:
        return None

    return pixels[rows[0] : rows[-1] + 1, cols[0] : cols[-1] + 1]


def parse_margins(value: str) -> tuple[int, int, int, int]:
    parts = [int(part.strip()) for part in value.split(",")]
    if len(parts) != 4:
        raise ValueError("--crop-margins must be left,top,right,bottom")
    return parts[0], parts[1], parts[2], parts[3]


def extract_fixed_grid(src: Image.Image, args) -> list[str]:
    left, top, right, bottom = parse_margins(args.crop_margins)
    usable_w = src.width - left - right
    usable_h = src.height - top - bottom
    cell_w = usable_w / args.cols
    cell_h = usable_h / args.rows
    names = []

    for row in range(args.rows):
        for col in range(args.cols):
            x1 = round(left + col * cell_w)
            y1 = round(top + row * cell_h)
            x2 = round(left + (col + 1) * cell_w)
            y2 = round(top + (row + 1) * cell_h)
            cell = np.array(src.crop((x1, y1, x2, y2)).convert("RGBA"))
            crop = transparent_crop(cell, args.min_area)
            if crop is None:
                continue

            name = f"{args.prefix}-{len(names) + 1:02d}"
            Image.fromarray(crop).save(Path(args.output_dir) / f"{name}.png")
            names.append(name)

    return names


def extract_components(src: Image.Image, args) -> list[str]:
    pixels = np.array(src)
    rgb = pixels[:, :, :3].astype(float)
    mask = foreground_mask(rgb)
    labeled, _ = label(mask)

    components = []
    for component_id, slices in enumerate(find_objects(labeled), start=1):
        if slices is None:
            continue

        ys, xs = slices
        component_mask = labeled[slices] == component_id
        area = int(component_mask.sum())
        width = xs.stop - xs.start
        height = ys.stop - ys.start

        if area < args.min_area or width < 8 or height < 8:
            continue

        components.append((ys.start, xs.start, ys.stop, xs.stop, area))

    components.sort(key=lambda item: (item[0], item[1]))

    names = []
    for index, (top, left, bottom, right, _area) in enumerate(components, start=1):
        top = max(0, top - args.padding)
        left = max(0, left - args.padding)
        bottom = min(src.height, bottom + args.padding)
        right = min(src.width, right + args.padding)

        crop = transparent_crop(pixels[top:bottom, left:right], args.min_area)
        if crop is None:
            continue

        name = f"{args.prefix}-{index:02d}"
        Image.fromarray(crop).save(Path(args.output_dir) / f"{name}.png")
        names.append(name)

    return names


def main():
    args = parse_args()
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    src = Image.open(args.input).convert("RGBA")
    if args.cols > 0 or args.rows > 0:
        if args.cols <= 0 or args.rows <= 0:
            raise ValueError("--cols and --rows must be provided together")
        names = extract_fixed_grid(src, args)
    else:
        names = extract_components(src, args)

    with open(out_dir / "manifest.json", "w", encoding="utf-8") as f:
        json.dump(names, f, indent=2)
        f.write("\n")

    print(f"Extracted {len(names)} sprites to {os.fspath(out_dir)}")


if __name__ == "__main__":
    main()
