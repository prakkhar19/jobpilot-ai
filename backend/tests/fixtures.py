"""Synthetic candidate data. Fictional person — not based on any real individual."""

from __future__ import annotations

import io

RESUME_LINES = [
    "Jordan Rivera",
    "Machine Learning Engineer",
    "jordan.rivera@example.com | +1 555 010 2030 | Austin, Texas",
    "linkedin.com/in/jordan-rivera-demo | github.com/jrivera-demo",
    "",
    "SUMMARY",
    "Machine learning engineer with experience building NLP services and data pipelines in Python.",
    "",
    "EXPERIENCE",
    "Machine Learning Engineer | Northwind Analytics | Jan 2021 – Present",
    "• Built a document classification service with PyTorch and FastAPI serving 2 million requests per month",
    "• Reduced model inference latency by 35% by introducing batching and caching with Redis",
    "• Designed ETL pipelines in Apache Airflow feeding a PostgreSQL warehouse",
    "Software Engineer Intern | Contoso Labs | Jun 2019 – Dec 2020",
    "• Developed REST APIs in Flask and wrote unit tests with pytest",
    "• Containerized services with Docker and set up CI/CD using GitHub Actions",
    "",
    "EDUCATION",
    "University of Texas at Austin",
    "Bachelor of Science in Computer Science | 2015 - 2019 | GPA: 3.7/4.0",
    "",
    "SKILLS",
    "Languages: Python, SQL, JavaScript",
    "ML: PyTorch, scikit-learn, Hugging Face, NLP",
    "Tools: Docker, Git, PostgreSQL, Redis, AWS",
    "",
    "PROJECTS",
    "Semantic Search Engine | Python, FAISS, FastAPI",
    "• Built a semantic search prototype over 50k documents using sentence embeddings and FAISS",
    "Expense Tracker App",
    "• Created a React web app with a Node.js backend for tracking personal expenses",
    "",
    "CERTIFICATIONS",
    "AWS Certified Cloud Practitioner - Amazon Web Services, 2022",
    "",
    "ACHIEVEMENTS",
    "• Winner, Northwind internal hackathon 2022",
]
RESUME_TEXT = "\n".join(RESUME_LINES)


def make_docx(lines: list[str] = RESUME_LINES) -> bytes:
    from docx import Document

    doc = Document()
    for line in lines:
        if line.startswith("• "):
            doc.add_paragraph(line[2:], style="List Bullet")
        else:
            doc.add_paragraph(line)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def make_pdf(lines: list[str] = RESUME_LINES) -> bytes:
    from reportlab.lib.pagesizes import LETTER
    from reportlab.pdfgen import canvas

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=LETTER)
    y = 750
    for line in lines:
        c.setFont("Helvetica", 10)
        c.drawString(50, y, line.replace("–", "-"))
        y -= 14
        if y < 50:
            c.showPage()
            y = 750
    c.save()
    return buf.getvalue()


JD_ML = """About the role
We are hiring a Machine Learning Engineer to build NLP products.

Requirements
- 3+ years of experience in machine learning or software engineering
- Strong Python and PyTorch skills
- Experience deploying models behind REST APIs (FastAPI or Flask)
- Experience with Docker and Kubernetes
- Bachelor's degree in Computer Science or related field

Nice to have
- Experience with LangChain or vector databases
- AWS experience
"""
