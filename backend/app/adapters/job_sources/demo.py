"""Sandbox job board for demos and end-to-end tests.

These postings are *fictional* and clearly labelled as demo data. The source is available only when
DEMO_MODE=true. Applications point to the local mock application portal, never to a real employer.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from app.adapters.job_sources.base import JobSourceAdapter, NormalizedJob, SearchCriteria, SourceCheck
from app.core.config import get_settings

DEMO_JOBS: list[dict] = [
    {
        "id": "demo-ml-1", "company": "Demo Company A (sandbox)", "title": "Machine Learning Engineer",
        "location": "Remote", "workplace": "remote", "type": "Full-time",
        "description": "Demo posting for testing JobPilot AI. Not a real job.\n\nResponsibilities\n- Build and deploy NLP models\n- Own model serving infrastructure\n\nRequirements\n- 3+ years of experience in machine learning\n- Strong Python and PyTorch\n- Experience with FastAPI or Flask and REST APIs\n- Docker and Kubernetes\n- Bachelor's degree in Computer Science or equivalent experience\n\nNice to have\n- LangChain, vector databases\n- AWS",
    },
    {
        "id": "demo-be-1", "company": "Demo Company B (sandbox)", "title": "Backend Python Developer",
        "location": "Berlin, Germany", "workplace": "hybrid", "type": "Full-time",
        "description": "Demo posting for testing JobPilot AI. Not a real job.\n\nWhat you'll do\n- Design REST APIs\n- Maintain PostgreSQL data models\n\nWhat we're looking for\n- 2+ years building backend services in Python\n- Django or FastAPI\n- PostgreSQL, Redis\n- CI/CD and Git\n\nBonus\n- Celery, RabbitMQ",
    },
    {
        "id": "demo-fe-1", "company": "Demo Company C (sandbox)", "title": "Senior Frontend Engineer",
        "location": "New York, NY", "workplace": "onsite", "type": "Full-time",
        "description": "Demo posting for testing JobPilot AI. Not a real job.\n\nRequirements\n- 6+ years of frontend experience\n- Expert in TypeScript, React and Next.js\n- Design systems and accessibility\n\nPreferred\n- GraphQL",
    },
    {
        "id": "demo-de-1", "company": "Demo Company D (sandbox)", "title": "Data Engineer",
        "location": "Remote", "workplace": "remote", "type": "Contract",
        "description": "Demo posting for testing JobPilot AI. Not a real job.\n\nRequirements\n- 3+ years of data engineering\n- Python, SQL, Apache Airflow\n- ETL pipelines and data warehousing (Snowflake or BigQuery)\n- Apache Spark\n\nNice to have\n- dbt, Kafka",
    },
]


class DemoAdapter(JobSourceAdapter):
    kind = "demo"
    label = "Demo sandbox board"
    description = "Fictional postings for trying JobPilot AI safely. Applications go to a local mock portal."
    identifier_help = "Use 'sandbox'"

    def validate_source_access(self, identifier: str) -> SourceCheck:
        if not get_settings().demo_mode:
            return SourceCheck(False, "The demo board is disabled (set DEMO_MODE=true).")
        return SourceCheck(True, "Demo sandbox board.", display_name="Demo sandbox (fictional jobs)", job_count=len(DEMO_JOBS))

    def discover_jobs(self, identifier: str, criteria: SearchCriteria) -> list[NormalizedJob]:
        if not get_settings().demo_mode:
            return []
        return [self.normalize_job(j, identifier) for j in DEMO_JOBS]

    def fetch_job_details(self, identifier: str, external_id: str) -> NormalizedJob | None:
        for j in DEMO_JOBS:
            if j["id"] == external_id:
                return self.normalize_job(j, identifier)
        return None

    def normalize_job(self, raw: dict, identifier: str) -> NormalizedJob:
        base = get_settings().public_base_url.rstrip("/")
        return NormalizedJob(
            source_kind=self.kind,
            external_id=raw["id"],
            company=raw["company"],
            title=raw["title"],
            location=raw["location"],
            workplace_type=raw["workplace"],
            employment_type=raw["type"],
            description_text=raw["description"],
            posted_at=datetime.now(UTC) - timedelta(days=2),
            application_url=f"{base}/mock-portal/apply/{raw['id']}",
            posting_url=f"{base}/mock-portal/jobs/{raw['id']}",
            is_demo=True,
        )
