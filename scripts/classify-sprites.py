#!/usr/bin/env python3
"""Classify extracted sprites good/bad. Bad = a solid pixel touches the image edge
(a properly-cropped sprite has transparent padding all around).

Usage: python3 scripts/classify-sprites.py [dirs...] [--alpha 128] [--edge 1]
Defaults to every dimension's enemy + item sprite directory.
"""
import argparse
import glob
import os
import numpy as np
from PIL import Image


def touches_edge(path: str, alpha: int, edge: int) -> bool:
    a = np.array(Image.open(path).convert("RGBA"))[:, :, 3]
    return bool(
        (a[:edge] >= alpha).any() or (a[-edge:] >= alpha).any()
        or (a[:, :edge] >= alpha).any() or (a[:, -edge:] >= alpha).any()
    )


def main():
    p = argparse.ArgumentParser()
    p.add_argument("dirs", nargs="*")
    p.add_argument("--alpha", type=int, default=128, help="min alpha to count a pixel as solid")
    p.add_argument("--edge", type=int, default=1, help="edge band width in px")
    args = p.parse_args()

    dirs = args.dirs or sorted(
        glob.glob("server/sprites/enemies/dimension-*")
        + glob.glob("client/public/sprites/items/dimension-*")
    )

    total_bad = total = 0
    for d in dirs:
        files = sorted(glob.glob(os.path.join(d, "*.png")))
        if not files:
            continue
        bad = [os.path.basename(f) for f in files if touches_edge(f, args.alpha, args.edge)]
        total += len(files)
        total_bad += len(bad)
        print(f"{d}: {len(bad)}/{len(files)} bad")
        for b in bad:
            print(f"    {b}")

    print(f"\nTOTAL: {total_bad}/{total} bad ({100*total_bad//max(1,total)}%)")


if __name__ == "__main__":
    main()
