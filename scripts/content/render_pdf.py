"""
Render PDF pages to PNG (for OCR) and a small cover thumbnail.

Usage: python render_pdf.py <input.pdf> <out_dir> [dpi]
Writes out_dir/pages/p001.png ... and out_dir/cover.webp, prints {"pages": n}.
"""
import json
import os
import sys

import pymupdf
from PIL import Image


def main():
    src, out_dir = sys.argv[1], sys.argv[2]
    dpi = int(sys.argv[3]) if len(sys.argv) > 3 else 200
    pages_dir = os.path.join(out_dir, "pages")
    os.makedirs(pages_dir, exist_ok=True)
    doc = pymupdf.open(src)
    for i, page in enumerate(doc):
        out = os.path.join(pages_dir, f"p{i + 1:03d}.png")
        if not os.path.exists(out):
            page.get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY).save(out)
    cover = doc[0].get_pixmap(dpi=60)
    im = Image.frombytes("RGB", (cover.width, cover.height), cover.samples)
    im.save(os.path.join(out_dir, "cover.webp"), "WEBP", quality=70)
    print(json.dumps({"pages": doc.page_count}))


if __name__ == "__main__":
    main()
