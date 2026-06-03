#!/usr/bin/env python3
"""Collision-mask extraction from gpt-image-2 red-detection passes.

Single source of truth for the mask pipeline: red threshold, morphological
cleanup (kernel scales with resolution so full-res and downscaled runs behave
identically), majority merge across passes, speck removal, and upscale to the
map's resolution.

Subcommands:
  downscale <in.png> <out.png> <W> <H>
      Lanczos-downscale a map so detection runs on fewer pixels (cheaper, and
      the model segments the coarser image more consistently).

  extract --inputs a.png [b.png ...] --out mask.png --out-size WxH [--vote N]
      Clean each red pass, majority-merge (default floor(N/2)+1), upscale the
      binary mask to WxH (nearest), and write white=collision / black=walkable.
"""
import argparse
import numpy as np
from PIL import Image
from scipy import ndimage


def red_mask(path):
    """Threshold 'solid red' pixels, then close + fill so a partially-shaded
    red object becomes a solid blob. Kernel scales with image resolution."""
    a = np.asarray(Image.open(path).convert("RGB")).astype(int)
    r, g, b = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    raw = (r > 120) & (r - g > 50) & (r - b > 50)
    h, w = raw.shape
    k = max(3, round(min(h, w) / 150))          # ~7 at 1088, ~5 at 768
    if k % 2 == 0:
        k += 1
    m = ndimage.binary_closing(raw, structure=np.ones((k, k)), iterations=2)
    m = ndimage.binary_fill_holes(m)
    return m


def drop_specks(mask, min_frac=1e-4):
    lbl, n = ndimage.label(mask)
    if n == 0:
        return mask
    sizes = ndimage.sum(np.ones_like(lbl), lbl, range(1, n + 1))
    min_area = max(20, int(mask.size * min_frac))
    return np.isin(lbl, 1 + np.where(sizes >= min_area)[0])


def cmd_downscale(a):
    Image.open(a.inp).convert("RGB").resize((a.W, a.H), Image.LANCZOS).save(a.out)
    print(f"downscale: {a.inp} -> {a.out} ({a.W}x{a.H})")


def cmd_extract(a):
    masks = [red_mask(p) for p in a.inputs]
    base = masks[0].shape
    masks = [m for m in masks if m.shape == base]   # all passes share a size
    votes = np.sum(masks, axis=0)
    need = a.vote if a.vote else (len(masks) // 2 + 1)
    merged = ndimage.binary_fill_holes(votes >= need)
    merged = drop_specks(merged)
    if a.out_size:
        W, H = (int(v) for v in a.out_size.lower().split("x"))
        merged = np.asarray(
            Image.fromarray((merged * 255).astype("uint8")).resize((W, H), Image.NEAREST)
        ) > 127
    Image.fromarray((merged * 255).astype("uint8")).save(a.out)
    print(f"extract: {len(masks)} passes, vote>={need}, "
          f"coverage {merged.mean() * 100:.1f}% -> {a.out}")


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(required=True)

    d = sub.add_parser("downscale")
    d.add_argument("inp")
    d.add_argument("out")
    d.add_argument("W", type=int)
    d.add_argument("H", type=int)
    d.set_defaults(func=cmd_downscale)

    e = sub.add_parser("extract")
    e.add_argument("--inputs", nargs="+", required=True)
    e.add_argument("--out", required=True)
    e.add_argument("--out-size", default=None, help="WxH to upscale the mask to")
    e.add_argument("--vote", type=int, default=0, help="min passes to count as collision (default majority)")
    e.set_defaults(func=cmd_extract)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
