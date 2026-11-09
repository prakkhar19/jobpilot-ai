"""Job-search analytics computed from the user's own data."""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AgentConfiguration, Application, Interview, Job, JobMatch, ResumeVersion, User

RESPONDED = {"under_review", "assessment", "interview_scheduled", "interview_completed", "rejected", "offer_received"}
INTERVIEWED = {"interview_scheduled", "interview_completed", "offer_received"}
SUBMITTED = RESPONDED | {"submitted", "withdrawn"}
ROLE_BUCKETS = [
    ("LLM / GenAI", r"\b(llm|genai|generative|gen ai|prompt)\b"), ("AI / ML", r"\b(machine learning|ml|ai|nlp|deep learning|computer vision)\b"),
    ("Data", r"\b(data (engineer|scientist|analyst)|analytics|bi)\b"), ("Frontend", r"\b(front[- ]?end|react|ui)\b"),
    ("Full-stack", r"\bfull[- ]?stack\b"), ("Backend", r"\b(back[- ]?end|python|api|platform)\b"),
    ("DevOps / SRE", r"\b(devops|sre|site reliability|infrastructure)\b"), ("Software (general)", r"\b(software|developer|engineer)\b"),
]


def role_bucket(title: str) -> str:
    t = title.lower()
    for name, pat in ROLE_BUCKETS:
        if re.search(pat, t):
            return name
    return "Other"


def _rate(n: int, d: int) -> float | None:
    return round(100 * n / d, 1) if d else None


def _aware(dt: datetime | None) -> datetime | None:
    return dt if dt is None or dt.tzinfo else dt.replace(tzinfo=UTC)


