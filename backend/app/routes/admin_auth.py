import hmac

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, EmailStr

from app.auth import create_access_token, create_admin, decode_token_or_401, find_admin_by_email, get_current_admin, public_admin, revoke_token, verify_password
from app.config import ADMIN_SIGNUP_CODE

router = APIRouter()


class AdminSignupRequest(BaseModel):
    name: str
    email: EmailStr
    password: str
    signup_code: str


class AdminLoginRequest(BaseModel):
    email: EmailStr
    password: str


class AdminAuthResponse(BaseModel):
    token: str
    admin: dict


@router.post("/api/admin/signup", response_model=AdminAuthResponse, status_code=201)
def admin_signup(payload: AdminSignupRequest) -> AdminAuthResponse:
    """Creates a new AfriShield Command Center admin account. 409 if the
    email is already registered. Returns a session token immediately —
    same as logging in right after signing up — so the dashboard doesn't
    need a separate login round-trip post-signup.

    **Requires `signup_code`** matching `ADMIN_SIGNUP_CODE` in
    `backend/.env` — this is a shared invite code the team hands out
    directly (Slack/etc.), not a public registration form. Without
    `ADMIN_SIGNUP_CODE` configured on the server at all, this endpoint is
    disabled outright (503) rather than silently open — an admin console
    that anyone can join by hitting an API is worse than one that's
    temporarily unusable. `403` if the code is present but wrong.

    Minimum password length is 8 characters; there is no other complexity
    rule. Passwords are hashed with bcrypt before ever touching disk (see
    `app/auth.py`) — the raw password is never stored or logged."""
    if not ADMIN_SIGNUP_CODE:
        raise HTTPException(status_code=503, detail="Admin signup is disabled: ADMIN_SIGNUP_CODE is not configured on this server")
    if not hmac.compare_digest(payload.signup_code, ADMIN_SIGNUP_CODE):
        raise HTTPException(status_code=403, detail="Invalid signup code")
    if len(payload.password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters")
    try:
        admin = create_admin(payload.name, payload.email, payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    token = create_access_token(admin)
    return AdminAuthResponse(token=token, admin=public_admin(admin))


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
