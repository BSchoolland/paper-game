#!/usr/bin/env python3
"""Content-aware sprite-sheet splitter. Instead of hard-cutting the sheet into a
fixed grid (which truncates oversized subjects), it detects objects, groups them
to expected sprite centers, and boxes each group — so a dragon whose wing overflows
its cell stays whole.

Pipeline (each step dumps a debug image to <debug-dir>):
  1. bg_remove      — drop the corner background color everywhere (dumb, no floodfill)
  2. object_detect  — connected-component grouping of the remaining pixels
  3. center_point   — center of mass of each object, snapped to its nearest solid pixel
  4. group          — assign objects to the 16 grid-center sprites (within cell/2 - deadzone)
  5. boxes          — bounding box per sprite covering all its objects
  6. save           — crop + save each sprite

Usage: python3 scripts/detect-sprites.py <sheet.png> <out-dir> [--cols 4] [--rows 4]
                    [--tol 40] [--deadzone 20] [--min-object 40] [--debug-dir DIR]
"""
import argparse
import os
import colorsys
from collections import deque
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage


def distinct_color(i: int) -> tuple:
    h = (i * 0.618034) % 1.0
    r, g, b = colorsys.hsv_to_rgb(h, 0.65, 1.0)
    return int(r * 255), int(g * 255), int(b * 255)


def bg_remove(img: Image.Image, tol: int):
    """Transparent-ify every pixel near the most common (modal) color — the flat
    background fills more of the sheet than any subject color. No floodfill: interior
    background-colored pixels go too (grouping reunites any fragments later)."""
    rgb = np.array(img.convert("RGB")).astype(int)
    packed = (rgb[:, :, 0] << 16) | (rgb[:, :, 1] << 8) | rgb[:, :, 2]
    vals, counts = np.unique(packed, return_counts=True)
    m = int(vals[counts.argmax()])
    bg = np.array([(m >> 16) & 255, (m >> 8) & 255, m & 255])
    dist = np.sqrt(((rgb - bg) ** 2).sum(2))
    solid = dist > tol
    rgba = np.dstack([rgb.astype(np.uint8), np.where(solid, 255, 0).astype(np.uint8)])
    return rgba, solid


def strip_grid(solid: np.ndarray, cols: int, rows: int, win: int = 8, cover: float = 0.85):
    """Remove drawn cell-grid lines before detection. At each expected cell boundary, clear
    any near-full-span line of solid pixels. Brightness-agnostic (a black or grey grid both
    read as 'solid' here) and geometry-anchored (only cell seams, never interiors). A full
    grid line covers ~all of a row/col; a subject that merely reaches a seam does not."""
    out = solid.copy()
    H, W = solid.shape
    for bx in [round(k * W / cols) for k in range(cols + 1)]:
        for x in range(max(0, bx - win), min(W, bx + win + 1)):
            if solid[:, x].mean() > cover:
                out[:, x] = False
    for by in [round(k * H / rows) for k in range(rows + 1)]:
        for y in range(max(0, by - win), min(H, by + win + 1)):
            if solid[y, :].mean() > cover:
                out[y, :] = False
    return out


def object_detect(solid: np.ndarray, min_object: int):
    # 8-connectivity so a 4-connected (UDLR) seam is guaranteed to separate a blob.
    labeled, n = ndimage.label(solid, structure=np.ones((3, 3), int))
    keep = []
    for i in range(1, n + 1):
        if (labeled == i).sum() >= min_object:
            keep.append(i)
    return labeled, keep


def _min_seam(mask, xlo, xhi, ylo, yhi, cx):
    """Cheapest path from the band's top-middle (ylo, cx) to its bottom-middle (yhi, cx),
    cost 1 per filled pixel (mask True), 0 through transparent, free to bow out to the
    xlo..xhi sides. Returns the whole path as (y, x). 0-1 BFS: transparent moves to the
    deque front, filled to the back. UDLR-only (4-connected) so a diagonal detour costs 2
    pixels; objects are labeled 8-connected so this cut still separates them."""
    H, W = mask.shape
    xlo, xhi = max(0, xlo), min(W - 1, xhi)
    ylo, yhi = max(0, ylo), min(H - 1, yhi)
    cx = min(max(cx, xlo), xhi)
    INF = 1 << 30
    dist = np.full((H, W), INF, np.int32)
    py = np.full((H, W), -2, np.int32)
    px = np.full((H, W), -2, np.int32)
    vis = np.zeros((H, W), bool)
    dq = deque()
    c = 1 if mask[ylo, cx] else 0        # single start: top-middle
    dist[ylo, cx] = c
    py[ylo, cx] = -1
    dq.appendleft((ylo, cx)) if c == 0 else dq.append((ylo, cx))
    nbs = [(-1, 0), (1, 0), (0, -1), (0, 1)]  # UDLR only; a diagonal detour costs 2
    end = None
    while dq:
        y, x = dq.popleft()
        if vis[y, x]:
            continue
        vis[y, x] = True
        if y == yhi and x == cx:         # single target: bottom-middle
            end = (y, x)
            break
        d = dist[y, x]
        for dy, dx in nbs:
            ny, nx = y + dy, x + dx
            if ny < ylo or ny > yhi or nx < xlo or nx > xhi or vis[ny, nx]:
                continue
            c = 1 if mask[ny, nx] else 0
            nd = d + c
            if nd < dist[ny, nx]:
                dist[ny, nx] = nd
                py[ny, nx], px[ny, nx] = y, x
                dq.appendleft((ny, nx)) if c == 0 else dq.append((ny, nx))
    path = []
    if end is None:
        return path
    y, x = end
    while y >= 0:
        path.append((y, x))
        ny, nx = py[y, x], px[y, x]
        if ny < 0:
            break
        y, x = ny, nx
    return path  # path[0] = end, path[-1] = start


