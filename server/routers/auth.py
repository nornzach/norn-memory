import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth import (
    consume_refresh_jti,
    create_access_token,
    create_refresh_token,
    decode_token,
    dummy_verify_password,
    hash_password,
    require_auth,
    verify_password,
)
from db import get_db
from models import RefreshTokenJti, User
from rate_limit import limiter
from schemas import MessageResponse

router = APIRouter(prefix="/auth", tags=["auth"])

MIN_PASSWORD_LENGTH = 8


def _require_password_length(password: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters.",
        )


class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class UpdateProfileRequest(BaseModel):
    name: str | None = None
    email: EmailStr | None = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    role: str
    created_at: datetime
    last_login_at: datetime | None = None

    model_config = {"from_attributes": True}


class SessionsResponse(BaseModel):
    active: int


class SignOutOthersRequest(BaseModel):
    refresh_token: str


class SignOutOthersResponse(BaseModel):
    signed_out: int


class SetupStatusResponse(BaseModel):
    needsSetup: bool


@router.get("/setup-status", response_model=SetupStatusResponse)
def setup_status(db: Session = Depends(get_db)):
    count = db.scalar(select(func.count(User.id)))
    return SetupStatusResponse(needsSetup=count == 0)


@router.post("/register", response_model=TokenResponse)
@limiter.limit("5/minute")
def register(request: Request, body: RegisterRequest, db: Session = Depends(get_db)):
    """Create the first admin account. Blocked once any user exists."""
    _require_password_length(body.password)

    if db.scalar(select(func.count(User.id))) > 0:
        raise HTTPException(status_code=403, detail="Registration is closed. An admin account already exists.")

    user = User(
        name=body.name,
        email=body.email,
        password_hash=hash_password(body.password),
        role="admin",
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=403, detail="Registration is closed. An admin account already exists.")
    db.refresh(user)

    return TokenResponse(
        access_token=create_access_token(str(user.id), user.role),
        refresh_token=create_refresh_token(str(user.id), db),
    )


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/minute")
def login(request: Request, body: LoginRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email))
    if user is None:
        dummy_verify_password()
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    user.last_login_at = datetime.now(timezone.utc)
    db.commit()

    return TokenResponse(
        access_token=create_access_token(str(user.id), user.role),
        refresh_token=create_refresh_token(str(user.id), db),
    )


@router.post("/refresh", response_model=TokenResponse)
@limiter.limit("20/minute")
def refresh(request: Request, body: RefreshRequest, db: Session = Depends(get_db)):
    payload = decode_token(body.refresh_token)
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid token type.")

    jti = payload.get("jti")
    if not jti:
        raise HTTPException(status_code=401, detail="Refresh token is no longer valid.")

    user = db.get(User, payload["sub"])
    if user is None:
        raise HTTPException(status_code=401, detail="User not found.")

    consume_refresh_jti(jti, db)

    return TokenResponse(
        access_token=create_access_token(str(user.id), user.role),
        refresh_token=create_refresh_token(str(user.id), db),
    )


@router.get("/me", response_model=UserResponse)
def me(user: User = Depends(require_auth)):
    return user


@router.patch("/me", response_model=UserResponse)
def update_me(
    body: UpdateProfileRequest,
    user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    # require_auth resolves the user in its own short-lived session, so `user` is
    # detached from this request's `db`. Load a session-managed copy to mutate.
    db_user = db.get(User, user.id)
    if db_user is None:
        raise HTTPException(status_code=404, detail="User not found.")

    if body.name is not None and body.name.strip():
        db_user.name = body.name.strip()

    if body.email is not None and body.email != db_user.email:
        collision = db.scalar(select(User).where(User.email == body.email, User.id != db_user.id))
        if collision is not None:
            raise HTTPException(status_code=409, detail="Email is already in use.")
        db_user.email = body.email

    db.commit()
    return db_user


@router.post("/change-password", response_model=MessageResponse)
def change_password(
    body: ChangePasswordRequest,
    user: User = Depends(require_auth),
    db: Session = Depends(get_db),
):
    # require_auth resolves the user in its own short-lived session, so `user` is
    # detached from this request's `db`. Load a session-managed copy to mutate.
    db_user = db.get(User, user.id)
    if db_user is None or not verify_password(body.current_password, db_user.password_hash):
        raise HTTPException(status_code=401, detail="Current password is incorrect.")

    _require_password_length(body.new_password)

    db_user.password_hash = hash_password(body.new_password)
    db.commit()
    return MessageResponse(message="Password updated.")


def _live_sessions(user_id: uuid.UUID):
    """Refresh tokens that can still be exchanged: one per signed-in browser."""
    now = datetime.now(timezone.utc)
    return (
        RefreshTokenJti.user_id == user_id,
        RefreshTokenJti.used_at.is_(None),
        RefreshTokenJti.expires_at > now,
    )


@router.get("/sessions", response_model=SessionsResponse)
def sessions(user: User = Depends(require_auth), db: Session = Depends(get_db)):
    count = db.scalar(select(func.count()).select_from(RefreshTokenJti).where(*_live_sessions(user.id)))
    return SessionsResponse(active=count or 0)


@router.post("/sign-out-others", response_model=SignOutOthersResponse)
def sign_out_others(body: SignOutOthersRequest, user: User = Depends(require_auth), db: Session = Depends(get_db)):
    """Revoke every refresh token except the caller's. Other browsers keep their access token until it expires."""
    payload = decode_token(body.refresh_token)
    if payload.get("type") != "refresh" or payload.get("sub") != str(user.id):
        raise HTTPException(status_code=400, detail="That refresh token does not belong to this account.")
    try:
        keep = uuid.UUID(payload.get("jti", ""))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="That refresh token does not belong to this account.")
    result = db.execute(
        update(RefreshTokenJti)
        .where(*_live_sessions(user.id), RefreshTokenJti.jti != keep)
        .values(used_at=datetime.now(timezone.utc))
    )
    db.commit()
    return SignOutOthersResponse(signed_out=result.rowcount or 0)


@router.post("/logout", response_model=MessageResponse)
def logout(body: RefreshRequest, db: Session = Depends(get_db)):
    """Revoke one refresh token, so a signed-out browser cannot be resumed from a copied cookie."""
    try:
        payload = decode_token(body.refresh_token)
        jti = uuid.UUID(payload.get("jti", ""))
    except (HTTPException, TypeError, ValueError):
        return MessageResponse(message="Signed out.")
    db.execute(
        update(RefreshTokenJti)
        .where(RefreshTokenJti.jti == jti, RefreshTokenJti.used_at.is_(None))
        .values(used_at=datetime.now(timezone.utc))
    )
    db.commit()
    return MessageResponse(message="Signed out.")
