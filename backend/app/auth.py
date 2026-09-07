"""Admin authentication: password hashing, JWT session tokens, and the
`admins.json` roster.

Follows the same "own this layer, don't half-fake it" standard as the rest
of the backend — passwords are real bcrypt hashes (never stored or logged
in plaintext), and tokens are real signed JWTs (HS256), not a stub. What's
*not* production-grade yet is called out explicitly below rather than left
implicit: see `ADMIN_JWT_SECRET` in `app/config.py`.

`admins.json` lives in `app/data/`, gitignored like `hazard_reports.json` —
it holds password hashes, so it must never be committed, seed data or not.
"""
import json
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import bcrypt
import jwt
from fastapi import Header, HTTPException

from app.config import ADMIN_JWT_SECRET

ADMINS_FILE = Path(__file__).resolve().parent / "data" / "admins.json"

JWT_ALGORITHM = "HS256"
TOKEN_LIFETIME = timedelta(hours=24)

if ADMIN_JWT_SECRET == "afrishield-hackathon-demo-secret-change-me":
    print(
        "WARNING: ADMIN_JWT_SECRET is unset — using the built-in demo secret. "
        "Admin session tokens are forgeable by anyone who reads this repo's "
        "source. Set a real ADMIN_JWT_SECRET in backend/.env before any real "
        "deployment.",
        file=sys.stderr,
    )


def _read_admins() -> list[dict]:
    if not ADMINS_FILE.exists():
        return []
    return json.loads(ADMINS_FILE.read_text(encoding="utf-8"))


def _write_admins(admins: list[dict]) -> None:
    ADMINS_FILE.write_text(json.dumps(admins, indent=2), encoding="utf-8")


def find_admin_by_email(email: str) -> dict | None:
    email = email.strip().lower()
    return next((a for a in _read_admins() if a["email"] == email), None)


def find_admin_by_id(admin_id: str) -> dict | None:
    return next((a for a in _read_admins() if a["id"] == admin_id), None)


def create_admin(name: str, email: str, password: str) -> dict:
    """Raises ValueError if the email is already registered."""
    email = email.strip().lower()
    if find_admin_by_email(email) is not None:
        raise ValueError(f"An admin with email {email} already exists")

    admin = {
        "id": uuid.uuid4().hex,
        "name": name,
        "email": email,
        "password_hash": bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8"),
        "created_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    admins = _read_admins()
    admins.append(admin)
    _write_admins(admins)
    return admin


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def create_access_token(admin: dict) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": admin["id"],
        "email": admin["email"],
        "iat": now,
        "exp": now + TOKEN_LIFETIME,
    }
    return jwt.encode(payload, ADMIN_JWT_SECRET, algorithm=JWT_ALGORITHM)


def public_admin(admin: dict) -> dict:
    """Strips `password_hash` before an admin record ever leaves the
    server — every response/route in this module must go through this,
    never return a raw admin dict."""
    return {"id": admin["id"], "name": admin["name"], "email": admin["email"], "created_at": admin["created_at"]}


def get_current_admin(authorization: str | None = Header(default=None)) -> dict:
    """FastAPI dependency — require `Authorization: Bearer <token>` on any
    admin-only route. Raises 401 on a missing header, an invalid/expired
    token, or a token for an admin that no longer exists (e.g. deleted
    directly from `admins.json`)."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload = jwt.decode(token, ADMIN_JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired, please log in again")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

    admin = find_admin_by_id(payload["sub"])
    if admin is None:
        raise HTTPException(status_code=401, detail="Admin account no longer exists")
    return public_admin(admin)
