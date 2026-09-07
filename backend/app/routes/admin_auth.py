from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr

from app.auth import create_access_token, create_admin, find_admin_by_email, get_current_admin, public_admin, verify_password

router = APIRouter()


class AdminSignupRequest(BaseModel):
    name: str
    email: EmailStr
    password: str


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

    Minimum password length is 8 characters; there is no other complexity
    rule. Passwords are hashed with bcrypt before ever touching disk (see
    `app/auth.py`) — the raw password is never stored or logged."""
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