def summary(db: Session, user: User) -> dict:
    cfg = db.scalar(select(AgentConfiguration).where(AgentConfiguration.user_id == user.id))
    threshold = cfg.min_match_score if cfg else 60
    jobs = db.scalars(select(Job).where(Job.user_id == user.id, Job.duplicate_of_id.is_(None))).all()
    matches = {m.job_id: m for m in db.scalars(select(JobMatch).where(JobMatch.user_id == user.id)).all()}
    apps = db.scalars(select(Application).where(Application.user_id == user.id)).all()
    interviews = db.scalars(select(Interview).where(Interview.user_id == user.id)).all()
    versions = {v.id: v for v in db.scalars(select(ResumeVersion).where(ResumeVersion.user_id == user.id)).all()}
    jobs_by_id = {j.id: j for j in jobs}

    submitted = [a for a in apps if a.status in SUBMITTED]
    responded = [a for a in submitted if a.status in RESPONDED]
    interviewed_ids = {i.application_id for i in interviews} | {a.id for a in apps if a.status in INTERVIEWED}
    interviewed = [a for a in submitted if a.id in interviewed_ids]
    totals = {
        "jobs_discovered": len(jobs),
        "active_jobs": sum(1 for j in jobs if j.status == "active" and not j.hidden),
        "qualified": sum(1 for j in jobs if (m := matches.get(j.id)) and m.overall_score >= threshold),
        "shortlisted": sum(1 for a in apps if a.status != "rejected_by_filter"),
        "prepared": sum(1 for a in apps if a.resume_version_id is not None),
        "pending_approval": sum(1 for a in apps if a.status in ("awaiting_approval", "needs_input")),
        "submitted": len(submitted),
        "interviews": len(interviewed),
        "rejections": sum(1 for a in apps if a.status == "rejected"),
        "offers": sum(1 for a in apps if a.status == "offer_received"),
        "response_rate": _rate(len(responded), len(submitted)),
        "interview_rate": _rate(len(interviewed), len(submitted)),
        "threshold": threshold,
    }

    def breakdown(key_fn) -> list[dict]:  # noqa: ANN001
        groups: dict[str, dict] = defaultdict(lambda: {"applications": 0, "submitted": 0, "responses": 0, "interviews": 0, "offers": 0})
        for a in apps:
            k = key_fn(a)
            if k is None:
                continue
            g = groups[k]
            g["applications"] += 1
            if a.status in SUBMITTED:
                g["submitted"] += 1
                g["responses"] += a.status in RESPONDED
                g["interviews"] += a.id in interviewed_ids
                g["offers"] += a.status == "offer_received"
        rows = [{"key": k, **v, "response_rate": _rate(v["responses"], v["submitted"]),
                 "interview_rate": _rate(v["interviews"], v["submitted"])} for k, v in groups.items()]
        return sorted(rows, key=lambda r: (-r["submitted"], -r["applications"]))[:15]

    def job_of(a: Application) -> Job | None:
        return jobs_by_id.get(a.job_id)

    by_source = breakdown(lambda a: job_of(a).source_kind if job_of(a) else None)
    by_role = breakdown(lambda a: role_bucket(job_of(a).title) if job_of(a) else None)
    by_company = breakdown(lambda a: job_of(a).company if job_of(a) else None)
    by_resume = breakdown(lambda a: (f"{versions[a.resume_version_id].template} · {versions[a.resume_version_id].generation_method}"
                                     if a.resume_version_id in versions else None))

    now = datetime.now(UTC)
    weeks: list[dict] = []
    for i in range(11, -1, -1):
        start = (now - timedelta(days=now.weekday(), weeks=i)).replace(hour=0, minute=0, second=0, microsecond=0)
        end = start + timedelta(days=7)
        weeks.append({
            "week": start.date().isoformat(),
            "discovered": sum(1 for j in jobs if start <= _aware(j.discovered_at) < end),
            "submitted": sum(1 for a in apps if a.submitted_at and start <= _aware(a.submitted_at) < end),
            "interviews": sum(1 for iv in interviews if iv.scheduled_at and start <= _aware(iv.scheduled_at) < end),
        })
    funnel = [
        {"stage": "Discovered", "count": totals["jobs_discovered"]},
        {"stage": "Qualified", "count": totals["qualified"]},
        {"stage": "Prepared", "count": totals["prepared"]},
        {"stage": "Submitted", "count": totals["submitted"]},
        {"stage": "Interviews", "count": totals["interviews"]},
        {"stage": "Offers", "count": totals["offers"]},
    ]
    status_counts: dict[str, int] = defaultdict(int)
    for a in apps:
        status_counts[a.status] += 1
    insights = []
    best_role = max((r for r in by_role if r["submitted"] >= 3 and r["response_rate"] is not None),
                    key=lambda r: r["response_rate"], default=None)
    if best_role:
        insights.append(f"'{best_role['key']}' roles have your best response rate ({best_role['response_rate']}%).")
    best_resume = max((r for r in by_resume if r["submitted"] >= 3 and r["response_rate"] is not None),
                      key=lambda r: r["response_rate"], default=None)
    if best_resume:
        insights.append(f"Resumes generated as '{best_resume['key']}' perform best ({best_resume['response_rate']}% response).")
    if totals["submitted"] and totals["submitted"] < 5:
        insights.append("Too few submissions for reliable statistics yet — rates will stabilise after ~10 applications.")
    return {
        "totals": totals, "funnel": funnel, "weekly": weeks, "status_counts": dict(status_counts),
        "by_source": by_source, "by_role": by_role, "by_company": by_company, "by_resume": by_resume,
        "insights": insights,
        "disclaimer": "Match scores and statistics are guidance only; no score guarantees an interview or offer.",
    }


def weekly_report(db: Session, user: User) -> dict:
    since = datetime.now(UTC) - timedelta(days=7)
    jobs = db.scalars(select(Job).where(Job.user_id == user.id, Job.discovered_at >= since, Job.duplicate_of_id.is_(None))).all()
    apps = db.scalars(select(Application).where(Application.user_id == user.id)).all()
    submitted = [a for a in apps if a.submitted_at and _aware(a.submitted_at) >= since]
    progressed = [a for a in apps if _aware(a.updated_at) >= since and a.status in RESPONDED]
    pending = [a for a in apps if a.status in ("awaiting_approval", "needs_input")]
    text = (f"In the last 7 days: {len(jobs)} new job(s) discovered, {len(submitted)} application(s) submitted, "
            f"{len(progressed)} status update(s) from employers. {len(pending)} application(s) await your review.")
    return {"since": since.isoformat(), "discovered": len(jobs), "submitted": len(submitted),
            "responses": len(progressed), "pending": len(pending), "text": text}