def seam_delete_mask(labeled, keep, centers_xy, cols, rows, W, H, deadzone):
    """For each blob whose bbox holds 2+ expected sprite centers, cut it apart with a
    min-cost seam between each grid-adjacent pair (deleting the fewest filled pixels
    within the deadzone*2 band). Returns the pixels to delete."""
    cw, ch = W / cols, H / rows
    delete = np.zeros(labeled.shape, bool)
    seams = []  # debug records: {path, start, end, borders} in original (y,x)/(x,y) coords
    for i in keep:
        ys, xs = np.where(labeled == i)
        x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
        inside = [(cx, cy, int(cx // cw), int(cy // ch))
                  for (cx, cy) in centers_xy if x0 <= cx <= x1 and y0 <= cy <= y1]
        if len(inside) < 2:
            continue
        objmask = labeled == i
        for a in range(len(inside)):
            for b in range(a + 1, len(inside)):
                ax, ay, ac, ar = inside[a]
                bx, by, bc, br = inside[b]
                if abs(ac - bc) + abs(ar - br) != 1:
                    continue  # only cut between directly adjacent cells
                span = 3 * deadzone  # explore three deadzones to each side
                if ac != bc:  # horizontal neighbors -> vertical seam
                    bis = int(round((ax + bx) / 2))
                    lo, hi = bis - span, bis + span
                    path = _min_seam(objmask, lo, hi, y0, y1, bis)
                    borders = [((lo, y0), (lo, y1)), ((hi, y0), (hi, y1))]
                else:  # vertical neighbors -> horizontal seam (run on the transpose)
                    bis = int(round((ay + by) / 2))
                    lo, hi = bis - span, bis + span
                    path = [(bb, aa) for (aa, bb) in _min_seam(objmask.T, lo, hi, x0, x1, bis)]
                    borders = [((x0, lo), (x1, lo)), ((x0, hi), (x1, hi))]
                if not path:
                    continue
                for (yy, xx) in path:
                    if objmask[yy, xx]:
                        delete[yy, xx] = True
                seams.append({"path": path, "start": path[-1], "end": path[0],
                              "borders": borders})
    return delete, seams


def center_points(labeled, keep):
    """COM of each object, snapped to the object's nearest actual solid pixel."""
    out = {}
    for i in keep:
        ys, xs = np.where(labeled == i)
        cy, cx = ys.mean(), xs.mean()
        j = np.argmin((ys - cy) ** 2 + (xs - cx) ** 2)
        out[i] = (int(xs[j]), int(ys[j]))  # (x, y), guaranteed on the object
    return out


def group(centers, W, H, cols, rows, deadzone):
    cw, ch = W / cols, H / rows
    sprite_centers = {(r, c): ((c + 0.5) * cw, (r + 0.5) * ch)
                      for r in range(rows) for c in range(cols)}
    groups = {k: [] for k in sprite_centers}
    unassigned = []
    for obj, (cx, cy) in centers.items():
        c, r = int(cx // cw), int(cy // ch)
        c, r = min(c, cols - 1), min(r, rows - 1)
        sx, sy = sprite_centers[(r, c)]
        if abs(cx - sx) <= cw / 2 - deadzone and abs(cy - sy) <= ch / 2 - deadzone:
            groups[(r, c)].append(obj)
        else:
            unassigned.append(obj)
    return groups, unassigned, sprite_centers


def normalize_and_save(sprites, out_dir, fmt, quality, foot_threshold, pad=4):
    """Uniform per-sheet canvas + foot alignment, so every state of every enemy sits on
    a consistent baseline (ported from the old grid extractor). sprites: {name: rgba crop}."""
    bounds = {}
    for name, im in sprites.items():
        al = im[:, :, 3]
        rw = np.where(al.max(1) > 10)[0]
        cwv = np.where(al.max(0) > 10)[0]
        bounds[name] = None if len(rw) == 0 else {
            "top": rw[0], "bottom": rw[-1], "left": cwv[0], "right": cwv[-1],
            "h": rw[-1] - rw[0] + 1, "w": cwv[-1] - cwv[0] + 1}
    valid = [b for b in bounds.values() if b]
    cw = max(b["w"] for b in valid) + pad * 2
    ch = max(b["h"] for b in valid) + pad * 2

    norm = {}
    for name, im in sprites.items():
        canvas = np.zeros((ch, cw, 4), np.uint8)
        b = bounds[name]
        if b:
            content = im[b["top"]:b["bottom"] + 1, b["left"]:b["right"] + 1]
            px = (cw - b["w"]) // 2
            py = ch - pad - b["h"]
            canvas[py:py + b["h"], px:px + b["w"]] = content
        norm[name] = canvas

    def foot_row(al):
        h, w = al.shape
        need = w * foot_threshold
        for row in range(h - 1, -1, -1):
            if np.count_nonzero(al[row] > 10) >= need:
                return row
        return h - 1

    feet = {n: foot_row(v[:, :, 3]) for n, v in norm.items()}
    idle = [n for n in norm if n.endswith("-idle")]
    target = max(feet[n] for n in idle) if idle else max(feet.values())

    for name, v in norm.items():
        shift = target - feet[name]
        if shift > 0:
            s = np.zeros_like(v); s[shift:] = v[:ch - shift]; v = s
        elif shift < 0:
            s = np.zeros_like(v); s[:ch + shift] = v[-shift:]; v = s
        kw = {"quality": quality} if fmt == "webp" else {}
        Image.fromarray(v).save(os.path.join(out_dir, f"{name}.{fmt}"), fmt.upper(), **kw)


def boxes(labeled, groups):
    out = {}
    for key, objs in groups.items():
        if not objs:
            continue
        mask = np.isin(labeled, objs)
        ys, xs = np.where(mask)
        out[key] = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    return out


# ---- debug renderers ----------------------------------------------------------
def save_dbg(dbg, name, im):
    if dbg:
        im.convert("RGB").save(os.path.join(dbg, name))


def render_labels(labeled, keep, size):
    a = np.zeros((*size, 3), np.uint8)
    for idx, i in enumerate(keep):
        a[labeled == i] = distinct_color(idx)
    return Image.fromarray(a)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("sheet"); p.add_argument("out_dir")
    p.add_argument("--cols", type=int, default=4); p.add_argument("--rows", type=int, default=4)
    p.add_argument("--tol", type=int, default=40)
    p.add_argument("--deadzone", type=int, default=20)
    p.add_argument("--min-object", type=int, default=40)
    p.add_argument("--names", default=None,
                   help="comma-separated column names; enables named+aligned game output")
    p.add_argument("--states", default="idle,attack,hit,move", help="comma-separated row states")
    p.add_argument("--format", default="png", choices=["png", "webp"])
    p.add_argument("--quality", type=int, default=90)
    p.add_argument("--foot-threshold", type=float, default=0.05)
    p.add_argument("--debug-dir", default=None)
    a = p.parse_args()

    names = a.names.split(",") if a.names else None
    states = a.states.split(",")
    if names and len(names) != a.cols:
        raise SystemExit(f"{len(names)} names but {a.cols} cols")
    if names and len(states) != a.rows:
        raise SystemExit(f"{len(states)} states but {a.rows} rows")

    dbg = a.debug_dir
    if dbg:
        os.makedirs(dbg, exist_ok=True)
    os.makedirs(a.out_dir, exist_ok=True)

    src = Image.open(a.sheet).convert("RGB")
    W, H = src.size

    # 1. bg_remove (+ strip any drawn cell-grid lines)
    rgba, solid = bg_remove(src, a.tol)
    solid = strip_grid(solid, a.cols, a.rows)
    rgba[~solid, 3] = 0
    checker = Image.new("RGB", (W, H), (255, 0, 255))
    checker.paste(Image.fromarray(rgba), (0, 0), Image.fromarray(rgba))
    save_dbg(dbg, "1_bg_removed.png", checker)

    # 2. object_detect (+ seam-cut blobs that straddle two sprite centers)
    labeled, keep = object_detect(solid, a.min_object)
    cw, ch = W / a.cols, H / a.rows
    centers_xy = [((c + 0.5) * cw, (r + 0.5) * ch) for r in range(a.rows) for c in range(a.cols)]
    del_mask, seams = seam_delete_mask(labeled, keep, centers_xy, a.cols, a.rows, W, H, a.deadzone)
    if dbg:
        simg = np.zeros((H, W, 3), np.uint8)
        simg[solid] = (70, 70, 80)
        simg[del_mask] = (255, 0, 0)
        save_dbg(dbg, "2b_seams.png", Image.fromarray(simg))
        # 2c: the chosen path, its start/end, and the borders it can't cross.
        base = np.zeros((H, W, 3), np.uint8)
        base[solid] = (55, 55, 65)
        for s in seams:
            for (yy, xx) in s["path"]:
                base[yy, xx] = (255, 255, 0)          # path (incl. cost-0 transparent steps)
        base[del_mask] = (255, 90, 0)                  # deleted filled pixels (cost paid)
        im2c = Image.fromarray(base)
        d2c = ImageDraw.Draw(im2c)
        for s in seams:
            for (p0, p1) in s["borders"]:
                d2c.line([p0[0], p0[1], p1[0], p1[1]], fill=(0, 200, 255), width=1)  # no-cross borders
            (sy, sx), (ey, ex) = s["start"], s["end"]
            d2c.ellipse([sx - 5, sy - 5, sx + 5, sy + 5], fill=(0, 255, 0), outline=(0, 0, 0))   # start
            d2c.ellipse([ex - 5, ey - 5, ex + 5, ey + 5], fill=(255, 0, 0), outline=(0, 0, 0))   # end
        save_dbg(dbg, "2c_seam_path.png", im2c)
    if del_mask.any():
        solid = solid & ~del_mask
        rgba[del_mask, 3] = 0
        labeled, keep = object_detect(solid, a.min_object)
    save_dbg(dbg, "2_objects.png", render_labels(labeled, keep, (H, W)))

    # 3. center_point
    centers = center_points(labeled, keep)
    im3 = render_labels(labeled, keep, (H, W)); d3 = ImageDraw.Draw(im3)
    for (cx, cy) in centers.values():
        d3.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], fill=(255, 255, 255), outline=(0, 0, 0))
    save_dbg(dbg, "3_centers.png", im3)

    # 4. group
    groups, unassigned, sc = group(centers, W, H, a.cols, a.rows, a.deadzone)
    cw, ch = W / a.cols, H / a.rows
    arr = np.full((H, W, 3), (20, 20, 25), np.uint8)
    for gi, key in enumerate(groups):
        for o in groups[key]:
            arr[labeled == o] = distinct_color(gi)
    for o in unassigned:
        arr[labeled == o] = (90, 90, 90)
    im4 = Image.fromarray(arr); d4 = ImageDraw.Draw(im4)
    for (r, c), (sx, sy) in sc.items():
        hw, hh = cw / 2 - a.deadzone, ch / 2 - a.deadzone
        d4.rectangle([sx - hw, sy - hh, sx + hw, sy + hh], outline=(255, 255, 255))
        d4.line([sx - 6, sy, sx + 6, sy], fill=(255, 0, 0), width=2)
        d4.line([sx, sy - 6, sx, sy + 6], fill=(255, 0, 0), width=2)
    save_dbg(dbg, "4_grouping.png", im4)

    # 5. boxes
    bxs = boxes(labeled, groups)
    im5 = src.copy(); d5 = ImageDraw.Draw(im5)
    for (x0, y0, x1, y1) in bxs.values():
        d5.rectangle([x0, y0, x1 - 1, y1 - 1], outline=(255, 0, 0), width=3)
    save_dbg(dbg, "5_boxes.png", im5)

    # 6. save — keep ONLY this sprite's grouped-object pixels (rest transparent), so
    # overlapping boxes don't duplicate a neighbor's content (e.g. shared fire).
    sprites = {}
    for (r, c), (x0, y0, x1, y1) in bxs.items():
        mask = np.isin(labeled, groups[(r, c)])
        sp = rgba.copy()
        sp[~mask, 3] = 0
        name = f"{names[c]}-{states[r]}" if names else f"sprite-r{r}-c{c}"
        sprites[name] = sp[y0:y1, x0:x1]
    if names:
        normalize_and_save(sprites, a.out_dir, a.format, a.quality, a.foot_threshold)
    else:
        for name, im in sprites.items():
            Image.fromarray(im).save(os.path.join(a.out_dir, f"{name}.png"))
    print(f"{a.sheet}: {len(keep)} objects, {len(bxs)}/{a.cols*a.rows} sprites, {len(unassigned)} unassigned")


if __name__ == "__main__":
    main()
