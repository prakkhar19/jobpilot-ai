"""Fictional demo candidate used by `python -m app.cli seed-demo` (DEMO_MODE only). Not a real person."""

from __future__ import annotations

import io

DEMO_RESUME_LINES = [
    "Avery Demo",
    "Machine Learning Engineer",
    "avery.demo@example.com | +1 555 010 4242 | Remote",
    "github.com/avery-demo-sample",
    "",
    "SUMMARY",
    "Machine learning engineer focused on NLP services, model deployment and data pipelines in Python.",
    "",
    "EXPERIENCE",
    "Machine Learning Engineer | Sample Data Co | Mar 2021 – Present",
    "• Built a text classification service with PyTorch and FastAPI used by three internal teams",
    "• Cut inference latency by 40% through request batching and Redis caching",
    "• Containerized model services with Docker and deployed them on AWS",
    "• Designed ETL pipelines in Apache Airflow feeding a PostgreSQL warehouse",
    "Software Engineer | Placeholder Systems | Jul 2018 – Feb 2021",
    "• Developed REST APIs in Flask and Django serving 50k daily users",
    "• Introduced unit tests with pytest and CI/CD with GitHub Actions",
    "",
    "EDUCATION",
    "Example Institute of Technology",
    "Bachelor of Science in Computer Science | 2014 - 2018",
    "",
    "SKILLS",
    "Languages: Python, SQL, JavaScript",
    "ML: PyTorch, scikit-learn, Hugging Face, NLP, Embeddings",
    "Tools: FastAPI, Flask, Django, Docker, AWS, PostgreSQL, Redis, Git",
    "",
    "PROJECTS",
    "Semantic Search Prototype | Python, FAISS, FastAPI",
    "• Built a semantic search demo over 20k public documents using sentence embeddings and FAISS",
    "",
    "CERTIFICATIONS",
    "AWS Certified Cloud Practitioner - Amazon Web Services, 2022",
]

DEMO_FACTS = {"Work authorization": "Yes", "Notice period": "Two weeks"}


def demo_resume_docx() -> bytes:
    from docx import Document

    doc = Document()
    for line in DEMO_RESUME_LINES:
        if line.startswith("• "):
            doc.add_paragraph(line[2:], style="List Bullet")
        else:
            doc.add_paragraph(line)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()
