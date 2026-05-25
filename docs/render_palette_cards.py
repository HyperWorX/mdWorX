"""
Render each palette card from palette-reference.html into palette-images/<slug>.png.

Strategy:
  1. Split the source HTML into <head>...</head> and the body's per-card sections.
  2. For each card, write a temp HTML file containing the head + just that card,
     wrapped in a simple full-bleed body so it sits flush to the screenshot edges.
  3. Drive Chrome headless via the new --headless=new mode to take a viewport
     screenshot at a high-DPI ratio so the result matches the existing
     default-dark.png / dracula.png density (~3x).
  4. Save with the slugified palette title as filename.

Slugging matches the references already in palettes.md:
  "Default Dark"      -> "default-dark"
  "AnuPpuccin Frappé" -> "anuppuccin-frappe"   (accent stripped)
  "Rosé Pine"         -> "rose-pine"

Re-runs are idempotent: existing PNGs are overwritten.
"""

import re
import subprocess
import sys
import tempfile
import unicodedata
from pathlib import Path

DOCS_DIR    = Path(__file__).resolve().parent
SOURCE_HTML = DOCS_DIR / "palette-reference.html"
OUT_DIR     = DOCS_DIR / "palette-images"
CHROME      = Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")

# Render dimensions. Width is generous so swatches + the two-up editor preview
# don't wrap. Height is enough for the tallest card; trailing whitespace is
# trimmed via Chrome's --screenshot using the document scroll size below.
WINDOW_W = 1200
WINDOW_H = 720
DEVICE_SCALE = 2.5      # high-DPI to roughly match existing PNG density

def slugify(name: str) -> str:
    # Strip accents
    nk = unicodedata.normalize("NFKD", name)
    nk = "".join(c for c in nk if not unicodedata.combining(c))
    nk = nk.lower()
    nk = re.sub(r"[^a-z0-9]+", "-", nk).strip("-")
    return nk

def extract_head(html: str) -> str:
    m = re.search(r"<head\b[^>]*>(.*?)</head>", html, re.S | re.I)
    if not m:
        sys.exit("could not find <head> in source HTML")
    return m.group(1)

def extract_cards(html: str):
    """Yield (title, card_html) for every <section class='card'> block."""
    pattern = re.compile(
        r'(<section\b[^>]*class="[^"]*\bcard\b[^"]*"[^>]*>.*?</section>)',
        re.S | re.I,
    )
    title_pat = re.compile(r'<div\s+class="card-title">([^<]+)</div>', re.I)
    for m in pattern.finditer(html):
        block = m.group(1)
        tm = title_pat.search(block)
        if not tm:
            continue
        yield tm.group(1).strip(), block

def build_temp_html(head: str, card_html: str) -> str:
    # Body padding gives the card a small margin from the screenshot edges
    # so the card's box-shadow / border isn't clipped.
    return (
        "<!doctype html><html><head>"
        + head
        + "<style>html,body{margin:0;background:#f6f6f6;}"
        + "body{padding:24px;display:inline-block;}"
        + "</style></head><body>"
        + card_html
        + "</body></html>"
    )

def render_card(temp_html_path: Path, out_png: Path, profile_dir: Path):
    # A fresh --user-data-dir per call avoids the profile-lock conflict that
    # occurs when the host already has a Chrome session running. Without it,
    # most invocations silently produce a 0-byte file.
    cmd = [
        str(CHROME),
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--no-sandbox",
        "--no-first-run",
        "--no-default-browser-check",
        f"--user-data-dir={profile_dir}",
        f"--screenshot={out_png}",
        f"--window-size={WINDOW_W},{WINDOW_H}",
        f"--force-device-scale-factor={DEVICE_SCALE}",
        temp_html_path.as_uri(),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if result.returncode != 0 or not out_png.exists() or out_png.stat().st_size == 0:
        print("  chrome stderr:", (result.stderr or "").strip()[:400])
        print("  chrome stdout:", (result.stdout or "").strip()[:200])
        return False
    return True

def main():
    if not CHROME.exists():
        sys.exit(f"Chrome not found at {CHROME}")
    if not SOURCE_HTML.exists():
        sys.exit(f"Source HTML not found at {SOURCE_HTML}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    html = SOURCE_HTML.read_text(encoding="utf-8")
    head = extract_head(html)

    cards = list(extract_cards(html))
    print(f"Found {len(cards)} cards.")
    if not cards:
        sys.exit("no cards extracted - HTML structure may have changed")

    with tempfile.TemporaryDirectory(prefix="palette-render-") as td:
        td_path = Path(td)
        for i, (title, card_html) in enumerate(cards, 1):
            slug = slugify(title)
            out_png = OUT_DIR / f"{slug}.png"
            temp_html = td_path / f"card-{i:02d}.html"
            temp_html.write_text(build_temp_html(head, card_html), encoding="utf-8")
            profile = td_path / f"profile-{i:02d}"
            ok = render_card(temp_html, out_png, profile)
            status = "OK" if ok else "FAIL"
            size = out_png.stat().st_size if out_png.exists() else 0
            try:
                print(f"  [{status}] {title:30s} -> {slug}.png  ({size//1024} KB)")
            except UnicodeEncodeError:
                # Console codepage cannot render the accented title; fall back
                # to printing the slug only.
                print(f"  [{status}] (accented title) -> {slug}.png  ({size//1024} KB)")

if __name__ == "__main__":
    main()
