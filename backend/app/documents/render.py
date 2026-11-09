"""ATS-friendly DOCX and PDF rendering.

All templates are single-column, text-only (no tables, images, text boxes or columns) so that applicant
tracking systems parse them reliably. Templates differ only in typography and spacing.
"""

from __future__ import annotations

import io
from dataclasses import dataclass
from xml.sax.saxutils import escape

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor
from reportlab.lib.colors import HexColor
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4, LETTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    HRFlowable,
    KeepTogether,
    ListFlowable,
    ListItem,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
)


@dataclass(frozen=True)
class Template:
    key: str
    name: str
    description: str
    docx_font: str
    pdf_font: str
    pdf_bold: str
    body_pt: float
    name_pt: float
    heading_pt: float
    accent: str
    center_header: bool
    space_after: float
    page: str = "letter"


TEMPLATES: dict[str, Template] = {
    "classic": Template("classic", "Classic", "Traditional, centred header, serif-free and highly ATS-safe.",
                        "Calibri", "Helvetica", "Helvetica-Bold", 10.5, 18, 11, "#000000", True, 3),
    "modern": Template("modern", "Modern", "Left-aligned header with a subtle accent colour.",
                       "Arial", "Helvetica", "Helvetica-Bold", 10, 20, 11, "#1F4E79", False, 3),
    "compact": Template("compact", "Compact", "Tighter spacing to fit more on one page.",
                        "Arial", "Helvetica", "Helvetica-Bold", 9.5, 16, 10, "#000000", True, 1.5),
    "a4": Template("a4", "Classic (A4)", "Classic layout on A4 paper.",
                   "Calibri", "Times-Roman", "Times-Bold", 10.5, 18, 11, "#000000", True, 3, page="a4"),
}


def _contact_line(h: dict) -> list[str]:
    return [x for x in (h.get("email"), h.get("phone"), h.get("location"), h.get("linkedin_url"),
                        h.get("github_url"), h.get("portfolio_url")) if x]


def _sections(c: dict) -> list[tuple[str, str, object]]:
    """Ordered (title, kind, data) sections that have content."""
    out: list[tuple[str, str, object]] = []
    if c.get("summary"):
        out.append(("Summary", "text", c["summary"]))
    if any(g.get("items") for g in c.get("skills") or []):
        out.append(("Skills", "skills", c["skills"]))
    if c.get("experiences"):
        out.append(("Experience", "experience", c["experiences"]))
    if c.get("projects"):
        out.append(("Projects", "projects", c["projects"]))
    if c.get("education"):
        out.append(("Education", "education", c["education"]))
    if c.get("certifications"):
        out.append(("Certifications", "certs", c["certifications"]))
    if c.get("achievements"):
        out.append(("Achievements", "list", c["achievements"]))
    if c.get("publications"):
        out.append(("Publications", "list", c["publications"]))
    return out


# ------------------------------------------------------------------------------------------- DOCX

