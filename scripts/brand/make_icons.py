"""
Build the favicon and the app (home-screen) icons from the MBC logo.

    python scripts/brand/make_icons.py

Reads src/assets/mbc-logo.svg and writes the favicon and PNG icons into public/icons.
Browsers and installed apps keep icons for a long time, so a new design needs new file names:
change NAME below (and the names in index.html and vite.config.ts) whenever the icons change.
The logo is drawn in white on the app's dark navy. The small GROUP line is left out of the favicon,
where it would be unreadable.
Needs PyMuPDF (to draw the SVG) and Pillow.
"""
import io
import re
from pathlib import Path

import pymupdf
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
LOGO = (ROOT / 'src' / 'assets' / 'mbc-logo.svg').read_text(encoding='utf-8')
BG_TOP, BG_BOTTOM = '#17213b', '#070b16'  # app surface → app background
NAME = 'mbc'  # file-name prefix; see the note at the top


def group(name: str) -> str:
    m = re.search(rf'<g id="{name}">(.*?)</g>', LOGO, re.S)
    assert m, f'logo group {name!r} missing'
    return m.group(1)


def icon_svg(size: int, logo_width: float, radius: float, full: bool) -> str:
    """A square icon: navy background, white logo centred. logo_width and radius are fractions of size."""
    height = 106 if full else 88
    scale = size * logo_width / 252
    x, y = (size - 252 * scale) / 2, (size - height * scale) / 2
    paths = group('mark') + (group('group') if full else '')
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">'
        f'<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0" stop-color="{BG_TOP}"/><stop offset="1" stop-color="{BG_BOTTOM}"/></linearGradient></defs>'
        f'<rect width="{size}" height="{size}" rx="{size * radius:g}" fill="url(#bg)"/>'
        f'<g transform="translate({x:.3f} {y:.3f}) scale({scale:.5f})" fill="#ffffff">{paths}</g>'
        '</svg>'
    )


def hex_rgb(h: str) -> tuple[int, int, int]:
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def png(size: int, logo_width: float, radius: float, out: Path, opaque: bool, full: bool = True) -> None:
    """PNG icon. PyMuPDF can't paint SVG gradients, so Pillow draws the background and PyMuPDF only the logo."""
    big = size * 4  # work at 4x and scale down for smooth edges
    top, bottom = hex_rgb(BG_TOP), hex_rgb(BG_BOTTOM)
    bg = Image.new('RGBA', (big, big))
    for y in range(big):
        t = y / (big - 1)
        bg.paste(tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)) + (255,), (0, y, big, y + 1))
    if radius:
        mask = Image.new('L', (big, big), 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, big - 1, big - 1), radius=big * radius, fill=255)
        bg.putalpha(mask)
    # the logo alone, white on transparent, at its final position
    logo = icon_svg(size, logo_width, radius, full=full).replace('fill="url(#bg)"', 'fill="none"')
    pix = pymupdf.open(stream=logo.encode(), filetype='svg')[0].get_pixmap(matrix=pymupdf.Matrix(4, 4), alpha=True)
    bg.alpha_composite(Image.open(io.BytesIO(pix.tobytes('png'))).convert('RGBA'))
    im = bg.resize((size, size), Image.LANCZOS)
    if opaque:
        im = im.convert('RGB')
    im.save(out, optimize=True)
    print(f'  {out.relative_to(ROOT).as_posix()}  {size}x{size}')


def main() -> None:
    icons = ROOT / 'public' / 'icons'
    fav = icon_svg(64, 0.86, 0.22, full=False)
    icons.mkdir(parents=True, exist_ok=True)
    (icons / f'{NAME}-favicon.svg').write_text(fav + '\n', encoding='utf-8', newline='\n')
    print(f'  public/icons/{NAME}-favicon.svg')
    png(32, 0.86, 0.22, icons / f'{NAME}-favicon-32.png', opaque=False, full=False)
    # "any" icons keep their own rounded corners; maskable and Apple icons are full-bleed (the system shapes them)
    png(192, 0.74, 0.2, icons / f'{NAME}-192.png', opaque=False)
    png(512, 0.74, 0.2, icons / f'{NAME}-512.png', opaque=False)
    png(512, 0.6, 0, icons / f'{NAME}-maskable-512.png', opaque=True)
    png(180, 0.7, 0, icons / f'{NAME}-apple-touch-180.png', opaque=True)


if __name__ == '__main__':
    main()
