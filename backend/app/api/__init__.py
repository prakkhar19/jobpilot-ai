from fastapi import APIRouter

from app.api import (
    agent,
    ai_providers,
    applications,
    apply_queue,
    auth,
    documents,
    health,
    jobs,
    mock_portal,
    profiles,
    system,
)

router = APIRouter()
for module in (health, auth, profiles, ai_providers, jobs, documents, applications, apply_queue, agent, system, mock_portal):
    router.include_router(module.router)
