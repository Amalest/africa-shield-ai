import math
import sys

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import CORS_ALLOWED_ORIGINS
from app.routes import admin_auth, admin_reports, alerts, hazard_reports, push_tokens, regions, risk, sensors, subscribers, ussd, voice

app = FastAPI(
    title="Africa Shield AI - Last-Mile Alert API",
    description=(
        "Flood risk scoring and early-warning alerts for the AI for All Hackathon "
        "demo. Risk scoring and translation are real (rules-based, not ML) — see "
        "docs/architecture.md. POST /api/alerts/send sends a real SMS or voice call "
        "via Africa's Talking when the matching credentials are configured (see "
        ".env.example), and clearly labels the send as simulated otherwise. "
        "POST /api/ussd is a USSD webhook (check risk / subscribe / unsubscribe); "
        "POST /api/voice/callback is the webhook Africa's Talking calls when a "
        "voice alert is answered, to read the alert aloud. POST /api/sensor-reading "
        "ingests a live reading from a registered ESP32 flood sensor (or its Wokwi "
        "simulation) and scores it the same way /api/risk-check does. "
        "POST /api/hazard-reports lets a citizen report a hazard they're seeing or "
        "flag that they need help; GET /api/hazard-reports lists what's come in. "
        "POST /api/hazard-reports/{id}/photo attaches a photo to a report; "
        "GET /api/hazard-reports/{id}/photo serves it back. "
        "POST /api/push-tokens registers a device for real push notifications "
        "(Firebase Cloud Messaging) alongside SMS/voice, when configured — see "
        ".env.example; DELETE /api/push-tokens/{token} unregisters one. "
        "POST /api/subscribers/verify/request sends a one-time code to a phone "
        "number (real SMS if configured, returned directly in the response if not); "
        "POST /api/subscribers (requires that code) registers a phone number for "
        "SMS/voice alerts for a region (the smartphone-app equivalent of the USSD "
        "'Subscribe' menu); DELETE /api/subscribers/{phone_number} (also requires "
        "a fresh code) unregisters one — both require proof of phone ownership so "
        "nobody can subscribe or unsubscribe a number that isn't theirs. "
        "POST /api/admin/signup (requires a shared ADMIN_SIGNUP_CODE) and "
        "POST /api/admin/login create/authenticate an AfriShield Admin Command "
        "Center account, returning a bearer token; every /api/admin/* route below "
        "requires it. POST /api/admin/logout revokes the calling token immediately. "
        "GET /api/admin/dashboard/stats, "
        "GET /api/admin/incidents/prioritized (AI triage, ranked, with an "
        "explainable factor breakdown), GET /api/admin/incidents/map, "
        "PATCH /api/admin/incidents/{id}/status, POST /api/admin/incidents/{id}/verify, "
        "GET /api/admin/assistance-requests, "
        "POST /api/admin/assistance-requests/{id}/assign, "
        "POST /api/admin/incidents/{id}/response (sms/voice/radio/community_leader), "
        "and GET /api/admin/incidents/{id}/responses cover incident management for "
        "the admin dashboard, built on top of the same hazard-report records as "
        "POST/GET /api/hazard-reports above."
    ),
    version="0.1.0",
)

# Restrict to CORS_ALLOWED_ORIGINS (comma-separated) when set — see
# app/config.py. Falls back to "*" (any origin) for local hackathon
# development if unset, since the dashboard's deployed URL isn't fixed
# yet; a wildcard here means any website can read responses from every
# public GET endpoint, including hazard-report GPS/needs_assistance data.
if CORS_ALLOWED_ORIGINS:
    _allowed_origins = [origin.strip() for origin in CORS_ALLOWED_ORIGINS.split(",") if origin.strip()]
else:
    _allowed_origins = ["*"]
    print(
        "NOTE: CORS_ALLOWED_ORIGINS is unset — allowing requests from any origin. "
        "Set it to your dashboard's real URL(s) before a real deployment.",
        file=sys.stderr,
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(risk.router)
app.include_router(regions.router)
app.include_router(alerts.router)
app.include_router(ussd.router)
app.include_router(voice.router)
app.include_router(sensors.router)
app.include_router(hazard_reports.router)
app.include_router(push_tokens.router)
app.include_router(subscribers.router)
app.include_router(admin_auth.router)
app.include_router(admin_reports.router)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    """FastAPI's default 422 handler echoes the rejected value back in
    each error's "input" field. If that value is a non-finite float
    (NaN/Infinity — rejected by the `allow_inf_nan=False` field
    constraints on request bodies), Starlette's JSONResponse enforces
    strict JSON and crashes with a 500 trying to render the *error*
    response itself. Stringify any non-finite float before it gets there
    so the client gets a clean 422 instead."""
    errors = exc.errors()
    for error in errors:
        value = error.get("input")
        if isinstance(value, float) and not math.isfinite(value):
            error["input"] = str(value)
    return JSONResponse(status_code=422, content={"detail": errors})


@app.get("/")
def root() -> dict:
    return {
        "service": "Africa Shield AI backend",
        "docs": "/docs",
        "endpoints": [
            "/api/risk-check",
            "/api/regions",
            "/api/alerts",
            "/api/alerts/send",
            "/api/ussd",
            "/api/voice/callback",
            "/api/sensor-reading",
            "/api/hazard-reports",
            "/api/hazard-reports/{id}",
            "/api/hazard-reports/{id}/photo",
            "/api/push-tokens",
            "/api/subscribers/verify/request",
            "/api/subscribers",
            "/api/admin/signup",
            "/api/admin/login",
            "/api/admin/logout",
            "/api/admin/me",
            "/api/admin/dashboard/stats",
            "/api/admin/incidents/prioritized",
            "/api/admin/incidents/map",
            "/api/admin/incidents/{id}/status",
            "/api/admin/incidents/{id}/verify",
            "/api/admin/incidents/{id}/response",
            "/api/admin/incidents/{id}/responses",
            "/api/admin/assistance-requests",
            "/api/admin/assistance-requests/{id}/assign",
        ],
    }
