
import sys, json
import numpy as np
from PIL import Image

img = Image.open(sys.argv[1]).convert("RGB")
arr = np.array(img)
h, w = arr.shape[:2]

# Sample corners (same as scripts/process-spritesheet.py)
corners = np.concatenate([
    arr[0:20, 0:20].reshape(-1, 3),
    arr[0:20, w-20:w].reshape(-1, 3),
    arr[h-20:h, 0:20].reshape(-1, 3),
    arr[h-20:h, w-20:w].reshape(-1, 3),
])
bg_color = np.median(corners, axis=0)
bg_std = np.std(corners, axis=0)

# Distance from bg color for every pixel
diff = np.sqrt(np.sum((arr.astype(float) - bg_color) ** 2, axis=2))

threshold = 30
alpha = np.clip((diff - threshold) * (255 / 30), 0, 255).astype(np.uint8)

total = alpha.size
fully_transparent = int(np.sum(alpha == 0))
fully_opaque = int(np.sum(alpha == 255))
partial = total - fully_transparent - fully_opaque

# Save the alpha channel as a preview
alpha_img = Image.fromarray(alpha, "L")
alpha_img.save(sys.argv[1].replace(".png", "-alpha.png"))

# Save the RGBA result
rgba = np.dstack([arr, alpha])
Image.fromarray(rgba, "RGBA").save(sys.argv[1].replace(".png", "-removed.png"))

result = {
    "bg_color": bg_color.tolist(),
    "bg_std": bg_std.tolist(),
    "bg_uniformity": float(np.mean(bg_std)),
    "total_pixels": total,
    "fully_transparent_pct": round(100 * fully_transparent / total, 1),
    "fully_opaque_pct": round(100 * fully_opaque / total, 1),
    "partial_alpha_pct": round(100 * partial / total, 1),
}
print(json.dumps(result))
