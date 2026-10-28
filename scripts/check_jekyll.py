#!/usr/bin/env python3
"""Check files GitHub Pages (Jekyll) publishes for Liquid syntax.

This repo is published by GitHub Pages' Jekyll build from `main`. Jekyll treats `{{ ... }}` and
`{% ... %}` in Markdown and HTML as Liquid template code: a stray or unclosed one can fail the whole
Pages build, and then the app stops updating too. A complete `{{ name }}` doesn't fail, it silently
renders as nothing, which is just as wrong in a doc.

Usage:
  python3 scripts/check_jekyll.py           # exit 1 if any published file contains {{ or {%
  python3 scripts/check_jekyll.py --root .

Wrap text that must show braces in {% raw %} ... {% endraw %}; this check allows them inside raw blocks.
Files Jekyll doesn't publish are skipped: names starting with `_` or `.` (anywhere in the path),
and anything listed under `exclude:` in `_config.yml`. Standard library only.
"""
import argparse
import re
import subprocess
import sys
from pathlib import Path

CHECKED = {".md", ".markdown", ".html", ".htm"}
JEKYLL_DEFAULT_EXCLUDE = ["node_modules", "vendor", "Gemfile", "Gemfile.lock"]
RAW_RE = re.compile(r"\{%-?\s*raw\s*-?%\}.*?\{%-?\s*endraw\s*-?%\}", re.S)
LIQUID_RE = re.compile(r"\{\{|\{%")


def config_excludes(root):
    """The `exclude:` list from _config.yml (block list or inline [a, b]), without a YAML parser."""
    cfg = root / "_config.yml"
    if not cfg.is_file():
        return list(JEKYLL_DEFAULT_EXCLUDE)
    out, in_list = [], False
    for line in cfg.read_text(encoding="utf-8").splitlines():
        m = re.match(r"^exclude:\s*(.*)$", line)
        if m:
            inline = m.group(1).strip()
            if inline.startswith("["):
                out += [x.strip().strip("'\"") for x in inline.strip("[]").split(",") if x.strip()]
            in_list = not inline
            continue
        if in_list:
            item = re.match(r"^\s+-\s+(.+)$", line)
            if item:
                out.append(item.group(1).strip().strip("'\""))
            elif line.strip() and not line.startswith(" "):
                in_list = False
    return out


def published_files(root):
    try:
        files = subprocess.run(["git", "ls-files"], cwd=root, capture_output=True, text=True, check=True).stdout.splitlines()
    except (OSError, subprocess.CalledProcessError):
        files = [p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file()]
    excludes = [e.rstrip("/") for e in config_excludes(root)]
    for rel in files:
        parts = rel.split("/")
        if any(p.startswith(("_", ".")) for p in parts):
            continue
        if any(rel == e or rel.startswith(e + "/") for e in excludes):
            continue
        if Path(rel).suffix.lower() in CHECKED:
            yield rel


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=".")
    root = Path(ap.parse_args().root).resolve()
    problems = 0
    for rel in published_files(root):
        text = (root / rel).read_text(encoding="utf-8", errors="replace")
        masked = RAW_RE.sub(lambda m: re.sub(r"[^\n]", " ", m.group(0)), text)
        for m in LIQUID_RE.finditer(masked):
            line = masked.count("\n", 0, m.start()) + 1
            snippet = text.splitlines()[line - 1].strip()[:100]
            print(f"[ERROR] {rel}:{line}: Liquid '{m.group(0)}' in a published file: {snippet}")
            problems += 1
    print(f"\njekyll check: {problems} problem(s)")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
