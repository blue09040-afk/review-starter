#!/usr/bin/env python3
"""Resolve deterministic Markdown output names for auto-extracted source files.

Rule:
- A unique stem in one source directory -> extracted/<stem>.md
- The same stem used by multiple supported source extensions ->
  extracted/<stem>-<extension>.md for every colliding source.

Examples:
  report.pdf                  -> extracted/report.md
  report.pdf + report.hwp     -> extracted/report-pdf.md / report-hwp.md

Keep this as the single naming rule shared by extraction workflows.
"""

from __future__ import annotations

import argparse
from pathlib import Path

SOURCE_EXTENSIONS = {
    ".hwp",
    ".hwpx",
    ".odt",
    ".pdf",
    ".jpg",
    ".jpeg",
    ".png",
}


def resolve_output(source: Path) -> Path:
    workspace = Path.cwd().resolve()
    resolved = source.resolve(strict=True)
    extension = resolved.suffix.lower()
    if extension not in SOURCE_EXTENSIONS:
        raise ValueError(f"unsupported source extension: {resolved.suffix}")

    stem_key = resolved.stem.casefold()
    siblings = [
        item
        for item in resolved.parent.iterdir()
        if item.is_file()
        and item.suffix.lower() in SOURCE_EXTENSIONS
        and item.stem.casefold() == stem_key
    ]

    if len(siblings) > 1:
        output_name = f"{resolved.stem}-{extension[1:]}.md"
    else:
        output_name = f"{resolved.stem}.md"

    output = resolved.parent / "extracted" / output_name
    try:
        return output.relative_to(workspace)
    except ValueError:
        return output


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    args = parser.parse_args()
    print(resolve_output(args.source))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
