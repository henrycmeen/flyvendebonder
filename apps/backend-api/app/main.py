from __future__ import annotations

import logging
import time
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

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
    response: JSONResponse | None = None

    route = getattr(request.scope.get("route"), "path", None)
    path = request.url.path

    try:
        response = await call_next(request)
        return response
    except Exception as exc:
        request_time = round((time.perf_counter() - started) * 1000, 2)
        status_code = 500
        if isinstance(exc, HTTPException):
            status_code = exc.status_code

        logger.exception(
            "Request feilet",
            extra={
                "method": request.method,
                "path": path,
                "route": route,
                "status_code": status_code,
                "latency_ms": request_time,
            },
        )
        raise
    finally:
        response_time = round((time.perf_counter() - started) * 1000, 2)
        request_id_ctx.reset(token)

        if response is not None:
            response.headers["X-Request-ID"] = request_id
            logger.info(
                "Request ferdig",
                extra={
                    "method": request.method,
                    "path": path,
                    "route": route,
                    "status_code": response.status_code,
                    "latency_ms": response_time,
                },
            )


@app.exception_handler(RequestValidationError)
async def request_validation_error_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    request_id = request_id_ctx.get("-")
    logger.warning(
        "Valideringsfeil",
        extra={
            "method": getattr(_request, "method", None),
            "path": getattr(_request.url, "path", None),
            "errors": exc.errors(),
        },
    )
    headers = {"X-Request-ID": request_id} if request_id is not None else None
    return JSONResponse(
        status_code=422,
        content={
            "status": "error",
            "error_code": "request_validation_error",
            "detail": "Ugyldig input",
            "errors": exc.errors(),
            "request_id": request_id,
        },
        headers=headers,
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, exc: HTTPException) -> JSONResponse:
    request_id = request_id_ctx.get("-")
    status_code = exc.status_code
    logger.warning(
        "HTTP-feil",
        extra={
            "method": getattr(_request, "method", None),
            "path": getattr(_request.url, "path", None),
            "status_code": status_code,
            "detail": exc.detail,
        },
    )
    return JSONResponse(
        status_code=status_code,
        content={"status": "error", "detail": exc.detail, "request_id": request_id},
        headers={"X-Request-ID": request_id},
    )


@app.exception_handler(Exception)
async def global_exception_handler(_request: Request, exc: Exception) -> JSONResponse:
    request_id = request_id_ctx.get("-")
    logger.exception(
        "Unhandled exception",
        extra={
            "method": getattr(_request, "method", None),
            "path": getattr(_request.url, "path", None),
        },
    )

    request_id_header = {"X-Request-ID": request_id} if request_id is not None else None
    return JSONResponse(
        status_code=500,
        content={"status": "error", "detail": "Uventet serverfeil", "request_id": request_id},
        headers=request_id_header,
    )


@app.on_event("startup")
def startup_event() -> None:
    logger.info("Running migrations")
    run_migrations()

    logger.info("Running seed")
    with SessionLocal() as db:
        run_seeding(db)


app.include_router(v1_router, prefix=settings.api_prefix)
