from __future__ import annotations

import argparse
import html
import json
import re
import tempfile
import time
from collections import Counter
from difflib import SequenceMatcher
from pathlib import Path

import pymupdf

from native_oneocr import NativeOneOCR

TOKEN_RE = re.compile(r"[가-힣]+|[A-Za-z]+|\d+(?:[.,]\d+)*(?:%?)")
DIGIT_RE = re.compile(r"\d+(?:[.,]\d+)*(?:%?)")
KOREAN_RE = re.compile(r"[가-힣]+")


def normalize_source(text: str) -> str:
    text = re.sub(r"<br\s*/?>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    text = re.sub(r"[`#|*_~]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def normalize_ocr(text: str) -> str:
    text = re.sub(r"^#+\s+.*$", " ", text, flags=re.MULTILINE)
    return re.sub(r"\s+", " ", text).strip()


def metric(source_tokens: list[str], ocr_tokens: list[str]) -> dict[str, float | int]:
    source_counter = Counter(source_tokens)
    ocr_counter = Counter(ocr_tokens)
    overlap = sum(min(count, ocr_counter[token]) for token, count in source_counter.items())
    return {
        "source": sum(source_counter.values()),
        "ocr": sum(ocr_counter.values()),
        "matched": overlap,
        "recall": round(overlap / max(1, sum(source_counter.values())), 4),
        "precision": round(overlap / max(1, sum(ocr_counter.values())), 4),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="OCR a PDF with the native OneOCR runtime")
    parser.add_argument("pdf", type=Path)
    parser.add_argument("runtime_dir", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--dpi", type=int, default=220)
    parser.add_argument("--source-md", type=Path)
    args = parser.parse_args()

    if not args.pdf.is_file():
        raise SystemExit(f"PDF not found: {args.pdf}")
    if not 72 <= args.dpi <= 600:
        raise SystemExit("DPI must be between 72 and 600")
    if args.source_md and not args.source_md.is_file():
        raise SystemExit(f"Source Markdown not found: {args.source_md}")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    zoom = args.dpi / 72.0
    page_texts: list[str] = []
    page_seconds: list[float] = []

    with pymupdf.open(args.pdf) as document:
        if document.page_count < 1:
            raise SystemExit("PDF has no pages")
        page_count = document.page_count
        with tempfile.TemporaryDirectory(prefix="oneocr-pages-") as temp_dir:
            temp_root = Path(temp_dir)
            with NativeOneOCR(args.runtime_dir) as ocr:
                for index, page in enumerate(document, start=1):
                    image = temp_root / f"page-{index:04d}.png"
                    page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False).save(image)
                    started = time.perf_counter()
                    text = ocr.recognize_file(image).strip()
                    page_seconds.append(time.perf_counter() - started)
                    page_texts.append(text)

    parts = ["# OneOCR result", ""]
    for index, text in enumerate(page_texts, start=1):
        parts.extend([f"## Page {index}", "", text or "[OCR result empty]", ""])
    ocr_md = "\n".join(parts).rstrip() + "\n"
    (args.output_dir / "ocr.md").write_text(ocr_md, encoding="utf-8")

    report: dict[str, object] = {
        "pdf_pages": page_count,
        "dpi": args.dpi,
        "ocr_chars_normalized": len(normalize_ocr(ocr_md)),
        "page_ocr_seconds": [round(value, 3) for value in page_seconds],
        "total_ocr_seconds": round(sum(page_seconds), 3),
    }

    if args.source_md:
        source_norm = normalize_source(args.source_md.read_text(encoding="utf-8"))
        ocr_norm = normalize_ocr(ocr_md)
        source_tokens = TOKEN_RE.findall(source_norm)
        ocr_tokens = TOKEN_RE.findall(ocr_norm)
        report.update(
            {
                "source_chars_normalized": len(source_norm),
                "sequence_similarity": round(SequenceMatcher(None, source_norm, ocr_norm).ratio(), 4),
                "all_tokens": metric(source_tokens, ocr_tokens),
                "digit_tokens": metric(DIGIT_RE.findall(source_norm), DIGIT_RE.findall(ocr_norm)),
                "korean_tokens": metric(KOREAN_RE.findall(source_norm), KOREAN_RE.findall(ocr_norm)),
            }
        )

    (args.output_dir / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    log_summary = {
        key: value
        for key, value in report.items()
        if key
        in {
            "pdf_pages",
            "dpi",
            "ocr_chars_normalized",
            "sequence_similarity",
            "all_tokens",
            "digit_tokens",
            "korean_tokens",
            "page_ocr_seconds",
            "total_ocr_seconds",
        }
    }
    print(json.dumps(log_summary, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
