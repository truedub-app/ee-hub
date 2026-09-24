"""
Convert a Word (.docx) procedure document into structured JSON blocks + web images.

Usage:
    python extract_docx.py <input.docx> <out_dir> [--split-modules] [--blur image156,image158]

Output (in out_dir):
    doc.json      {"title", "sections": [{"id", "title", "blocks": [...]}], "stats"}
    img/*.webp    embedded images converted to WebP (EMF/WMF rasterised via Pillow on Windows)

Block shapes (consumed by the app's DocBlocks renderer):
    {"t": "h", "level": 1|2|3, "text": str}
    {"t": "p", "runs": [{"x": str, "b"?: 1, "i"?: 1, "u"?: 1, "alert"?: 1}]}
    {"t": "li", "runs": [...], "level": int, "list": int, "ordered": bool}
    {"t": "note", "text": str}                      # Word "Intense Quote" call-outs
    {"t": "img", "src": "img/xxx.webp", "w": int, "h": int}
    {"t": "table", "rows": [[str, ...], ...]}

Credentials found in the source (passwords, user names, host IPs, logins) are redacted.
"""
import io
import json
import os
import re
import sys
import zipfile

from docx import Document
from docx.oxml.ns import qn
from PIL import Image, ImageDraw, ImageFilter, ImageFont

MAX_W = 1600
WEBP_Q = 78

NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main"
NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_V = "urn:schemas-microsoft-com:vml"
NS_MC = "http://schemas.openxmlformats.org/markup-compatibility/2006"

REDACTIONS = [
    # Credential labels must be followed by a colon, so prose such as "your user name and password" survives.
    (re.compile(r"(Password\s*:\s*)(\S.*)", re.I), r"\1[redacted — ask your supervisor]"),
    (re.compile(r"(User\s*Name\s*:\s*)(\S.*)", re.I), r"\1[redacted — ask your supervisor]"),
    (re.compile(r"(Host\s*Address\s*:\s*)(\S.*)", re.I), r"\1[redacted — ask your supervisor]"),
    (re.compile(r"^(\s*Login\s*:\s*)(\S.*)", re.I), r"\1[redacted — ask your supervisor]"),
    (re.compile(r"^(\s*Server\s*:\s*)(\S.*)", re.I), r"\1[redacted]"),
    (re.compile(r"^(\s*Port\s*:\s*)(\d+.*)", re.I), r"\1[redacted]"),
    # IPv4 with real octets (no leading zeros) so timecodes such as 10.00.00.00 are left alone
    (re.compile(r"\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b"), "[redacted IP]"),
]


def redact(text: str) -> tuple[str, bool]:
    out = text
    for rx, repl in REDACTIONS:
        out = rx.sub(repl, out)
    return out, out != text


