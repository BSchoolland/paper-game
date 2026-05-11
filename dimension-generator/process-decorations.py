#!/usr/bin/env python3
"""
Extract individual decoration sprites from a spritesheet.
Uses flood-fill from edges to identify background, then connected
components to find individual sprites.
"""

import os
import sys
import numpy as np
from PIL import Image
from scipy import ndimage
from collections import deque


SRC = "/home/ben/.claude/image-cache/2217dfb6-36d2-4cec-9937-50f37fad5f5c/2.png"
OUT = "/home/ben/Projects/turn-based-game/dimension-generator/output-dim1"


def flood_fill_background(arr: np.ndarray, tolerance: int = 35) -> np.ndarray:
    """
    Flood-fill from all edge pixels to find connected background.
    Returns a boolean mask where True = background.
    """
    h, w = arr.shape[:2]
    img_f = arr.astype(float)
    visited = np.zeros((h, w), dtype=bool)
    is_bg = np.zeros((h, w), dtype=bool)

    # Seed from all edge pixels
    seeds = set()
    for x in range(w):
        seeds.add((0, x))
        seeds.add((h - 1, x))
    for y in range(h):
        seeds.add((y, 0))
        seeds.add((y, w - 1))

    queue = deque()
    for (y, x) in seeds:
        if not visited[y, x]:
            visited[y, x] = True
            is_bg[y, x] = True
            queue.append((y, x))

    # BFS flood fill — a pixel is background if it's within tolerance
    # of its neighbor that's already marked as background
    while queue:
        cy, cx = queue.popleft()
        center_color = img_f[cy, cx]
        for dy, dx in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            ny, nx = cy + dy, cx + dx
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx]:
                visited[ny, nx] = True
                diff = np.sqrt(np.sum((img_f[ny, nx] - center_color) ** 2))
                if diff < tolerance:
                    is_bg[ny, nx] = True
                    queue.append((ny, nx))

    return is_bg


def extract_sprites(arr: np.ndarray, bg_mask: np.ndarray, min_size: int = 40):
    """Find connected foreground regions and return bounding boxes."""
    fg = (~bg_mask).astype(np.uint8)

    # Small dilate to bridge hairline gaps within sprites
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

    boxes.sort(key=lambda b: (b[1] // 80, b[0]))
    return boxes


def make_rgba(arr: np.ndarray, bg_mask: np.ndarray) -> Image.Image:
    """Create RGBA image with background pixels made transparent."""
    alpha = np.where(bg_mask, 0, 255).astype(np.uint8)
    # Soften edges
    alpha_f = ndimage.gaussian_filter(alpha.astype(float), sigma=0.6)
    alpha = np.clip(alpha_f, 0, 255).astype(np.uint8)
    return Image.fromarray(np.dstack([arr, alpha]), "RGBA")


def crop_to_content(img: Image.Image, padding: int = 2) -> Image.Image:
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
    os.makedirs(OUT, exist_ok=True)

    print(f"Loading {SRC}...")
    img = Image.open(SRC).convert("RGB")
    arr = np.array(img)
    h, w = arr.shape[:2]
    print(f"  Size: {w}x{h}")

    print("Flood-filling background from edges...")
    bg_mask = flood_fill_background(arr, tolerance=35)
    bg_pct = bg_mask.sum() / (h * w) * 100
    print(f"  Background: {bg_pct:.1f}% of image")

    print("Finding sprites...")
    boxes = extract_sprites(arr, bg_mask)
    print(f"  Found {len(boxes)} sprites")

    # Build full RGBA image for extraction
    rgba = make_rgba(arr, bg_mask)

    # Save debug image
    from PIL import ImageDraw
    debug = rgba.copy()
    draw = ImageDraw.Draw(debug)
    for i, (x0, y0, x1, y1) in enumerate(boxes):
        draw.rectangle([x0, y0, x1, y1], outline=(255, 0, 0, 255), width=2)
        draw.text((x0 + 2, y0 - 14), str(i), fill=(255, 0, 0, 255))
    debug.save(os.path.join(OUT, "_debug_flood.png"))
    print(f"  Saved debug to {OUT}/_debug_flood.png")

    # Extract each sprite
    for i, (x0, y0, x1, y1) in enumerate(boxes):
        pad = 4
        rx0 = max(0, x0 - pad)
        ry0 = max(0, y0 - pad)
        rx1 = min(w, x1 + pad)
        ry1 = min(h, y1 + pad)
        sprite = rgba.crop((rx0, ry0, rx1, ry1))
        sprite = crop_to_content(sprite)
        out_path = os.path.join(OUT, f"sprite-{i:02d}.webp")
        sprite.save(out_path, "WEBP", quality=90)
        print(f"  [{i:02d}] {x1-x0:3d}x{y1-y0:3d} -> {sprite.size[0]}x{sprite.size[1]}")

    print("Done!")


if __name__ == "__main__":
    main()
