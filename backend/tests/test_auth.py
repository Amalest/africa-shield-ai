"""Tests for admin authentication (app/auth.py) — password hashing, JWT
session tokens, and the admins.json roster. This is the security boundary
in front of every /api/admin/* route, so it's worth pinning down."""
import time

import jwt
import pytest
from fastapi import HTTPException

import app.auth as auth


@pytest.fixture(autouse=True)
def isolated_admins_file(tmp_path, monkeypatch):
    """Redirects auth.py's storage to a throwaway file for every test in
    this module, so tests never touch this project's real admins.json."""
    monkeypatch.setattr(auth, "ADMINS_FILE", tmp_path / "admins.json")
    monkeypatch.setattr(auth, "REVOKED_JTIS_FILE", tmp_path / "revoked_jtis.json")


def test_password_hash_round_trips_and_never_stores_plaintext():
    admin = auth.create_admin("Test Admin", "test@example.com", "correct-password")
    assert admin["password_hash"] != "correct-password"
    assert auth.verify_password("correct-password", admin["password_hash"])
    assert not auth.verify_password("wrong-password", admin["password_hash"])


def test_create_admin_rejects_a_duplicate_email():
    auth.create_admin("First", "same@example.com", "password123")
    with pytest.raises(ValueError):
        auth.create_admin("Second", "same@example.com", "password123")


def test_email_lookup_is_case_and_whitespace_insensitive():
    auth.create_admin("Test Admin", "Test@Example.com", "password123")
    assert auth.find_admin_by_email("test@example.com") is not None
    assert auth.find_admin_by_email("  TEST@EXAMPLE.COM  ".strip().lower()) is not None


def test_public_admin_never_leaks_the_password_hash():
    admin = auth.create_admin("Test Admin", "test@example.com", "password123", phone_number="+15551234567")
    public = auth.public_admin(admin)
    assert "password_hash" not in public
    assert public["phone_number"] == "+15551234567"


def test_list_admins_reflects_every_created_admin():
    auth.create_admin("One", "one@example.com", "password123")
    auth.create_admin("Two", "two@example.com", "password123")
    assert {a["email"] for a in auth.list_admins()} == {"one@example.com", "two@example.com"}


def test_access_token_round_trips_to_the_same_admin():
    admin = auth.create_admin("Test Admin", "test@example.com", "password123")
    token = auth.create_access_token(admin)
    payload = auth.decode_token_or_401(f"Bearer {token}")
    assert payload["sub"] == admin["id"]
    assert payload["email"] == admin["email"]


def test_get_current_admin_resolves_a_valid_token_to_the_public_admin():
    admin = auth.create_admin("Test Admin", "test@example.com", "password123")
    token = auth.create_access_token(admin)
    resolved = auth.get_current_admin(f"Bearer {token}")
    assert resolved["email"] == "test@example.com"
    assert "password_hash" not in resolved


def test_missing_authorization_header_is_401():
    with pytest.raises(HTTPException) as exc_info:
        auth.decode_token_or_401(None)
    assert exc_info.value.status_code == 401


def test_malformed_authorization_header_is_401():
    with pytest.raises(HTTPException) as exc_info:
        auth.decode_token_or_401("just-a-raw-token-no-bearer-prefix")
    assert exc_info.value.status_code == 401


def test_garbage_token_is_401():
    with pytest.raises(HTTPException) as exc_info:
        auth.decode_token_or_401("Bearer not-a-real-jwt")
    assert exc_info.value.status_code == 401


def test_expired_token_is_401():
    # Crafted directly with a past `exp`, rather than waiting out
    # TOKEN_LIFETIME, so this test runs instantly.
    expired_payload = {"sub": "some-id", "email": "test@example.com", "jti": "abc", "exp": time.time() - 60}
    expired_token = jwt.encode(expired_payload, auth.ADMIN_JWT_SECRET, algorithm=auth.JWT_ALGORITHM)
    with pytest.raises(HTTPException) as exc_info:
        auth.decode_token_or_401(f"Bearer {expired_token}")
    assert exc_info.value.status_code == 401


def test_logout_revokes_the_token_immediately_even_though_it_hasnt_expired():
    admin = auth.create_admin("Test Admin", "test@example.com", "password123")
    token = auth.create_access_token(admin)
    payload = auth.decode_token_or_401(f"Bearer {token}")  # still valid here

    auth.revoke_token(payload["jti"], payload["exp"])

    with pytest.raises(HTTPException) as exc_info:
        auth.decode_token_or_401(f"Bearer {token}")
    assert exc_info.value.status_code == 401


def test_get_current_admin_401s_if_the_admin_was_deleted_after_the_token_was_issued():
    admin = auth.create_admin("Test Admin", "test@example.com", "password123")
    token = auth.create_access_token(admin)

    auth._write_admins([])  # simulate the admin record being removed

    with pytest.raises(HTTPException) as exc_info:
        auth.get_current_admin(f"Bearer {token}")
    assert exc_info.value.status_code == 401
