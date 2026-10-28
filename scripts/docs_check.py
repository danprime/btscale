#!/usr/bin/env python3
"""Agent-ready standard: docs compliance check.

Usage:
  python3 scripts/docs_check.py            # report problems, exit 0 (warning mode)
  python3 scripts/docs_check.py --strict   # exit 1 if any problem is found

No dependencies beyond the Python standard library.
"""
import argparse
import datetime as dt
import os
import re
import sys
from pathlib import Path

STANDARD_VERSION_MIN = (1, 0)
FRESH_WARN_DAYS = 90
FRESH_FAIL_DAYS = 180

REQUIRED_FILES = [
    "AGENTS.md",
    "CLAUDE.md",
    ".claude/settings.json",
    ".devcontainer/devcontainer.json",
    "docs/product/brief.md",
    "docs/product/features/index.md",
    "docs/product/how-it-works/index.md",
    "docs/product/constraints.md",
    "docs/product/roadmap.md",
    "docs/product/decisions.md",
    "docs/product/ideas-rejected.md",
]
REQUIRED_DIRS = ["docs/specs", "docs/decisions", "docs/runbooks"]
REQUIRED_RUNBOOKS = [
    "pick-up-work", "spec-writer", "session-closeout", "decision-record",
    "docs-bootstrap", "docs-drift-check", "feasibility-review", "incident-mode",
]
PAGE_FIELDS = ["title", "summary", "owner", "last_verified", "status", "standard_version"]
PAGE_STATUSES = {"current", "draft", "stale"}
AGENTS_SECTIONS = [
    "Project summary", "Build, test, run", "Conventions", "Where context lives",
    "Rules for agents", "Skills", "Shared sessions",
]
LINK_RE = re.compile(r"\[[^\]]*\]\(([^)\s#]+)(#[^)]*)?\)")


class Report:
    def __init__(self):
        self.items = []  # (level, path, message)

    def warn(self, path, msg):
        self.items.append(("warning", path, msg))

    def fail(self, path, msg):
        self.items.append(("error", path, msg))

    def emit(self, strict):
        gha = os.environ.get("GITHUB_ACTIONS") == "true"
        for level, path, msg in self.items:
            shown = level if strict else "warning"
            if gha:
                print(f"::{shown} file={path}::{msg}")
            else:
                print(f"[{shown.upper()}] {path}: {msg}")
        n_err = sum(1 for lvl, _, _ in self.items if lvl == "error")
        n_warn = len(self.items) - n_err
        print(f"\ndocs check: {n_err} problem(s), {n_warn} advisory warning(s)"
              f"{' (strict mode)' if strict else ' (warning mode)'}")
        return 1 if strict and n_err else 0


def parse_front_matter(text):
    """Parse a small YAML subset: `key: value` and `key:` followed by `  - item` lines."""
    if not text.startswith("---"):
        return None
    end = text.find("\n---", 3)
    if end == -1:
        return None
    data, current_list = {}, None
    for raw in text[3:end].splitlines():
        line = raw.split(" #", 1)[0].rstrip()
        if not line.strip():
            continue
        m_item = re.match(r"^\s+-\s+(.*)$", line)
        if m_item and current_list is not None:
            data[current_list].append(m_item.group(1).strip().strip('"\''))
            continue
        m_kv = re.match(r"^([A-Za-z_][\w-]*):\s*(.*)$", line)
        if m_kv:
            key, val = m_kv.group(1), m_kv.group(2).strip().strip('"\'')
            if val == "":
                data[key] = []
                current_list = key
            else:
                data[key] = val
                current_list = None
    return data


def parse_version(v):
    try:
        return tuple(int(p) for p in str(v).split(".")[:2])
    except ValueError:
        return None


def is_template(path):
    return path.name.startswith("_") or path.name == "0000-template.md"


def check_required(root, rep):
    for f in REQUIRED_FILES:
        if not (root / f).is_file():
            rep.fail(f, "required file is missing")
    for d in REQUIRED_DIRS:
        if not (root / d).is_dir():
            rep.fail(d, "required folder is missing")
    for name in REQUIRED_RUNBOOKS:
        p = root / "docs/runbooks" / f"{name}.md"
        if not p.is_file():
            rep.fail(str(p.relative_to(root)), "required runbook is missing")


