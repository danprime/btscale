#!/usr/bin/env python3
"""Agent-ready standard: build docs/product/ into a static site with llms.txt.

Usage:
  python3 scripts/build_docs_site.py --out _site --base-url https://you.github.io/repo/product
  python3 scripts/build_docs_site.py --out dist/product   # e.g. inside an existing app build

Requires: pip install markdown
"""
import argparse
import html
import re
import shutil
import sys
from pathlib import Path

try:
    import markdown
except ImportError:
    sys.exit("Missing dependency: pip install markdown")

CSS = """
:root{--bg:#fbfaf7;--fg:#22211f;--muted:#6b6862;--line:#e4e1da;--accent:#7a4b2a;--code:#f1eee8}
@media (prefers-color-scheme:dark){:root{--bg:#1c1b1a;--fg:#eceae5;--muted:#a19d95;--line:#34322f;--accent:#d9a47a;--code:#2a2826}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 system-ui,-apple-system,Segoe UI,sans-serif}
.wrap{display:grid;grid-template-columns:240px minmax(0,1fr);max-width:1100px;margin:0 auto;gap:40px;padding:32px 16px}
nav{position:sticky;top:24px;align-self:start;font-size:14px}nav a{display:block;color:var(--fg);text-decoration:none;padding:3px 0}
nav a.sub{padding-left:14px;color:var(--muted)}nav a.on{color:var(--accent);font-weight:600}nav .site{font-weight:600;margin-bottom:12px;display:block}
main{min-width:0}h1{font-size:28px;line-height:1.25;margin:0 0 8px}h2{font-size:20px;margin-top:32px}
.meta{color:var(--muted);font-size:13px;margin-bottom:24px}.draft{display:inline-block;background:var(--code);padding:1px 8px;border-radius:10px;margin-left:6px}
a{color:var(--accent)}table{border-collapse:collapse;width:100%;font-size:14px;display:block;overflow-x:auto}
th,td{border:1px solid var(--line);padding:6px 10px;text-align:left;vertical-align:top}th{background:var(--code)}
code,pre{background:var(--code);border-radius:4px;font-size:13px}code{padding:1px 4px}pre{padding:12px;overflow-x:auto}
@media (max-width:760px){.wrap{grid-template-columns:1fr;gap:16px}nav{position:static;border-bottom:1px solid var(--line);padding-bottom:12px}}
"""


def split_front_matter(text):
    fm = {}
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            for line in text[3:end].splitlines():
                m = re.match(r"^([A-Za-z_][\w-]*):\s*(.+)$", line.split(" #", 1)[0].rstrip())
                if m:
                    fm[m.group(1)] = m.group(2).strip().strip('"\'')
            text = text[end + 4:].lstrip("\n")
    return fm, text


def md_to_html_links(body):
    # Point .md links at the built .html pages, keeping anchors.
    return re.sub(r"\]\(([^)\s:]+?)\.md(#[^)]*)?\)", lambda m: f"]({m.group(1)}.html{m.group(2) or ''})", body)


def collect(src):
    pages = []
    for p in sorted(src.rglob("*.md")):
        if p.name.startswith("_"):
            continue
        rel = p.relative_to(src)
        fm, body = split_front_matter(p.read_text(encoding="utf-8"))
        title = fm.get("title") or p.stem.replace("-", " ").title()
        pages.append({"rel": rel, "out": rel.with_suffix(".html"), "fm": fm, "title": title, "body": body})
    order = {"brief.md": 0, "features/index.md": 1, "how-it-works/index.md": 2, "constraints.md": 3,
             "roadmap.md": 4, "decisions.md": 5, "ideas-rejected.md": 6}

    def key(pg):
        r = pg["rel"].as_posix()
        top = r.split("/")[0] + ("/index.md" if "/" in r else "")
        return (order.get(top, 50), 0 if r.endswith("index.md") or "/" not in r else 1, r)

    return sorted(pages, key=key)


def nav_html(pages, current, site_name):
    depth = len(current["out"].parts) - 1
    up = "../" * depth
    links = [f'<a class="site" href="{up}brief.html">{html.escape(site_name)}</a>']
    for pg in pages:
        sub = "/" in pg["rel"].as_posix() and pg["rel"].name != "index.md"
        cls = " ".join(c for c in ("sub" if sub else "", "on" if pg is current else "") if c)
        links.append(f'<a class="{cls}" href="{up}{pg["out"].as_posix()}">{html.escape(pg["title"])}</a>')
    return "\n".join(links)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", default="docs/product")
    ap.add_argument("--out", default="_site")
    ap.add_argument("--base-url", default="", help="absolute URL the site is served from, used in llms.txt")
    ap.add_argument("--name", default=None, help="site name (default: brief.md heading)")
    args = ap.parse_args()

    src, out = Path(args.src), Path(args.out)
    if not src.is_dir():
        sys.exit(f"{src} not found")
    pages = collect(src)
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    site_name = args.name
    if not site_name:
        brief = next((p for p in pages if p["rel"].as_posix() == "brief.md"), None)
        m = re.search(r"^#\s+(.+)$", brief["body"], re.M) if brief else None
        site_name = m.group(1).strip() if m else "Product docs"

    for pg in pages:
        body_html = markdown.markdown(md_to_html_links(pg["body"]), extensions=["tables", "fenced_code", "sane_lists"])
        fm = pg["fm"]
        meta = []
        if fm.get("owner"):
            meta.append(f"Owner: {html.escape(fm['owner'])}")
        if fm.get("last_verified"):
            meta.append(f"Last verified: {html.escape(fm['last_verified'])}")
        draft = '<span class="draft">Draft</span>' if fm.get("status") == "draft" else ""
        depth = len(pg["out"].parts) - 1
        doc = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(pg['title'])} · {html.escape(site_name)}</title>
<meta name="description" content="{html.escape(fm.get('summary', ''))}">
<link rel="alternate" type="text/plain" href="{'../' * depth}llms.txt">
<style>{CSS}</style></head><body><div class="wrap">
<nav>{nav_html(pages, pg, site_name)}</nav>
<main><div class="meta">{' · '.join(meta)}{draft}</div>{body_html}</main>
</div></body></html>"""
        dest = out / pg["out"]
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(doc, encoding="utf-8")
        # Also publish the raw markdown next to each page, for agents.
        (out / pg["rel"]).write_text(pg["body"], encoding="utf-8")

    (out / "index.html").write_text(
        '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=brief.html">'
        '<a href="brief.html">Product docs</a>', encoding="utf-8")

    base = args.base_url.rstrip("/") + "/" if args.base_url else ""
    lines = [f"# {site_name}", "",
             "> Product context for people and AI assistants. Read brief first. For features and "
             "how-it-works, read the index, then only the pages you need. Raw markdown is available "
             "at the same path with a .md extension.", ""]
    groups = {"Overview": [], "Features": [], "How it works": []}
    for pg in pages:
        top = pg["rel"].parts[0] if len(pg["rel"].parts) > 1 else ""
        heading = {"features": "Features", "how-it-works": "How it works"}.get(top, "Overview")
        summary = pg["fm"].get("summary", "")
        groups[heading].append(f"- [{pg['title']}]({base}{pg['rel'].as_posix()}): {summary}")
    for heading, items in groups.items():
        if items:
            lines += [f"## {heading}", "", *items, ""]
    (out / "llms.txt").write_text("\n".join(lines), encoding="utf-8")
    print(f"Built {len(pages)} page(s) into {out}/ (with llms.txt)")


if __name__ == "__main__":
    main()
