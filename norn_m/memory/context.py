"""Context inference and management for memory hierarchy.

This module provides utilities for automatically inferring the context
(scene/scenario) of memories based on metadata, and for managing context
isolation in retrieval.
"""

import re
from typing import Dict, Any, Optional


# Context type definitions
CONTEXT_CHAT = "chat"
CONTEXT_DEBUG_PREFIX = "debug-"
CONTEXT_PROJECT_PREFIX = "project-"
CONTEXT_RELEASE_PREFIX = "release-"
CONTEXT_RESEARCH_PREFIX = "research-"
CONTEXT_PLANNING = "planning"


def infer_context(
    metadata: Dict[str, Any],
    agent_id: Optional[str] = None,
    run_id: Optional[str] = None,
) -> str:
    """Automatically infer the context from metadata, agent_id, and run_id.
    
    Context types:
    - chat: General conversation (default)
    - debug-{id}: Debugging sessions
    - project-{name}: Project-specific work
    - release-{version}: Release/deployment activities
    - research-{topic}: Research and investigation
    - planning: Planning and design sessions
    
    Args:
        metadata: Memory metadata dict
        agent_id: Agent identifier (optional)
        run_id: Run identifier (optional)
    
    Returns:
        Context string (e.g., "project-norn-memory", "debug-abc123")
    """
    # 1. Check if context is explicitly set in metadata
    if metadata and "context" in metadata:
        return str(metadata["context"])
    
    # 2. Infer from agent_id patterns
    if agent_id:
        agent_lower = agent_id.lower()
        
        # Debug sessions
        if "debug" in agent_lower or "troubleshoot" in agent_lower:
            session_id = run_id[:8] if run_id else _extract_id_suffix(agent_id)
            return f"{CONTEXT_DEBUG_PREFIX}{session_id}"
        
        # Release/deployment
        if "release" in agent_lower or "deploy" in agent_lower:
            version = _extract_version(agent_id) or _extract_id_suffix(agent_id)
            return f"{CONTEXT_RELEASE_PREFIX}{version}"
        
        # Research
        if "research" in agent_lower or "investigate" in agent_lower or "scout" in agent_lower:
            topic = _extract_topic(agent_id) or _extract_id_suffix(agent_id)
            return f"{CONTEXT_RESEARCH_PREFIX}{topic}"
        
        # Planning
        if "plan" in agent_lower or "design" in agent_lower or "architect" in agent_lower:
            return CONTEXT_PLANNING
    
    # 3. Infer from project in metadata
    if metadata:
        project = metadata.get("project")
        if project:
            return f"{CONTEXT_PROJECT_PREFIX}{_sanitize_context_name(project)}"
        
        # Check for version/release info
        version = metadata.get("version")
        if version:
            return f"{CONTEXT_RELEASE_PREFIX}{version}"
        
        # Check for issue/ticket references
        issue = metadata.get("issue") or metadata.get("ticket")
        if issue:
            return f"{CONTEXT_DEBUG_PREFIX}{issue}"
    
    # 4. Default to chat
    return CONTEXT_CHAT


def _extract_id_suffix(identifier: str, length: int = 8) -> str:
    """Extract a short suffix from an identifier (e.g., last 8 chars of UUID)."""
    if not identifier:
        return "unknown"
    
    # If it looks like a UUID, take last segment
    if "-" in identifier:
        parts = identifier.split("-")
        return parts[-1][:length]
    
    # Otherwise take last N chars
    return identifier[-length:] if len(identifier) > length else identifier


def _extract_version(text: str) -> Optional[str]:
    """Extract version string from text (e.g., 'v2.0', '1.5.3')."""
    if not text:
        return None
    
    # Match patterns like v2.0, 1.5.3, version-2.0
    patterns = [
        r'v?(\d+\.\d+(?:\.\d+)?)',  # v2.0 or 2.0.1
        r'version[_-]?(\d+[._-]\d+)',  # version-2-0
    ]
    
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(1).replace("_", ".").replace("-", ".")
    
    return None


