#!/usr/bin/env python3
"""
Process a spritesheet of decorations into individual transparent webp sprites.
Usage: python3 process-sprites.py <input.png> <output-dir> [--preview]
"""

import sys
import os
from PIL import Image
import numpy as np


def remove_background(img: Image.Image, threshold: int = 30) -> Image.Image:
    """Remove parchment/paper background by detecting the dominant bg color."""
    arr = np.array(img.convert("RGB"))

    # Sample corners to estimate background color
    h, w = arr.shape[:2]
    corners = np.concatenate([
        arr[0:20, 0:20].reshape(-1, 3),
        arr[0:20, w-20:w].reshape(-1, 3),
        arr[h-20:h, 0:20].reshape(-1, 3),
        arr[h-20:h, w-20:w].reshape(-1, 3),
    ])
    bg_color = np.median(corners, axis=0)

    # Distance from background color
    diff = np.sqrt(np.sum((arr.astype(float) - bg_color) ** 2, axis=2))

    # Create alpha channel
    alpha = np.clip((diff - threshold) * (255 / 30), 0, 255).astype(np.uint8)

    rgba = np.dstack([arr, alpha])
    return Image.fromarray(rgba, "RGBA")


def fill_interior_holes(img: Image.Image, hole_ratio: float = 1/10) -> Image.Image:
    """Fill transparent regions that are small relative to the sprite's opaque area.
    Only considers interior holes — regions touching the edge are always removed."""
    from scipy import ndimage
    arr = np.array(img)
    alpha = arr[:, :, 3].copy()
    h, w = alpha.shape

    transparent_mask = (alpha < 128).astype(np.uint8)
    labeled, num = ndimage.label(transparent_mask)

    # Count opaque pixels in this sprite
    opaque_count = int(np.sum(alpha >= 128))
    if opaque_count == 0:
        return img

    min_hole = int(opaque_count * hole_ratio)

    for i in range(1, num + 1):
        component = (labeled == i)
        # Skip regions that touch any edge (those are background, not holes)
        if (component[0, :].any() or component[-1, :].any() or
                component[:, 0].any() or component[:, -1].any()):
            continue
        if np.sum(component) < min_hole:
            alpha[component] = 255

    arr[:, :, 3] = alpha
    return Image.fromarray(arr, "RGBA")


def find_sprites(alpha: np.ndarray, min_size: int = 30, gap: int = 3) -> list[tuple[int, int, int, int]]:
    """Find bounding boxes of individual sprites by connected component analysis."""
    mask = (alpha > 50).astype(np.uint8)

    from scipy import ndimage
    # Dilate to bridge small gaps within a single sprite
    struct = ndimage.generate_binary_structure(2, 2)
    dilated = ndimage.binary_dilation(mask, structure=struct, iterations=gap)
    labeled, num_features = ndimage.label(dilated)

    boxes = []
    for i in range(1, num_features + 1):
        ys, xs = np.where(labeled == i)
        x0, x1 = xs.min(), xs.max()
        y0, y1 = ys.min(), ys.max()
        w = x1 - x0
        h = y1 - y0
        if w >= min_size and h >= min_size:
            boxes.append((x0, y0, x1 + 1, y1 + 1))

    # Sort top-to-bottom, left-to-right
    boxes.sort(key=lambda b: (b[1] // 80, b[0]))
    return boxes


def crop_to_content(img: Image.Image, padding: int = 2) -> Image.Image:
    """Crop to non-transparent content with a small padding."""
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
    if len(sys.argv) < 3:
        print("Usage: python3 process-sprites.py <input.png> <output-dir> [--preview]")
        sys.exit(1)

    input_path = sys.argv[1]
    output_dir = sys.argv[2]
    preview = "--preview" in sys.argv

    os.makedirs(output_dir, exist_ok=True)

    print(f"Loading {input_path}...")
    img = Image.open(input_path)
    print(f"  Size: {img.size}, Mode: {img.mode}")

    print("Removing background...")
    rgba = remove_background(img)

    alpha = np.array(rgba)[:, :, 3]
    print("Finding sprites...")
    boxes = find_sprites(alpha)
    print(f"  Found {len(boxes)} sprites")

    if preview:
        # Save a debug image showing bounding boxes
        from PIL import ImageDraw
        debug = rgba.copy()
        draw = ImageDraw.Draw(debug)
        for i, (x0, y0, x1, y1) in enumerate(boxes):
            draw.rectangle([x0, y0, x1, y1], outline=(255, 0, 0, 255), width=2)
            draw.text((x0, y0 - 12), str(i), fill=(255, 0, 0, 255))
        debug.save(os.path.join(output_dir, "_debug_boxes.png"))
        print(f"  Saved debug image to {output_dir}/_debug_boxes.png")

    for i, (x0, y0, x1, y1) in enumerate(boxes):
        sprite = rgba.crop((x0, y0, x1, y1))
        sprite = fill_interior_holes(sprite)
        sprite = crop_to_content(sprite)
        out_path = os.path.join(output_dir, f"sprite-{i:02d}.webp")
        sprite.save(out_path, "WEBP", quality=90)
        print(f"  [{i:02d}] {sprite.size[0]}x{sprite.size[1]} -> {out_path}")

    print("Done!")


if __name__ == "__main__":
    main()
