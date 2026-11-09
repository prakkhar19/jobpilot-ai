"""FastAPI application factory."""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.core.config import get_settings
from app.core.errors import DomainError
from app.core.logging import configure_logging
from app.core.middleware import SecurityHeadersMiddleware

log = logging.getLogger(__name__)


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level)
    for d in (settings.uploads_dir, settings.generated_dir, settings.screenshots_dir):
        d.mkdir(parents=True, exist_ok=True)
    settings.secret_key  # noqa: B018 - materialise the secret early (fails fast if misconfigured)

    docs_enabled = settings.environment != "production"
    app = FastAPI(
        title="JobPilot AI API",
        version="0.1.0",
        docs_url="/api/docs" if docs_enabled else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if docs_enabled else None,
    )
    app.add_middleware(SecurityHeadersMiddleware)

    @app.exception_handler(DomainError)
    async def _domain_error(_: Request, exc: DomainError) -> JSONResponse:
        return JSONResponse({"detail": exc.message}, status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [
            {"loc": [str(p) for p in e.get("loc", [])], "msg": e.get("msg", "invalid")} for e in exc.errors()
        ]
        first = errors[0] if errors else {"loc": [], "msg": "Invalid request"}
        field = ".".join(x for x in first["loc"] if x not in ("body", "query", "path"))
        return JSONResponse(
            {"detail": f"{field}: {first['msg']}" if field else first["msg"], "errors": errors}, status_code=422
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        log.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse({"detail": "Internal server error. Check the server logs."}, status_code=500)

    from app.api import router as api_router

    app.include_router(api_router)
    return app


app = create_app()
