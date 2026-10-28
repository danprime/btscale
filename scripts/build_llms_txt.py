#!/usr/bin/env python3
"""Write llms.txt at the repo root, which GitHub Pages serves at the root of the site.

llms.txt (https://llmstxt.org) is a short Markdown index that tells AI assistants what this app is
and where its product docs are. It is built from docs/product/: the brief's "What it is" paragraph,
then one link per page with its front-matter summary. Links point at the raw Markdown on GitHub,
which is what assistants read best (Pages turns the .md files into .html).

Usage:
  python3 scripts/build_llms_txt.py           # rewrite llms.txt
  python3 scripts/build_llms_txt.py --check   # exit 1 if llms.txt is out of date

Kept separate from the kit's build_docs_site.py, which the kit's sync tool overwrites.
Standard library only.
"""
import argparse
import re
import sys
from pathlib import Path

RAW_BASE = "https://raw.githubusercontent.com/danprime/btscale/main/"
SITE = "https://myscale.danieltse.com/"
SRC = "docs/product"
# Overview pages first, in reading order; anything else sorts after them.
ORDER = ["brief.md", "features/index.md", "how-it-works/index.md", "constraints.md",
         "roadmap.md", "decisions.md", "ideas-rejected.md"]
OPTIONAL = [
    ("README", "README.md", "Developer reference: modules, screens, TDS behaviour, CSV format."),
    ("TDS calculations", "tds_calculations.md", "Every TDS, k_v and extraction calculation, with worked examples."),
]


def front_matter(text):
    fm = {}
    if text.startswith("---"):
        end = text.find("\n---", 3)
        for line in text[3:end].splitlines():
            m = re.match(r"^(\w+):\s*(.+)$", line)
            if m:
                fm[m.group(1)] = m.group(2).strip().strip("\"'")
        text = text[end + 4:]
    return fm, text


def build(root):
    src = root / SRC
    pages = []
    for p in src.rglob("*.md"):
        if p.name.startswith("_"):
            continue
        rel = p.relative_to(src).as_posix()
        fm, body = front_matter(p.read_text(encoding="utf-8"))
        pages.append((rel, fm, body))
    pages.sort(key=lambda pg: (ORDER.index(pg[0]) if pg[0] in ORDER else len(ORDER), pg[0]))

    brief = next(body for rel, _, body in pages if rel == "brief.md")
    name = re.search(r"^#\s+(.+)$", brief, re.M).group(1).strip()
    what = re.search(r"^## What it is\s*\n+(.+?)\n\n", brief, re.S | re.M).group(1)
    lines = [f"# {name}", "", f"> {' '.join(what.split())}", "",
             f"The app runs at {SITE}. Read the brief first; for features and how it works, read the "
             "index, then only the pages you need.", ""]

    groups = {"Overview": [], "Features": [], "How it works": []}
    for rel, fm, _ in pages:
        heading = {"features": "Features", "how-it-works": "How it works"}.get(rel.split("/")[0], "Overview")
        title = fm.get("title") or Path(rel).stem.replace("-", " ").title()
        groups[heading].append(f"- [{title}]({RAW_BASE}{SRC}/{rel}): {fm.get('summary', '')}")
    for heading, items in groups.items():
        lines += [f"## {heading}", "", *items, ""]
    lines += ["## Optional", ""]
    lines += [f"- [{title}]({RAW_BASE}{path}): {summary}" for title, path, summary in OPTIONAL]
    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=".")
    ap.add_argument("--check", action="store_true", help="fail if llms.txt is out of date")
    args = ap.parse_args()
    root = Path(args.root).resolve()
    target = root / "llms.txt"
    text = build(root)
    if args.check:
        current = target.read_text(encoding="utf-8").replace("\r\n", "\n") if target.is_file() else ""
        if current != text:
            print("llms.txt is out of date: run python3 scripts/build_llms_txt.py")
            sys.exit(1)
        print("llms.txt is up to date")
        return
    target.write_text(text, encoding="utf-8", newline="\n")
    print(f"Wrote {target.name}")


if __name__ == "__main__":
    main()
