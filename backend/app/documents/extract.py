"""Text extraction from uploaded PDF/DOCX resumes."""

from __future__ import annotations

import io
import re

from docx import Document
from pypdf import PdfReader


class ExtractionError(ValueError):
    pass


def extract_pdf(data: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            try:
                reader.decrypt("")
            except Exception as exc:  # noqa: BLE001
                raise ExtractionError("The PDF is password-protected.") from exc
        pages = []
        for page in reader.pages[:30]:
            try:
                pages.append(page.extract_text(extraction_mode="layout") or "")
            except Exception:  # noqa: BLE001
                pages.append(page.extract_text() or "")
        return "\n".join(pages)
    except ExtractionError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise ExtractionError("Could not read text from this PDF.") from exc


def extract_docx(data: bytes) -> str:
    try:
        doc = Document(io.BytesIO(data))
    except Exception as exc:  # noqa: BLE001
        raise ExtractionError("Could not read this DOCX file.") from exc
    lines: list[str] = []
    for para in doc.paragraphs:
        text = para.text.strip()
        style = (para.style.name or "").lower() if para.style is not None else ""
        if text and ("list" in style or "bullet" in style) and not text.startswith(("•", "-", "*")):
            text = "• " + text
        lines.append(text)
    for table in doc.tables:
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells if c.text.strip()]
            if cells:
                lines.append(" | ".join(dict.fromkeys(cells)))
    # Header/footer often contain contact details.
    for section in doc.sections:
        for p in section.header.paragraphs:
            if p.text.strip():
                lines.insert(0, p.text.strip())
    return "\n".join(lines)


_BULLET_GLYPHS = ("\x7f", "", "", "", "", "", "▪", "●", "‣", "⁃", "•")


def normalize_text(text: str) -> str:
    text = text.replace("\r", "\n").replace(" ", " ")
    for glyph in _BULLET_GLYPHS:
        text = text.replace(glyph, "•")
    text = re.sub(r"[ \t]+", " ", text)
    lines = [ln.strip() for ln in text.split("\n")]
    out: list[str] = []
    for ln in lines:
        if not ln and out and not out[-1]:
            continue
        out.append(ln)
    return "\n".join(out).strip()


def extract_text(data: bytes, extension: str) -> str:
    raw = extract_pdf(data) if extension == ".pdf" else extract_docx(data)
    text = normalize_text(raw)
    if len(text) < 30:
        raise ExtractionError(
            "Very little text could be extracted. If this is a scanned PDF, please upload a text-based PDF or DOCX."
        )
    return text
