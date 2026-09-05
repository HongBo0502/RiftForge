"""
make-icons — generate the PWA icon set.

    python scripts/make-icons.py

Draws the Riftforge sigil (a rift diamond) at the sizes a web app manifest
needs, so installing to a phone home screen shows a real icon. Regenerate if
the mark changes; the output is committed.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"

INK = (10, 13, 19, 255)
ACCENT = (78, 163, 255, 255)
ACCENT_DIM = (78, 163, 255, 70)

# name, size, padding as a fraction of the canvas.
# Maskable icons need generous padding: launchers crop to a circle, and the
# safe zone is the middle 80%.
TARGETS = [
    ("icon-192.png", 192, 0.14),
    ("icon-512.png", 512, 0.14),
    ("icon-maskable-512.png", 512, 0.26),
    ("apple-touch-icon.png", 180, 0.16),
]


def diamond(cx: float, cy: float, r: float) -> list[tuple[float, float]]:
    return [(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)]


def draw_icon(size: int, padding: float) -> Image.Image:
    # Supersample, then downscale, so the diagonals come out smooth.
    scale = 4
    s = size * scale
    img = Image.new("RGBA", (s, s), INK)
    d = ImageDraw.Draw(img)

    cx = cy = s / 2
    outer = (s / 2) * (1 - padding * 2)
    stroke = max(2, int(s * 0.035))

    d.polygon(diamond(cx, cy, outer), fill=ACCENT_DIM)
    d.line([*diamond(cx, cy, outer), diamond(cx, cy, outer)[0]], fill=ACCENT, width=stroke, joint="curve")
    d.polygon(diamond(cx, cy, outer * 0.45), fill=ACCENT)

    return img.resize((size, size), Image.LANCZOS)


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size, padding in TARGETS:
        path = OUT / name
        draw_icon(size, padding).save(path, "PNG", optimize=True)
        print(f"  {name}  {size}x{size}  {path.stat().st_size / 1024:.1f} KB")
    print(f"wrote {len(TARGETS)} icons to public/icons/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
