"""Upload validation: size, extension, magic bytes, safe storage paths."""

from __future__ import annotations

import hashlib
import io
import re
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path

from app.core.config import get_settings

PDF_MIME = "application/pdf"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
ALLOWED = {".pdf": PDF_MIME, ".docx": DOCX_MIME}


class UploadRejected(ValueError):
    pass


@dataclass
class ValidatedUpload:
    original_filename: str
    extension: str
    mime_type: str
    size: int
    sha256: str
    data: bytes


def safe_display_name(name: str) -> str:
    name = Path(name.replace("\\", "/")).name  # strip any directory components
    name = re.sub(r"[^A-Za-z0-9._ \-()]", "_", name).strip(" .")
    return (name or "upload")[:150]


def validate_resume_upload(filename: str, data: bytes) -> ValidatedUpload:
    max_bytes = get_settings().max_upload_mb * 1024 * 1024
    if not data:
        raise UploadRejected("The file is empty.")
    if len(data) > max_bytes:
        raise UploadRejected(f"The file exceeds the {get_settings().max_upload_mb} MB limit.")
    display = safe_display_name(filename or "")
    ext = Path(display).suffix.lower()
    if ext not in ALLOWED:
        raise UploadRejected("Only PDF and DOCX resumes are supported.")
    if ext == ".pdf":
        if not data.lstrip()[:5].startswith(b"%PDF-"):
            raise UploadRejected("The file is not a valid PDF.")
    else:
        if not data.startswith(b"PK\x03\x04"):
            raise UploadRejected("The file is not a valid DOCX document.")
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                names = set(zf.namelist())
                if "word/document.xml" not in names or "[Content_Types].xml" not in names:
                    raise UploadRejected("The file is not a valid DOCX document.")
                # Zip-bomb guard: bound the total uncompressed size.
                if sum(i.file_size for i in zf.infolist()) > 20 * max_bytes:
                    raise UploadRejected("The DOCX expands to an unreasonable size.")
                if any(n.lower().endswith((".bin", ".vba")) and "vbaproject" in n.lower() for n in names):
                    raise UploadRejected("Macro-enabled documents are not accepted.")
        except zipfile.BadZipFile as exc:
            raise UploadRejected("The file is not a valid DOCX document.") from exc
    return ValidatedUpload(
        original_filename=display,
        extension=ext,
        mime_type=ALLOWED[ext],
        size=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
        data=data,
    )


def user_dir(base: Path, user_id: uuid.UUID) -> Path:
    path = (base / str(user_id)).resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


def resolve_within(base: Path, relative: str) -> Path:
    """Resolve a stored relative path and guarantee it stays inside ``base`` (path traversal guard)."""
    base_resolved = base.resolve()
    target = (base_resolved / relative).resolve()
    if base_resolved != target and base_resolved not in target.parents:
        raise UploadRejected("Invalid file path")
    return target


def store_bytes(base: Path, user_id: uuid.UUID, data: bytes, extension: str) -> str:
    """Write bytes under ``base/<user_id>/<uuid><ext>`` and return the path relative to ``base``."""
    if extension not in {".pdf", ".docx", ".png", ".txt", ".zip"}:
        raise UploadRejected("Unsupported extension")
    directory = user_dir(base, user_id)
    name = f"{uuid.uuid4().hex}{extension}"
    (directory / name).write_bytes(data)
    return f"{user_id}/{name}"
