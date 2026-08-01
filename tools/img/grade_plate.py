"""Grade a satellite plate into the site's storm-blue world.

Additive tooling, in `tools/` — repo-root Python is read-only.

WHY A DUOTONE AND NOT A TINT. The source is a true-colour MODIS frame: green
boreal forest, brown sediment, near-black water. Dropped onto the page as-is it
brings a second colour world with it and the page stops being one thing, which
is the failure the whole visual rebuild is correcting. Mapping luminance onto a
two-point ramp between the palette's own shadow and highlight throws the source
hues away and keeps only the *structure* — the coastline, the lake stipple, the
river plumes — which is the part that carries meaning.

The output is deliberately dark. This sits behind body copy at 11-15px, so the
highlight end is capped well below the ink colour; a plate that competes with
the type is a plate that has to come off the page later.

Usage:
    python -m tools.img.grade_plate <source.jpg> <out-basename> [--width 2000]
"""
from __future__ import annotations

import argparse
import pathlib
import sys

try:
    from PIL import Image, ImageEnhance
except ImportError:  # pragma: no cover - environment guard
    sys.exit('Pillow is required: python -m pip install Pillow')

# Both ends come from web/src/theme/palette.ts and must stay in step with it.
# The rule everywhere else on this site is that no hex is written outside that
# module; this is a build tool rather than shipped source, so the values are
# repeated here with the same obligation attached.
SHADOW = (0x07, 0x0E, 0x24)   # PALETTE.canvas
HIGHLIGHT = (0x3A, 0x52, 0x9E)  # a step above PALETTE.surfaceRaised

#: Cap on the highlight end, 0..1. Above roughly this the plate starts to
#: compete with 11px mono set in PALETTE.ink on top of it.
CEILING = 0.62


def duotone(im: Image.Image,
            shadow: tuple[int, int, int] = SHADOW,
            highlight: tuple[int, int, int] = HIGHLIGHT,
            ceiling: float = CEILING) -> Image.Image:
    """Map luminance onto a two-point ramp, discarding the source hues."""
    grey = im.convert('L')
    # A little contrast first: MODIS over boreal forest is a narrow, muddy
    # histogram, and the coastline is the thing worth keeping.
    grey = ImageEnhance.Contrast(grey).enhance(1.35)
    lut: list[int] = []
    for channel in range(3):
        lo, hi = shadow[channel], highlight[channel]
        for i in range(256):
            t = (i / 255.0) * ceiling
            lut.append(round(lo + (hi - lo) * t))
    return Image.merge('RGB', (grey, grey, grey)).point(lut)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('source')
    ap.add_argument('out', help='output basename, without extension')
    ap.add_argument('--width', type=int, default=2000)
    ap.add_argument('--ceiling', type=float, default=CEILING)
    args = ap.parse_args()

    im = Image.open(args.source).convert('RGB')
    h = round(im.height * args.width / im.width)
    im = im.resize((args.width, h), Image.LANCZOS)
    out = duotone(im, ceiling=args.ceiling)

    base = pathlib.Path(args.out)
    base.parent.mkdir(parents=True, exist_ok=True)
    jpg = base.with_suffix('.jpg')
    webp = base.with_suffix('.webp')
    out.save(jpg, 'JPEG', quality=78, optimize=True, progressive=True)
    out.save(webp, 'WEBP', quality=76, method=6)

    for p in (jpg, webp):
        kb = p.stat().st_size / 1024
        flag = '' if kb < 400 else '  OVER THE 400 KB BUDGET'
        print(f'{p}  {im.width}x{im.height}  {kb:.0f} KB{flag}')


if __name__ == '__main__':
    main()
