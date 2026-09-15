import hmac

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, EmailStr

from app.auth import create_access_token, create_admin, decode_token_or_401, find_admin_by_email, get_current_admin, list_admins, public_admin, revoke_token, verify_password
from app.config import ADMIN_SIGNUP_CODE

router = APIRouter()


class AdminBootstrapRequest(BaseModel):
    name: str
    email: EmailStr
    password: str
    phone_number: str | None = None
    signup_code: str


class CreateAdminRequest(BaseModel):
    name: str
    email: EmailStr
    password: str
    phone_number: str | None = None


class AdminLoginRequest(BaseModel):
    email: EmailStr
    password: str


class AdminAuthResponse(BaseModel):
    token: str
    admin: dict


@router.post("/api/admin/signup", response_model=AdminAuthResponse, status_code=201)
def bootstrap_first_admin(payload: AdminBootstrapRequest) -> AdminAuthResponse:
    """One-time bootstrap for the very first admin account on a fresh
    deployment — before any admin exists, there's nobody who could invite
    one via `POST /api/admin/admins`.

    **Permanently locked (403) the moment even one admin account
    exists.** This is intentionally NOT a general-purpose signup form: an
    admin console anyone can join by hitting a public API is worse than
    one where every account is created by someone already inside it. Once
    the team's first account is created, every admin after that is added
    via `POST /api/admin/admins` (requires an existing admin's session),
    never through this route again.

    Still requires `signup_code` matching `ADMIN_SIGNUP_CODE` in
    `backend/.env` even for this one-time use, so a fresh deployment with
    zero admins yet isn't wide open to the whole internet during that
    narrow window. `503` if `ADMIN_SIGNUP_CODE` isn't configured at all;
    `403` if the code is present but wrong, or if an admin already
    exists.

    Minimum password length is 8 characters; there is no other complexity
    rule. Passwords are hashed with bcrypt before ever touching disk (see
    `app/auth.py`) — the raw password is never stored or logged."""
    if list_admins():
        raise HTTPException(
            status_code=403,
            detail="Admin signup is closed — an admin account already exists. Ask an existing admin to create your account.",
        )
    if not ADMIN_SIGNUP_CODE:
        raise HTTPException(status_code=503, detail="Admin signup is disabled: ADMIN_SIGNUP_CODE is not configured on this server")
    if not hmac.compare_digest(payload.signup_code, ADMIN_SIGNUP_CODE):
        raise HTTPException(status_code=403, detail="Invalid signup code")
    if len(payload.password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")
    admin = create_admin(payload.name, payload.email, payload.password, payload.phone_number)
    token = create_access_token(admin)
    return AdminAuthResponse(token=token, admin=public_admin(admin))


@router.get("/api/admin/admins")
def list_admin_accounts(current_admin: dict = Depends(get_current_admin)) -> list[dict]:
    """Every admin account on this deployment (for a "Manage Admins"
    settings panel) — requires an existing admin session, same as every
    other `/api/admin/*` route."""
    return [public_admin(a) for a in list_admins()]


@router.post("/api/admin/admins", status_code=201)
def create_admin_account(payload: CreateAdminRequest, current_admin: dict = Depends(get_current_admin)) -> dict:
    """Creates another admin account — this is how the team adds a new
    operator, not a public registration form; only someone already
    signed in can invite the next person. Deliberately does **not**
    return a session token for the new account (unlike the bootstrap
    route above): handing the inviter a working token for someone else's
    account would let them act as that admin before its owner ever logs
    in. The new admin logs in themselves with the password they were
    given out-of-band (Slack, in person, etc.).

    `phone_number` is how this admin gets notified when a sensor-
    triggered alert needs review — see `app/routes/pending_alerts.py`.
    Optional, but an admin with no phone on file won't get that nudge."""
    if len(payload.password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")
    try:
        admin = create_admin(payload.name, payload.email, payload.password, payload.phone_number)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return public_admin(admin)


@router.post("/api/admin/login", response_model=AdminAuthResponse)
def admin_login(payload: AdminLoginRequest) -> AdminAuthResponse:
    """Logs in an existing admin. 401 on a wrong email or password —
    deliberately the same error either way, so a caller can't use this
    endpoint to probe which emails are registered."""
    admin = find_admin_by_email(payload.email)
    if admin is None or not verify_password(payload.password, admin["password_hash"]):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    token = create_access_token(admin)
    return AdminAuthResponse(token=token, admin=public_admin(admin))


@router.get("/api/admin/me")
def admin_me(current_admin: dict = Depends(get_current_admin)) -> dict:
    """Returns the profile of whoever the bearer token belongs to — lets
    the dashboard verify a stored token is still valid and show "logged in
    as X" without re-sending credentials."""
    return current_admin


@router.post("/api/admin/logout")
def admin_logout(authorization: str | None = Header(default=None)) -> dict:
    """Revokes the calling token immediately (adds its `jti` to
    `app/data/revoked_jtis.json`), rather than leaving a "logged out"
    token usable until its natural 24h expiry. Uses `decode_token_or_401`
    directly rather than `Depends(get_current_admin)` since it needs the
    raw `jti`/`exp` claims, not the resulting admin profile. An
    already-expired token gets the normal 401 here too — there's nothing
    to revoke that `jwt.decode` wouldn't already reject on its own."""
    payload = decode_token_or_401(authorization)
    revoke_token(payload["jti"], payload["exp"])
    return {"logged_out": True}
