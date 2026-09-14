"""Centralized environment configuration.

Loads `.env` (see `.env.example` for the expected keys) via python-dotenv
if one exists, so local dev doesn't require exporting shell vars. Real
environment variables (e.g. set by CI or a hosting platform) always take
precedence over anything in `.env`.
"""
import os
import secrets

from dotenv import load_dotenv

load_dotenv()

AT_USERNAME = os.environ.get("AT_USERNAME")
AT_API_KEY = os.environ.get("AT_API_KEY")
AT_SENDER_ID = os.environ.get("AT_SENDER_ID")  # optional — sandbox uses a default if unset
AT_VOICE_NUMBER = os.environ.get("AT_VOICE_NUMBER")  # required only for voice calls, not SMS/USSD

# Path to a Firebase service-account JSON file (Project Settings > Service
# Accounts > Generate new private key, in the Firebase console). Optional —
# push notifications simulate/skip cleanly without it, same pattern as the
# Africa's Talking vars above. See app/models/push_gateway.py.
FIREBASE_SERVICE_ACCOUNT_JSON = os.environ.get("FIREBASE_SERVICE_ACCOUNT_JSON")

# Signs/verifies admin JWT session tokens (see app/auth.py). Unlike the
# vars above, auth can't "simulate" without a secret — it always needs
# one to function at all, but a *wrong* default here is worse than no
# default: a fixed, publicly-known secret (the old behavior) lets anyone
# who has read this repo's source forge a valid admin token. Instead,
# generate a real random secret once per process start if `.env` doesn't
# set one. Cost: admin sessions don't survive a server restart (everyone
# has to log in again) — a usability tradeoff, not a security one; set a
# real persistent value in `.env` to avoid it, not because the generated
# one is weak.
ADMIN_JWT_SECRET = os.environ.get("ADMIN_JWT_SECRET") or secrets.token_hex(32)
_ADMIN_JWT_SECRET_IS_EPHEMERAL = not os.environ.get("ADMIN_JWT_SECRET")

# Shared code required by POST /api/admin/signup — but only for creating
# the very first admin account on a fresh deployment; see app/auth.py and
# app/routes/admin_auth.py. That route is permanently locked (403) once
# any admin exists, so this code stops mattering after the team's first
# account is created. Disabled entirely (503) until this is set. Give
# this value to teammates directly (Slack/etc.), never commit it.
ADMIN_SIGNUP_CODE = os.environ.get("ADMIN_SIGNUP_CODE")

# HTTP Basic Auth credentials for POST /api/ussd (Africa's Talking lets
# you embed user:pass@ directly in a webhook URL). Optional — matches the
# rest of this file's "real when configured" pattern; unset means the
# webhook stays open, which is fine for the documented local curl-testing
# workflow but should be set before pointing a real USSD channel at this
# publicly.
USSD_WEBHOOK_USERNAME = os.environ.get("USSD_WEBHOOK_USERNAME")
USSD_WEBHOOK_PASSWORD = os.environ.get("USSD_WEBHOOK_PASSWORD")

# Comma-separated list of allowed browser origins for CORS (e.g.
# "https://afrishield-dashboard.example.com,http://localhost:5173").
# Defaults to "*" (any origin) for local development if unset — see the
# startup warning in app/main.py.
CORS_ALLOWED_ORIGINS = os.environ.get("CORS_ALLOWED_ORIGINS")
