from __future__ import annotations

import logging
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from .api.v1 import router as v1_router
from .config import get_settings
from .database import SessionLocal, run_migrations
from .logging_utils import configure_logging, request_id_ctx
from .services.seeding import run_seeding

settings = get_settings()
configure_logging(settings.log_level)
logger = logging.getLogger(__name__)

app = FastAPI(title=settings.app_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)


@app.middleware("http")
async def request_context_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    token = request_id_ctx.set(request_id)

    started = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - started) * 1000

    response.headers["X-Request-ID"] = request_id
    logger.info(
        "%s %s -> %s (%.1f ms)",
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
    )

    request_id_ctx.reset(token)
    return response


@app.on_event("startup")
def startup_event() -> None:
    logger.info("Running migrations")
    run_migrations()

    logger.info("Running seed")
    with SessionLocal() as db:
        run_seeding(db)


app.include_router(v1_router, prefix=settings.api_prefix)
