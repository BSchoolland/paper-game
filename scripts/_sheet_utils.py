"""Shared helpers for the sprite-sheet extraction scripts.

Imported by process-spritesheet.py / process-item-sheet.py / process-decoration-sheet.py.
Run those as `python3 scripts/<name>.py ...` from the repo root so `scripts/` is on sys.path.
"""

from collections import deque

import numpy as np
from PIL import Image
from scipy import ndimage


def flood_fill_from_edges(arr: np.ndarray, tolerance: int) -> np.ndarray:
    """Flood-fill the background inward from the image edges.

    Returns a boolean mask where True = background. Respects sprite boundaries
    even when a sprite's colour is close to the parchment, because the fill
    stops at any colour step larger than `tolerance`.
    """
    h, w = arr.shape[:2]
    img_f = arr.astype(float)
    visited = np.zeros((h, w), dtype=bool)
    is_bg = np.zeros((h, w), dtype=bool)

    queue: deque = deque()
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


def rgba_from_bg_mask(arr: np.ndarray, bg_mask: np.ndarray, smooth_sigma: float = 0.6) -> Image.Image:
    """RGB array + background mask -> RGBA image (opaque where not background, lightly smoothed alpha)."""
    alpha = np.where(bg_mask, 0, 255).astype(np.uint8)
    if smooth_sigma > 0:
        alpha = np.clip(ndimage.gaussian_filter(alpha.astype(float), sigma=smooth_sigma), 0, 255).astype(np.uint8)
    return Image.fromarray(np.dstack([arr, alpha]), "RGBA")


def remove_small_clusters(pixels: np.ndarray, min_cluster: int) -> np.ndarray:
    """Zero the alpha of any connected opaque region smaller than `min_cluster` pixels. Mutates & returns `pixels`."""
    labeled, num = ndimage.label(pixels[:, :, 3] > 10)
    for i in range(1, num + 1):
        cluster = labeled == i
        if cluster.sum() < min_cluster:
            pixels[cluster, 3] = 0
    return pixels


def keep_largest_cluster(alpha: np.ndarray) -> np.ndarray:
    """Zero everything except the largest connected foreground region (small dilation first to bridge thin gaps)."""
    dilated = ndimage.binary_dilation(alpha > 30, structure=np.ones((3, 3)), iterations=2)
    labeled, num = ndimage.label(dilated)
    if num == 0:
        return alpha
    sizes = ndimage.sum(dilated, labeled, range(1, num + 1))
    biggest = int(np.argmax(sizes)) + 1
    return np.where(labeled == biggest, alpha, 0).astype(np.uint8)


def crop_to_content(img: Image.Image, padding: int) -> Image.Image:
    """Crop an RGBA image to its non-transparent bounding box, expanded by `padding` (clamped to the image)."""
    bbox = img.getbbox()
    if bbox is None:
        return img
    x0, y0, x1, y1 = bbox
    return img.crop((
        max(0, x0 - padding), max(0, y0 - padding),
        min(img.width, x1 + padding), min(img.height, y1 + padding),
    ))
