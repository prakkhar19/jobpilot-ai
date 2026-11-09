from fastapi import APIRouter

from app.api import (
    agent,
    ai_providers,
    applications,
    auth,
    documents,
    health,
    jobs,
    mock_portal,
    profiles,
    system,
)

router = APIRouter()
for module in (health, auth, profiles, ai_providers, jobs, documents, applications, agent, system, mock_portal):
    router.include_router(module.router)
