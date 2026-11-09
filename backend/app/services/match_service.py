"""Batch matching for a user's jobs (shared corpus for TF-IDF, optional embeddings)."""

from __future__ import annotations

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.adapters.llm.base import LLMError, untrusted
from app.core.errors import DomainError
from app.models import AgentConfiguration, Job, JobMatch, User
from app.services.jd_analysis import analyze_job
from app.services.llm_service import get_runner
from app.services.matching import (
    RECOMMENDATION_TEXT,
    TfidfModel,
    candidate_facts,
    compute_and_store,
    cosine_dense,
)
from app.services.profiles import get_active_profile

log = logging.getLogger(__name__)


def get_prefs(db: Session, user: User) -> AgentConfiguration:
    cfg = db.scalar(select(AgentConfiguration).where(AgentConfiguration.user_id == user.id))
    if cfg is None:
        cfg = AgentConfiguration(user_id=user.id)
        db.add(cfg)
        db.flush()
    return cfg


def match_jobs(db: Session, user: User, job_ids: list[uuid.UUID] | None = None, *, use_embeddings: bool = True) -> list[JobMatch]:
    profile = get_active_profile(db, user)
    if profile is None:
        raise DomainError("Approve your candidate profile before matching jobs.", status_code=409)
    prefs = get_prefs(db, user)
    q = select(Job).where(Job.user_id == user.id, Job.status != "expired", Job.duplicate_of_id.is_(None))
    if job_ids:
        q = q.where(Job.id.in_(job_ids))
    jobs = db.scalars(q).all()
    if not jobs:
        return []
    for j in jobs:
        if j.analyzed_at is None or not j.requirements:
            analyze_job(db, j)
    facts = candidate_facts(profile)
    corpus = [j.description_text for j in db.scalars(select(Job).where(Job.user_id == user.id).limit(500)).all()]
    tfidf = TfidfModel(corpus + [facts.text])

    sims: dict[uuid.UUID, float] = {}
    if use_embeddings and prefs.use_llm:
        runner = get_runner(db, user)
        if runner is not None:
            try:
                vectors = runner.embed([facts.text[:6000]] + [f"{j.title}\n{j.description_text[:6000]}" for j in jobs])
                if vectors and len(vectors) == len(jobs) + 1:
                    sims = {j.id: cosine_dense(vectors[0], v) for j, v in zip(jobs, vectors[1:], strict=True)}
            except LLMError as exc:
                log.info("Embeddings unavailable, using TF-IDF", extra={"ctx": {"error": str(exc)}})
    out = [compute_and_store(db, j, profile, prefs=prefs, facts=facts, tfidf=tfidf, embedding_similarity=sims.get(j.id))
           for j in jobs]
    db.commit()
    return out


_SUMMARY_SYSTEM = """You assess job fit for a candidate. Use only the provided candidate facts and job posting.
Be honest and specific. Missing information in the candidate facts means "not stated", not "lacking".
Write 3-5 sentences: overall fit, strongest matches, important gaps, and whether to apply. No lists."""


def ai_match_summary(db: Session, user: User, job: Job) -> str:
    runner = get_runner(db, user)
    if runner is None:
        raise DomainError("Configure an AI provider (Integrations) to get an AI explanation.", status_code=409)
    profile = get_active_profile(db, user)
    if profile is None:
        raise DomainError("Approve your candidate profile first.", status_code=409)
    match = db.scalar(select(JobMatch).where(JobMatch.user_id == user.id, JobMatch.job_id == job.id))
    if match is None:
        match = match_jobs(db, user, [job.id], use_embeddings=False)[0]
    facts = candidate_facts(profile)
    prompt = (f"Computed score: {match.overall_score:.0f}/100 ({RECOMMENDATION_TEXT[match.recommendation]})\n"
              f"Strengths: {match.strengths}\nGaps: {match.gaps}\n\nCandidate facts:\n{facts.text[:6000]}\n\n"
              f"Job: {job.title} at {job.company}\n{untrusted('job_posting', job.description_text, 8000)}")
    try:
        result = runner.complete(_SUMMARY_SYSTEM, prompt, max_tokens=1200)
    except LLMError as exc:
        raise DomainError(f"AI provider error: {exc}", status_code=502) from exc
    match.llm_summary = result.text.strip()[:3000]
    db.commit()
    return match.llm_summary
