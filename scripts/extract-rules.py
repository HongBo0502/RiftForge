"""
extract-rules — turn Riot's official Core Rules PDF into searchable text.

    python scripts/extract-rules.py

The engine is built against the official rules rather than community
summaries, and a 120-page PDF is not greppable. This writes docs/core-rules.txt
so rules can be looked up while implementing.

Source: the Rules Hub at https://playriftbound.com/en-us/rules-hub/
Re-run when Riot publishes a new version.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.request import Request, urlopen

from pypdf import PdfReader

# Direct CDN links as listed on the Rules Hub (both updated 2026-07-16).
DOCS = {
    "core-rules": "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/e9ac8e3d33e0f78cef296f5945aba7bc1313b086.pdf",
    "tournament-rules": "https://cmsassets.rgpub.io/sanity/files/dsfx7636/news_live/503da65669ced10598d62925a6f6bc15111af726.pdf",
}

ROOT = Path(__file__).resolve().parent.parent
DOCS_DIR = ROOT / "docs"
PDF_DIR = DOCS_DIR / "pdf"


def download(url: str, dest: Path) -> None:
    if dest.exists():
        print(f"  {dest.name} already present ({dest.stat().st_size / 1e6:.1f} MB)")
        return
    print(f"  downloading {dest.name} ...")
    req = Request(url, headers={"User-Agent": "riftforge-rules-extract"})
    with urlopen(req) as response:
        dest.write_bytes(response.read())
    print(f"  saved {dest.stat().st_size / 1e6:.1f} MB")


PAGE_MARKER = re.compile(r"^===== page (\d+) =====$", re.MULTILINE)

# The PDF lays out one word per text run, so raw extraction gives one word per
# line. Rules are numbered "053." / "053.1." — reflowing to one rule per line
# is what makes the document greppable.
RULE_NUMBER = re.compile(r"(?<![\d.])(\d{3}\.(?:\d+\.)*)\s")

LIGATURES = {
    "ﬁ": "fi", "ﬂ": "fl", "ﬀ": "ff", "ﬃ": "ffi", "ﬄ": "ffl",
    " ": " ", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-",
}


def reflow(raw: str) -> str:
    """Collapse word-per-line extraction back into one line per numbered rule."""
    for bad, good in LIGATURES.items():
        raw = raw.replace(bad, good)

    out = []
    pages = PAGE_MARKER.split(raw)
    # split() yields [prefix, page_no, body, page_no, body, ...]
    for i in range(1, len(pages), 2):
        number, body = pages[i], pages[i + 1]
        flat = re.sub(r"\s+", " ", body).strip()
        flat = RULE_NUMBER.sub(lambda m: "\n" + m.group(1) + " ", flat)
        out.append(f"\n===== page {number} =====\n{flat.strip()}")
    return "\n".join(out) + "\n"


def extract(pdf: Path, out: Path) -> int:
    """Parse the PDF (cached, it is slow) and write reflowed text."""
    cache = PDF_DIR / f"{pdf.stem}.rawtxt"

    if cache.exists():
        raw = cache.read_text(encoding="utf-8")
        pages = len(PAGE_MARKER.findall(raw))
        print(f"  using cached raw text ({pages} pages)")
    else:
        reader = PdfReader(str(pdf))
        parts = []
        for number, page in enumerate(reader.pages, start=1):
            text = (page.extract_text() or "").strip()
            # Page markers make it possible to cite a rule back to the PDF.
            parts.append(f"\n\n===== page {number} =====\n{text}")
        raw = "".join(parts)
        cache.write_text(raw, encoding="utf-8")
        pages = len(reader.pages)

    out.write_text(reflow(raw), encoding="utf-8")
    return pages


def main() -> int:
    DOCS_DIR.mkdir(exist_ok=True)
    PDF_DIR.mkdir(exist_ok=True)

    for name, url in DOCS.items():
        print(f"{name}:")
        pdf = PDF_DIR / f"{name}.pdf"
        try:
            download(url, pdf)
        except Exception as err:  # noqa: BLE001 - report and continue
            print(f"  FAILED to download: {err}", file=sys.stderr)
            continue

        out = DOCS_DIR / f"{name}.txt"
        pages = extract(pdf, out)
        size = out.stat().st_size
        print(f"  extracted {pages} pages -> docs/{out.name} ({size / 1024:.0f} KB)")

        if size < 10_000:
            print("  WARNING: suspiciously little text — the PDF may be image-only",
                  file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