def check_page(root, path, rep, today, needs_code_paths):
    rel = str(path.relative_to(root))
    text = path.read_text(encoding="utf-8")
    fm = parse_front_matter(text)
    if fm is None:
        rep.fail(rel, "missing front matter header")
        return
    for field in PAGE_FIELDS:
        if field not in fm or fm[field] in ("", []):
            rep.fail(rel, f"header field '{field}' is missing")
    status = fm.get("status")
    if status and status not in PAGE_STATUSES:
        rep.fail(rel, f"status '{status}' must be one of {sorted(PAGE_STATUSES)}")
    if status == "draft":
        rep.warn(rel, "page is still a draft")
    ver = parse_version(fm.get("standard_version", ""))
    if ver is None or ver < STANDARD_VERSION_MIN:
        rep.fail(rel, f"standard_version below {'.'.join(map(str, STANDARD_VERSION_MIN))}")
    lv = fm.get("last_verified")
    if lv:
        try:
            age = (today - dt.date.fromisoformat(lv)).days
            if age > FRESH_FAIL_DAYS:
                rep.fail(rel, f"last verified {age} days ago (limit {FRESH_FAIL_DAYS})")
            elif age > FRESH_WARN_DAYS:
                rep.warn(rel, f"last verified {age} days ago, due for review")
        except ValueError:
            rep.fail(rel, f"last_verified '{lv}' is not a YYYY-MM-DD date")
    if needs_code_paths:
        cps = fm.get("code_paths")
        if not cps:
            rep.fail(rel, "feature and subsystem files need code_paths")
        else:
            for cp in cps:
                if "{{" not in cp and not (root / cp).exists():
                    rep.warn(rel, f"code_path '{cp}' does not exist")
    if "{{" in text:
        rep.fail(rel, "contains unfilled {{placeholders}}")


def check_index(root, folder, rep):
    index = folder / "index.md"
    if not index.is_file():
        return
    text = index.read_text(encoding="utf-8")
    linked = {Path(m.group(1)).name for m in LINK_RE.finditer(text)}
    for f in sorted(folder.glob("*.md")):
        if f.name == "index.md" or is_template(f):
            continue
        if f.name not in linked:
            rep.fail(str(f.relative_to(root)), f"not linked from {index.relative_to(root)}")


def check_links(root, rep):
    for md in sorted((root / "docs").rglob("*.md")):
        if is_template(md):
            continue
        for m in LINK_RE.finditer(md.read_text(encoding="utf-8")):
            target = m.group(1)
            if re.match(r"^[a-z]+:", target) or "{{" in target:
                continue
            if not (md.parent / target).resolve().exists():
                rep.fail(str(md.relative_to(root)), f"broken link: {target}")


def check_agents(root, rep):
    p = root / "AGENTS.md"
    if not p.is_file():
        return
    text = p.read_text(encoding="utf-8")
    headings = {h.strip() for h in re.findall(r"^##\s+(.+)$", text, re.M)}
    for s in AGENTS_SECTIONS:
        if s not in headings:
            rep.fail("AGENTS.md", f"missing section '## {s}'")
    if "{{" in text:
        rep.fail("AGENTS.md", "contains unfilled {{placeholders}}")
    lines = text.count("\n")
    if lines > 250:
        rep.warn("AGENTS.md", f"{lines} lines; keep it under ~200 and move detail to docs/")


def check_runbooks(root, rep):
    for name in REQUIRED_RUNBOOKS:
        p = root / "docs/runbooks" / f"{name}.md"
        if not p.is_file():
            continue
        fm = parse_front_matter(p.read_text(encoding="utf-8")) or {}
        ver = parse_version(fm.get("standard_version", ""))
        if ver is None or ver < STANDARD_VERSION_MIN:
            rep.fail(str(p.relative_to(root)), "runbook standard_version is below the minimum")


def check_size(root, rep):
    for folder in ("features", "how-it-works"):
        for f in (root / "docs/product" / folder).glob("*.md"):
            n = f.read_text(encoding="utf-8").count("\n")
            if n > 300:
                rep.warn(str(f.relative_to(root)), f"{n} lines; consider splitting into smaller files")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--strict", action="store_true", help="exit 1 on any problem")
    ap.add_argument("--root", default=".", help="repo root (default: current directory)")
    args = ap.parse_args()
    root = Path(args.root).resolve()
    rep = Report()
    today = dt.date.today()

    check_required(root, rep)
    product = root / "docs/product"
    if product.is_dir():
        for page in sorted(product.rglob("*.md")):
            if is_template(page):
                continue
            in_sub = page.parent.name in ("features", "how-it-works")
            check_page(root, page, rep, today, needs_code_paths=in_sub and page.name != "index.md")
        check_index(root, product / "features", rep)
        check_index(root, product / "how-it-works", rep)
        check_size(root, rep)
    check_links(root, rep)
    check_agents(root, rep)
    check_runbooks(root, rep)
    sys.exit(rep.emit(args.strict))


if __name__ == "__main__":
    main()
