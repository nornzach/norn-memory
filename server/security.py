"""
Security hardening middleware and utilities for Norn-M.

This module provides additional security layers including:
- Security headers
- Rate limiting helpers
- Audit logging
- Input sanitization
"""

import logging
from datetime import datetime
from typing import Optional
from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all responses."""
    
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        
        # Prevent MIME type sniffing
        response.headers["X-Content-Type-Options"] = "nosniff"
        
        # Prevent clickjacking
        response.headers["X-Frame-Options"] = "DENY"
        
        # XSS protection
        response.headers["X-XSS-Protection"] = "1; mode=block"
        
        # HTTPS enforcement (only in production)
        if request.url.scheme == "https":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        
        # Content Security Policy
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'; "  # React needs eval
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: https:; "
            "font-src 'self' data:; "
            "connect-src 'self' https:; "
            "frame-ancestors 'none';"
        )
        
        return response


class AuditLogMiddleware(BaseHTTPMiddleware):
    """Log all API access for security auditing."""
    
    SENSITIVE_ENDPOINTS = [
        "/memories/hierarchy-stats",
        "/memories/.*graph",
        "/exact/",
        "/api-keys/",
    ]
    
    async def dispatch(self, request: Request, call_next):
        # Record request
        user_id = None
        api_key_id = None
        
        # Extract user info from headers if available
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            # Could decode JWT to get user_id
            pass
        
        # Check if this is a sensitive endpoint
        is_sensitive = any(
            request.url.path.startswith(endpoint) or endpoint in request.url.path
            for endpoint in self.SENSITIVE_ENDPOINTS
        )
        
        if is_sensitive:
            logger.info(
                f"AUDIT: {request.method} {request.url.path} "
                f"from {request.client.host if request.client else 'unknown'} "
                f"user={user_id or 'anonymous'}"
            )
        
        # Process request
        response = await call_next(request)
        
        # Log if access was denied
        if response.status_code in [401, 403]:
            logger.warning(
                f"AUDIT: ACCESS_DENIED {request.method} {request.url.path} "
                f"from {request.client.host if request.client else 'unknown'} "
                f"status={response.status_code}"
            )
        
        return response


def sanitize_user_input(text: str, max_length: int = 10000) -> str:
    """Sanitize user input to prevent injection attacks.
    
    Args:
        text: User-provided text
        max_length: Maximum allowed length
    
    Returns:
        Sanitized text
    """
    if not text:
        return ""
    
    # Truncate to max length
    text = text[:max_length]
    
    # Remove null bytes
    text = text.replace("\x00", "")
    
    # Strip control characters (except newline, tab)
    text = "".join(char for char in text if ord(char) >= 32 or char in "\n\t")
    
    return text


def validate_memory_access(
    memory_id: str,
    user_memories: set[str],
    operation: str = "read"
) -> bool:
    """Validate that a user has access to a specific memory.
    
    Args:
        memory_id: ID of the memory being accessed
        user_memories: Set of memory IDs the user owns
        operation: Operation being performed (read, write, delete)
    
    Returns:
        True if access is allowed
        
    Raises:
        ValueError: If access is denied
    """
    if memory_id not in user_memories:
        logger.warning(
            f"SECURITY: Unauthorized {operation} attempt on memory {memory_id}"
        )
        raise ValueError(f"Access denied: You don't have permission to {operation} this memory")
    
    return True


def rate_limit_key(request: Request) -> str:
    """Generate rate limit key from request.
    
    Uses API key if available, otherwise IP address.
    """
    # Try to get API key from Authorization header
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return f"api_key:{auth_header[7:20]}"  # Use first 13 chars of token
    
    # Fall back to IP address
    if request.client:
        return f"ip:{request.client.host}"
    
    return "unknown"


# Recommended rate limits for different endpoint types
RATE_LIMITS = {
    "auth": "10/minute",
    "read": "100/minute",
    "write": "30/minute",
    "admin": "20/minute",
    "hierarchy": "60/minute",
}