def _extract_topic(text: str) -> Optional[str]:
    """Extract research topic from text."""
    if not text:
        return None
    
    # Look for patterns like "research-topic" or "investigate-topic"
    patterns = [
        r'research[_-]([a-z0-9_-]+)',
        r'investigate[_-]([a-z0-9_-]+)',
        r'scout[_-]([a-z0-9_-]+)',
    ]
    
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return match.group(1)
    
    return None


def _sanitize_context_name(name: str) -> str:
    """Sanitize context name to valid format (lowercase, alphanumeric + hyphen)."""
    if not name:
        return "unknown"
    
    # Convert to lowercase
    name = name.lower()
    
    # Replace invalid chars with hyphen
    name = re.sub(r'[^a-z0-9_-]+', '-', name)
    
    # Remove leading/trailing hyphens
    name = name.strip('-')
    
    # Limit length
    if len(name) > 50:
        name = name[:50].rstrip('-')
    
    return name or "unknown"


def parse_context(context: str) -> Dict[str, str]:
    """Parse context string into type and identifier.
    
    Args:
        context: Context string (e.g., "project-norn-memory")
    
    Returns:
        Dict with 'type' and 'id' keys
        
    Examples:
        >>> parse_context("project-norn-memory")
        {'type': 'project', 'id': 'norn-memory'}
        
        >>> parse_context("debug-abc123")
        {'type': 'debug', 'id': 'abc123'}
        
        >>> parse_context("chat")
        {'type': 'chat', 'id': None}
    """
    if not context:
        return {"type": "chat", "id": None}
    
    # Check for prefixed contexts
    for prefix in [
        CONTEXT_DEBUG_PREFIX,
        CONTEXT_PROJECT_PREFIX,
        CONTEXT_RELEASE_PREFIX,
        CONTEXT_RESEARCH_PREFIX,
    ]:
        if context.startswith(prefix):
            context_type = prefix.rstrip("-")
            context_id = context[len(prefix):]
            return {"type": context_type, "id": context_id}
    
    # Special cases
    if context == CONTEXT_PLANNING:
        return {"type": "planning", "id": None}
    
    if context == CONTEXT_CHAT:
        return {"type": "chat", "id": None}
    
    # Unknown format, treat as custom
    return {"type": "custom", "id": context}


def get_context_display_name(context: str) -> str:
    """Get human-readable display name for a context.
    
    Args:
        context: Context string
    
    Returns:
        Human-readable name
        
    Examples:
        >>> get_context_display_name("project-norn-memory")
        "Project: norn-memory"
        
        >>> get_context_display_name("debug-abc123")
        "Debug Session: abc123"
    """
    parsed = parse_context(context)
    context_type = parsed["type"]
    context_id = parsed["id"]
    
    type_labels = {
        "chat": "Chat",
        "debug": "Debug Session",
        "project": "Project",
        "release": "Release",
        "research": "Research",
        "planning": "Planning",
        "custom": "Context",
    }
    
    label = type_labels.get(context_type, context_type.title())
    
    if context_id:
        return f"{label}: {context_id}"
    
    return label


def should_cross_context_search(query_context: str, memory_context: str) -> bool:
    """Determine if a memory from a different context should be included in search.
    
    Some contexts should remain isolated (debug sessions), while others
    can be searched across (projects can reference general chat knowledge).
    
    Args:
        query_context: Context of the current search
        memory_context: Context of a candidate memory
    
    Returns:
        True if the memory should be considered, False if it should be filtered
    """
    # Same context always included
    if query_context == memory_context:
        return True
    
    query_parsed = parse_context(query_context)
    memory_parsed = parse_context(memory_context)
    
    query_type = query_parsed["type"]
    memory_type = memory_parsed["type"]
    
    # Chat memories are universally accessible
    if memory_type == "chat":
        return True
    
    # Debug sessions are isolated (don't leak to other contexts)
    if memory_type == "debug":
        return False
    
    # Release memories are isolated to that release
    if memory_type == "release" and query_type != "release":
        return False
    
    # Research can access chat and project contexts
    if query_type == "research":
        return memory_type in ["chat", "project", "planning"]
    
    # Projects can access chat and planning
    if query_type == "project":
        return memory_type in ["chat", "planning"]
    
    # Planning can access chat and projects
    if query_type == "planning":
        return memory_type in ["chat", "project"]
    
    # Default: allow cross-context for flexibility
    return True