def _hex_rgb(h: str) -> RGBColor:
    h = h.lstrip("#")
    return RGBColor(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def _bottom_border(paragraph) -> None:  # noqa: ANN001
    p_pr = paragraph._p.get_or_add_pPr()
    borders = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    for k, v in (("w:val", "single"), ("w:sz", "6"), ("w:space", "1"), ("w:color", "808080")):
        bottom.set(qn(k), v)
    borders.append(bottom)
    p_pr.append(borders)


def render_docx(c: dict, template: str = "classic") -> bytes:
    t = TEMPLATES.get(template, TEMPLATES["classic"])
    doc = Document()
    for section in doc.sections:
        section.top_margin = section.bottom_margin = Pt(42)
        section.left_margin = section.right_margin = Pt(50)
    style = doc.styles["Normal"]
    style.font.name = t.docx_font
    style.font.size = Pt(t.body_pt)
    style.paragraph_format.space_after = Pt(t.space_after)
    style.paragraph_format.space_before = Pt(0)
    accent = _hex_rgb(t.accent)
    h = c.get("header") or {}

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER if t.center_header else WD_ALIGN_PARAGRAPH.LEFT
    run = p.add_run(h.get("full_name") or "")
    run.bold = True
    run.font.size = Pt(t.name_pt)
    run.font.color.rgb = accent
    if h.get("headline"):
        hp = doc.add_paragraph(h["headline"])
        hp.alignment = p.alignment
    contact = doc.add_paragraph(" | ".join(_contact_line(h)))
    contact.alignment = p.alignment

    def heading(text: str) -> None:
        hp = doc.add_paragraph()
        hp.paragraph_format.space_before = Pt(8)
        r = hp.add_run(text.upper())
        r.bold = True
        r.font.size = Pt(t.heading_pt)
        r.font.color.rgb = accent
        _bottom_border(hp)

    def bullet(text: str) -> None:
        bp = doc.add_paragraph(text, style="List Bullet")
        bp.paragraph_format.space_after = Pt(max(t.space_after - 1, 0))

    def line(left: str, right: str = "", bold_left: bool = True) -> None:
        lp = doc.add_paragraph()
        r = lp.add_run(left)
        r.bold = bold_left
        if right:
            lp.add_run(f"  |  {right}")

    for title, kind, data in _sections(c):
        heading(title)
        if kind == "text":
            doc.add_paragraph(str(data))
        elif kind == "skills":
            for g in data:  # type: ignore[union-attr]
                if g.get("items"):
                    sp = doc.add_paragraph()
                    sp.add_run(f"{g['category']}: ").bold = True
                    sp.add_run(", ".join(g["items"]))
        elif kind == "experience":
            for e in data:  # type: ignore[union-attr]
                line(" — ".join(x for x in (e.get("title"), e.get("company")) if x),
                     " | ".join(x for x in (e.get("location"), e.get("dates")) if x))
                for b in e.get("bullets") or []:
                    bullet(b)
        elif kind == "projects":
            for pr in data:  # type: ignore[union-attr]
                right = ", ".join(pr.get("technologies") or [])
                line(pr.get("name", ""), right)
                if pr.get("description"):
                    doc.add_paragraph(pr["description"])
                if pr.get("url"):
                    doc.add_paragraph(pr["url"])
                for b in pr.get("bullets") or []:
                    bullet(b)
        elif kind == "education":
            for ed in data:  # type: ignore[union-attr]
                deg = ed.get("degree", "")
                if ed.get("field_of_study") and ed["field_of_study"].lower() not in (deg or "").lower():
                    deg = f"{deg}, {ed['field_of_study']}" if deg else ed["field_of_study"]
                line(ed.get("institution", ""), ed.get("dates", ""))
                extra = " — ".join(x for x in (deg, f"Grade: {ed['grade']}" if ed.get("grade") else "") if x)
                if extra:
                    doc.add_paragraph(extra)
        elif kind == "certs":
            for ce in data:  # type: ignore[union-attr]
                bullet(" — ".join(x for x in (ce.get("name"), ce.get("issuer"), ce.get("date")) if x))
        elif kind == "list":
            for item in data:  # type: ignore[union-attr]
                bullet(str(item))

    doc.core_properties.title = f"Resume — {h.get('full_name', '')}"
    doc.core_properties.author = h.get("full_name", "")
    doc.core_properties.comments = ""
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


# -------------------------------------------------------------------------------------------- PDF

def _styles(t: Template) -> dict[str, ParagraphStyle]:
    accent = HexColor(t.accent)
    align = TA_CENTER if t.center_header else TA_LEFT
    lead = t.body_pt * 1.3
    return {
        "name": ParagraphStyle("name", fontName=t.pdf_bold, fontSize=t.name_pt, leading=t.name_pt * 1.2,
                               textColor=accent, alignment=align, spaceAfter=2),
        "sub": ParagraphStyle("sub", fontName=t.pdf_font, fontSize=t.body_pt, leading=lead, alignment=align),
        "h": ParagraphStyle("h", fontName=t.pdf_bold, fontSize=t.heading_pt, leading=t.heading_pt * 1.3,
                            textColor=accent, spaceBefore=8, spaceAfter=1),
        "body": ParagraphStyle("body", fontName=t.pdf_font, fontSize=t.body_pt, leading=lead, spaceAfter=t.space_after),
        "bold": ParagraphStyle("bold", fontName=t.pdf_font, fontSize=t.body_pt, leading=lead, spaceAfter=1),
        "bullet": ParagraphStyle("bullet", fontName=t.pdf_font, fontSize=t.body_pt, leading=lead),
    }


def _p(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(escape(text or ""), style)


def render_pdf(c: dict, template: str = "classic") -> bytes:
    t = TEMPLATES.get(template, TEMPLATES["classic"])
    st = _styles(t)
    buf = io.BytesIO()
    h = c.get("header") or {}
    doc = SimpleDocTemplate(
        buf, pagesize=A4 if t.page == "a4" else LETTER, leftMargin=0.7 * inch, rightMargin=0.7 * inch,
        topMargin=0.6 * inch, bottomMargin=0.6 * inch, title=f"Resume — {h.get('full_name', '')}",
        author=h.get("full_name", ""), subject="Resume",
    )
    flow: list = [_p(h.get("full_name", ""), st["name"])]
    if h.get("headline"):
        flow.append(_p(h["headline"], st["sub"]))
    flow.append(_p(" | ".join(_contact_line(h)), st["sub"]))

    def bullets(items: list[str]) -> ListFlowable:
        return ListFlowable([ListItem(_p(b, st["bullet"]), leftIndent=12) for b in items], bulletType="bullet",
                            start="•", leftIndent=12, bulletFontSize=t.body_pt)

    def header_line(left: str, right: str = "") -> Paragraph:
        txt = f"<b>{escape(left)}</b>" + (f"  |  {escape(right)}" if right else "")
        return Paragraph(txt, st["bold"])

    for title, kind, data in _sections(c):
        block: list = [_p(title.upper(), st["h"]), HRFlowable(width="100%", thickness=0.6, color=HexColor("#808080"),
                                                                spaceAfter=3)]
        if kind == "text":
            block.append(_p(str(data), st["body"]))
            flow.append(KeepTogether(block))
            continue
        flow.extend(block)
        if kind == "skills":
            for g in data:  # type: ignore[union-attr]
                if g.get("items"):
                    flow.append(Paragraph(f"<b>{escape(g['category'])}:</b> {escape(', '.join(g['items']))}", st["body"]))
        elif kind == "experience":
            for e in data:  # type: ignore[union-attr]
                part = [header_line(" — ".join(x for x in (e.get("title"), e.get("company")) if x),
                                    " | ".join(x for x in (e.get("location"), e.get("dates")) if x))]
                if e.get("bullets"):
                    part.append(bullets(e["bullets"]))
                part.append(Spacer(1, 4))
                flow.append(KeepTogether(part))
        elif kind == "projects":
            for pr in data:  # type: ignore[union-attr]
                part = [header_line(pr.get("name", ""), ", ".join(pr.get("technologies") or []))]
                if pr.get("description"):
                    part.append(_p(pr["description"], st["body"]))
                if pr.get("url"):
                    part.append(_p(pr["url"], st["body"]))
                if pr.get("bullets"):
                    part.append(bullets(pr["bullets"]))
                part.append(Spacer(1, 4))
                flow.append(KeepTogether(part))
        elif kind == "education":
            for ed in data:  # type: ignore[union-attr]
                deg = ed.get("degree", "")
                if ed.get("field_of_study") and ed["field_of_study"].lower() not in deg.lower():
                    deg = f"{deg}, {ed['field_of_study']}" if deg else ed["field_of_study"]
                flow.append(header_line(ed.get("institution", ""), ed.get("dates", "")))
                extra = " — ".join(x for x in (deg, f"Grade: {ed['grade']}" if ed.get("grade") else "") if x)
                if extra:
                    flow.append(_p(extra, st["body"]))
        elif kind == "certs":
            flow.append(bullets([" — ".join(x for x in (ce.get("name"), ce.get("issuer"), ce.get("date")) if x)
                                 for ce in data]))  # type: ignore[union-attr]
        elif kind == "list":
            flow.append(bullets([str(x) for x in data]))  # type: ignore[union-attr]
    doc.build(flow)
    return buf.getvalue()


# ----------------------------------------------------------------------------------- cover letters

def render_letter_docx(text: str, header: dict) -> bytes:
    doc = Document()
    style = doc.styles["Normal"]
    style.font.name = "Calibri"
    style.font.size = Pt(11)
    p = doc.add_paragraph()
    p.add_run(header.get("full_name", "")).bold = True
    contact = " | ".join(x for x in (header.get("email"), header.get("phone"), header.get("location")) if x)
    if contact:
        doc.add_paragraph(contact)
    doc.add_paragraph("")
    for para in [x.strip() for x in text.split("\n\n") if x.strip()]:
        doc.add_paragraph(para)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def render_letter_pdf(text: str, header: dict) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=LETTER, leftMargin=inch, rightMargin=inch, topMargin=inch,
                            bottomMargin=inch, title="Cover letter", author=header.get("full_name", ""))
    body = ParagraphStyle("b", fontName="Helvetica", fontSize=11, leading=15, spaceAfter=10)
    flow = [Paragraph(f"<b>{escape(header.get('full_name', ''))}</b>", body)]
    contact = " | ".join(x for x in (header.get("email"), header.get("phone"), header.get("location")) if x)
    if contact:
        flow.append(Paragraph(escape(contact), body))
    flow.append(Spacer(1, 8))
    for para in [x.strip() for x in text.split("\n\n") if x.strip()]:
        flow.append(Paragraph(escape(para).replace("\n", "<br/>"), body))
    doc.build(flow)
    return buf.getvalue()