def slug(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s[:60] or "section"


def clean(s: str) -> str:
    s = s.replace(" ", " ").replace("�", "–")
    s = re.sub(r"[ \t]+", " ", s)
    return s


class Extractor:
    def __init__(self, path: str, out_dir: str, blur: set[str] | None = None):
        self.blur = blur or set()
        self.path = path
        self.out_dir = out_dir
        self.doc = Document(path)
        self.zip = zipfile.ZipFile(path)
        self.part = self.doc.part
        self.img_dir = os.path.join(out_dir, "img")
        os.makedirs(self.img_dir, exist_ok=True)
        self.img_cache: dict[str, dict] = {}
        self.redacted = 0
        self.num_fmt = self._load_numbering()

    # ---- numbering: numId -> ordered? -------------------------------------------------
    def _load_numbering(self) -> dict[str, bool]:
        fmt: dict[str, bool] = {}
        try:
            numbering = self.part.numbering_part.element
        except Exception:
            return fmt
        abstract: dict[str, bool] = {}
        for an in numbering.findall(qn("w:abstractNum")):
            aid = an.get(qn("w:abstractNumId"))
            lvl0 = an.find(qn("w:lvl"))
            ordered = False
            if lvl0 is not None:
                nf = lvl0.find(qn("w:numFmt"))
                if nf is not None and nf.get(qn("w:val")) not in ("bullet", "none"):
                    ordered = True
            abstract[aid] = ordered
        for num in numbering.findall(qn("w:num")):
            nid = num.get(qn("w:numId"))
            an = num.find(qn("w:abstractNumId"))
            if an is not None:
                fmt[nid] = abstract.get(an.get(qn("w:val")), False)
        return fmt

    # ---- images ---------------------------------------------------------------------
    def image(self, rid: str) -> dict | None:
        if rid in self.img_cache:
            return self.img_cache[rid]
        rel = self.part.rels.get(rid)
        if rel is None or "image" not in rel.reltype:
            return None
        target = rel.target_part.partname.lstrip("/")
        data = rel.target_part.blob
        name = os.path.splitext(os.path.basename(target))[0]
        out = os.path.join(self.img_dir, name + ".webp")
        try:
            if not os.path.exists(out):
                im = Image.open(io.BytesIO(data))
                im.load()
                if im.mode in ("P", "LA", "RGBA"):
                    bg = Image.new("RGB", im.size, (255, 255, 255))
                    rgba = im.convert("RGBA")
                    bg.paste(rgba, mask=rgba.split()[3])
                    im = bg
                elif im.mode != "RGB":
                    im = im.convert("RGB")
                if im.width > MAX_W:
                    im = im.resize((MAX_W, round(im.height * MAX_W / im.width)), Image.LANCZOS)
                if name in self.blur:
                    im = redact_image(im)
                im.save(out, "WEBP", quality=WEBP_Q, method=6)
            with Image.open(out) as im2:
                w, h = im2.size
        except Exception as e:  # unreadable image: skip but keep going
            print(f"  ! image {target}: {e}", file=sys.stderr)
            self.img_cache[rid] = None
            return None
        info = {"t": "img", "src": f"img/{name}.webp", "w": w, "h": h}
        self.img_cache[rid] = info
        return info

    def images_in(self, el) -> list[dict]:
        found = []
        for node in el.iter():
            tag = node.tag
            if tag in (f"{{{NS_A}}}blip", f"{{{NS_V}}}imagedata") and in_fallback(node):
                continue  # skip duplicate copies inside mc:AlternateContent/mc:Fallback
            if tag == f"{{{NS_A}}}blip":
                rid = node.get(f"{{{NS_R}}}embed")
            elif tag == f"{{{NS_V}}}imagedata":
                rid = node.get(f"{{{NS_R}}}id")
            else:
                continue
            if rid:
                info = self.image(rid)
                if info:
                    found.append(info)
        return found

    # ---- text runs ------------------------------------------------------------------
    def runs(self, p_el) -> list[dict]:
        runs: list[dict] = []
        for r in p_el.iter(qn("w:r")):
            if in_fallback(r):
                continue
            text = ""
            for child in r:
                if child.tag == qn("w:t"):
                    text += child.text or ""
                elif child.tag == qn("w:tab"):
                    text += "  "
                elif child.tag in (qn("w:br"), qn("w:cr")):
                    text += "\n"
            if not text:
                continue
            rpr = r.find(qn("w:rPr"))
            run = {"x": clean(text)}
            if rpr is not None:
                b = rpr.find(qn("w:b"))
                if b is not None and b.get(qn("w:val")) not in ("0", "false"):
                    run["b"] = 1
                i = rpr.find(qn("w:i"))
                if i is not None and i.get(qn("w:val")) not in ("0", "false"):
                    run["i"] = 1
                u = rpr.find(qn("w:u"))
                if u is not None and u.get(qn("w:val")) not in ("none", None):
                    run["u"] = 1
                c = rpr.find(qn("w:color"))
                if c is not None and (c.get(qn("w:val")) or "").upper() in ("FF0000", "C00000", "E00000", "EE0000"):
                    run["alert"] = 1
            # merge with previous run when formatting matches
            if runs and {k: v for k, v in runs[-1].items() if k != "x"} == {k: v for k, v in run.items() if k != "x"}:
                runs[-1]["x"] += run["x"]
            else:
                runs.append(run)
        # Redact on the whole paragraph: labels and values are often split across runs.
        full = "".join(r["x"] for r in runs)
        new, changed = redact(full)
        if changed:
            self.redacted += 1
            return [{"x": new}]
        return runs

    # ---- body walk ------------------------------------------------------------------
    def blocks(self) -> list[dict]:
        out: list[dict] = []
        body = self.doc.element.body
        styles = {s.style_id: s.name for s in self.doc.styles if hasattr(s, "style_id")}
        for el in body.iterchildren():
            if el.tag == qn("w:p"):
                ppr = el.find(qn("w:pPr"))
                style_id = None
                num_id = None
                ilvl = 0
                if ppr is not None:
                    ps = ppr.find(qn("w:pStyle"))
                    if ps is not None:
                        style_id = ps.get(qn("w:val"))
                    npr = ppr.find(qn("w:numPr"))
                    if npr is not None:
                        ni = npr.find(qn("w:numId"))
                        il = npr.find(qn("w:ilvl"))
                        num_id = ni.get(qn("w:val")) if ni is not None else None
                        ilvl = int(il.get(qn("w:val"))) if il is not None else 0
                style = styles.get(style_id, "Normal") if style_id else "Normal"
                runs = self.runs(el)
                text = "".join(r["x"] for r in runs).strip()
                imgs = self.images_in(el)
                m = re.match(r"Heading (\d)", style)
                if m and text:
                    out.append({"t": "h", "level": int(m.group(1)), "text": text})
                elif style == "Intense Quote" and text:
                    out.append({"t": "note", "text": text})
                elif text:
                    if num_id and num_id != "0":
                        out.append({
                            "t": "li", "runs": runs, "level": ilvl,
                            "list": int(num_id), "ordered": self.num_fmt.get(num_id, False),
                        })
                    else:
                        out.append({"t": "p", "runs": runs})
                out.extend(imgs)
            elif el.tag == qn("w:tbl"):
                rows = []
                for tr in el.iter(qn("w:tr")):
                    cells = []
                    for tc in tr.findall(qn("w:tc")):
                        ps = [clean("".join(t.text or "" for t in p.iter(qn("w:t")))).strip() for p in tc.iter(qn("w:p"))]
                        cell = "\n".join(x for x in ps if x)
                        cell, changed = redact(cell)
                        self.redacted += int(changed)
                        cells.append(cell)
                    if any(cells):
                        rows.append(cells)
                if rows:
                    out.append({"t": "table", "rows": rows})
                out.extend(self.images_in(el))
        return out


def in_fallback(node) -> bool:
    p = node.getparent()
    while p is not None:
        if p.tag == f"{{{NS_MC}}}Fallback":
            return True
        p = p.getparent()
    return False


def redact_image(im: Image.Image) -> Image.Image:
    """Blur a screenshot that shows access details and stamp it as redacted."""
    im = im.filter(ImageFilter.GaussianBlur(radius=max(10, im.width // 60)))
    draw = ImageDraw.Draw(im)
    label = "Redacted: contains access details. Ask your supervisor."
    size = max(16, im.width // 32)
    try:
        font = ImageFont.load_default(size=size)
    except TypeError:
        font = ImageFont.load_default()
    box = draw.textbbox((0, 0), label, font=font)
    tw, th = box[2] - box[0], box[3] - box[1]
    x, y = (im.width - tw) // 2, (im.height - th) // 2
    pad = size // 2
    draw.rectangle((x - pad, y - pad, x + tw + pad, y + th + pad), fill=(20, 24, 38))
    draw.text((x, y - box[1]), label, fill=(255, 196, 0), font=font)
    return im


MODULE_RX = re.compile(r"^Module\s*(\d+)\s*[-–—:]?\s*(.*)$", re.I)


def split_sections(blocks: list[dict]) -> list[dict]:
    """Split on 'Module N' headings (any level). Leading content becomes 'Introduction'."""
    sections: list[dict] = []
    current = {"id": "introduction", "title": "Introduction", "number": 0, "blocks": []}
    for b in blocks:
        if b["t"] == "h":
            m = MODULE_RX.match(b["text"])
            top_level_extra = b["level"] == 1 and b["text"].lower().startswith("department update")
            if m or top_level_extra:
                if current["blocks"]:
                    sections.append(current)
                if m:
                    num = int(m.group(1))
                    title = m.group(2).strip(" -–—") or b["text"]
                else:
                    num = (sections[-1]["number"] + 1) if sections else 1
                    title = b["text"]
                current = {"id": f"m{num:02d}-{slug(title)}", "title": title, "number": num, "blocks": []}
                continue
        current["blocks"].append(b)
    if current["blocks"]:
        sections.append(current)
    return sections


def main():
    src, out_dir = sys.argv[1], sys.argv[2]
    split = "--split-modules" in sys.argv
    blur: set[str] = set()
    if "--blur" in sys.argv:
        blur = {x.strip() for x in sys.argv[sys.argv.index("--blur") + 1].split(",") if x.strip()}
    os.makedirs(out_dir, exist_ok=True)
    ex = Extractor(src, out_dir, blur)
    blocks = ex.blocks()
    if split:
        sections = split_sections(blocks)
    else:
        sections = [{"id": "main", "title": "", "number": 0, "blocks": blocks}]
    title = (ex.doc.core_properties.title or os.path.splitext(os.path.basename(src))[0]).strip()
    stats = {
        "blocks": len(blocks),
        "images": sum(1 for b in blocks if b["t"] == "img"),
        "words": sum(len("".join(r["x"] for r in b.get("runs", [])).split()) + len(b.get("text", "").split()) for b in blocks),
        "redactions": ex.redacted,
    }
    with open(os.path.join(out_dir, "doc.json"), "w", encoding="utf-8") as f:
        json.dump({"title": title, "sections": sections, "stats": stats}, f, ensure_ascii=False)
    print(json.dumps({"title": title, "sections": [(s["id"], len(s["blocks"])) for s in sections], **stats}, ensure_ascii=False))


if __name__ == "__main__":
    main()
