"""Conflict detection and resolution for memory hierarchy.

This module detects contradictions between memories and provides
mechanisms for reconciliation, with L0 canonical memories acting
as the source of truth.
"""

import logging
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


# Conflict types
CONFLICT_CONTRADICTION = "contradiction"
CONFLICT_SUPERSEDED = "superseded"
CONFLICT_DUPLICATE = "duplicate"


def detect_conflicts(
    new_memory: Dict[str, Any],
    existing_memories: List[Dict[str, Any]],
    similarity_threshold: float = 0.85,
) -> List[Dict[str, Any]]:
    """Detect potential conflicts between a new memory and existing ones.
    
    Conflicts include:
    - Contradictions (conflicting facts/preferences)
    - Superseded information (old versions)
    - Near-duplicates (similar content)
    
    Args:
        new_memory: New memory dict with 'memory' text and metadata
        existing_memories: List of existing memory dicts
        similarity_threshold: Threshold for considering memories similar (0-1)
    
    Returns:
        List of conflict dicts with type, memory_ids, and details
    """
    conflicts = []
    new_text = new_memory.get("memory", "").lower()
    new_id = new_memory.get("id")
    
    if not new_text or not new_id:
        return conflicts
    
    for existing in existing_memories:
        existing_text = existing.get("memory", "").lower()
        existing_id = existing.get("id")
        
        if not existing_text or not existing_id:
            continue
        
        # Check for contradictions (preference/fact changes)
        if _is_contradiction(new_text, existing_text):
            conflicts.append({
                "type": CONFLICT_CONTRADICTION,
                "new_memory_id": new_id,
                "existing_memory_id": existing_id,
                "new_text": new_memory.get("memory"),
                "existing_text": existing.get("memory"),
                "detected_at": datetime.now(timezone.utc).isoformat(),
            })
        
        # Check for superseded information (explicit updates)
        elif _is_superseded(new_text, existing_text):
            conflicts.append({
                "type": CONFLICT_SUPERSEDED,
                "new_memory_id": new_id,
                "existing_memory_id": existing_id,
                "new_text": new_memory.get("memory"),
                "existing_text": existing.get("memory"),
                "detected_at": datetime.now(timezone.utc).isoformat(),
            })
    
    return conflicts


def _is_contradiction(text1: str, text2: str) -> bool:
    """Check if two texts contain contradictory information.
    
    Detects patterns like:
    - "prefers X" vs "prefers Y" (where X != Y)
    - "uses X" vs "uses Y"
    - "works at X" vs "works at Y"
    """
    # Preference contradictions
    if "prefer" in text1 and "prefer" in text2:
        # Extract what comes after "prefer"
        pref1 = _extract_preference(text1)
        pref2 = _extract_preference(text2)
        if pref1 and pref2 and pref1 != pref2:
            return True
    
    # Tool/technology switches
    if ("use" in text1 or "using" in text1) and ("use" in text2 or "using" in text2):
        tool1 = _extract_tool(text1)
        tool2 = _extract_tool(text2)
        if tool1 and tool2 and tool1 != tool2:
            # Check if they're about the same category
            if _same_category(tool1, tool2):
                return True
    
    # Location/employment changes
    if "work" in text1 and "work" in text2:
        if "at" in text1 and "at" in text2:
            company1 = _extract_after_keyword(text1, "at")
            company2 = _extract_after_keyword(text2, "at")
            if company1 and company2 and company1 != company2:
                return True
    
    return False


def _is_superseded(new_text: str, old_text: str) -> bool:
    """Check if new memory explicitly supersedes old one.
    
    Detects patterns like:
    - "switched from X to Y"
    - "now uses Y instead of X"
    - "changed from X to Y"
    """
    supersession_patterns = [
        "switched from",
        "changed from",
        "moved from",
        "instead of",
        "no longer",
        "stopped using",
        "replaced",
    ]
    
    return any(pattern in new_text for pattern in supersession_patterns)


def _extract_preference(text: str) -> Optional[str]:
    """Extract preference object from text."""
    # Simple extraction: get 1-3 words after "prefer"
    if "prefer" not in text:
        return None
    
    parts = text.split("prefer")
    if len(parts) < 2:
        return None
    
    after = parts[1].strip()
    words = after.split()[:3]
    return " ".join(words).strip(",.!?;:")


def _extract_tool(text: str) -> Optional[str]:
    """Extract tool/technology name from text."""
    # Look for capitalized words or common tech names
    words = text.split()
    for i, word in enumerate(words):
        if word.lower() in ["use", "uses", "using"]:
            if i + 1 < len(words):
                return words[i + 1].strip(",.!?;:")
    return None


def _extract_after_keyword(text: str, keyword: str) -> Optional[str]:
    """Extract text after a keyword."""
    if keyword not in text:
        return None
    
    parts = text.split(keyword)
    if len(parts) < 2:
        return None
    
    after = parts[1].strip()
    words = after.split()[:3]
    return " ".join(words).strip(",.!?;:")


def _same_category(item1: str, item2: str) -> bool:
    """Check if two items belong to the same category."""
    # Programming languages
    languages = {"python", "javascript", "typescript", "java", "go", "rust", "c++", "c#"}
    if item1.lower() in languages and item2.lower() in languages:
        return True
    
    # Editors
    editors = {"vim", "emacs", "vscode", "sublime", "atom", "intellij", "pycharm"}
    if item1.lower() in editors and item2.lower() in editors:
        return True
    
    # Frameworks
    frameworks = {"react", "vue", "angular", "svelte", "django", "flask", "fastapi", "express"}
    if item1.lower() in frameworks and item2.lower() in frameworks:
        return True
    
    return False


def resolve_with_l0(
    conflict: Dict[str, Any],
    l0_memories: List[Dict[str, Any]],
) -> Optional[str]:
    """Resolve conflict using L0 canonical memories as source of truth.
    
    L0 memories represent user-declared principles and ground truth.
    When a conflict involves information that contradicts an L0 memory,
    the L0 memory wins.
    
    Args:
        conflict: Conflict dict
        l0_memories: List of L0 canonical memories
    
    Returns:
        Memory ID to keep, or None if L0 doesn't resolve it
    """
    if not l0_memories:
        return None
    
    new_id = conflict.get("new_memory_id")
    existing_id = conflict.get("existing_memory_id")
    new_text = conflict.get("new_text", "").lower()
    existing_text = conflict.get("existing_text", "").lower()
    
    # Check if either memory aligns with L0
    for l0 in l0_memories:
        l0_text = l0.get("memory", "").lower()
        
        # Simple keyword overlap check
        l0_keywords = set(l0_text.split())
        new_keywords = set(new_text.split())
        existing_keywords = set(existing_text.split())
        
        new_overlap = len(l0_keywords & new_keywords)
        existing_overlap = len(l0_keywords & existing_keywords)
        
        if new_overlap > existing_overlap:
            logger.info(f"L0 resolution: keeping new memory {new_id[:8]} (aligns with L0)")
            return new_id
        elif existing_overlap > new_overlap:
            logger.info(f"L0 resolution: keeping existing memory {existing_id[:8]} (aligns with L0)")
            return existing_id
    
    return None


def resolve_by_recency(conflict: Dict[str, Any]) -> str:
    """Resolve conflict by preferring the more recent memory.
    
    This is the default resolution strategy when L0 doesn't help.
    
    Args:
        conflict: Conflict dict
    
    Returns:
        Memory ID to keep (the newer one)
    """
    # New memory is by definition more recent
    return conflict.get("new_memory_id")


def resolve_by_importance(
    conflict: Dict[str, Any],
    memory_store: Dict[str, Dict[str, Any]],
) -> str:
    """Resolve conflict by preferring the higher-importance memory.
    
    Args:
        conflict: Conflict dict
        memory_store: Dict mapping memory IDs to memory dicts
    
    Returns:
        Memory ID to keep (the more important one)
    """
    new_id = conflict.get("new_memory_id")
    existing_id = conflict.get("existing_memory_id")
    
    new_importance = memory_store.get(new_id, {}).get("importance", 5)
    existing_importance = memory_store.get(existing_id, {}).get("importance", 5)
    
    if new_importance >= existing_importance:
        return new_id
    else:
        return existing_id


def resolve_conflict(
    conflict: Dict[str, Any],
    l0_memories: List[Dict[str, Any]],
    memory_store: Dict[str, Dict[str, Any]],
    strategy: str = "l0_then_recency",
) -> Tuple[str, str]:
    """Resolve a conflict using the specified strategy.
    
    Strategies:
    - l0_then_recency: Try L0, fall back to recency
    - l0_then_importance: Try L0, fall back to importance
    - recency: Always prefer newer
    - importance: Always prefer higher importance
    
    Args:
        conflict: Conflict dict
        l0_memories: List of L0 memories
        memory_store: Dict of all memories
        strategy: Resolution strategy
    
    Returns:
        Tuple of (winner_id, reason)
    """
    if strategy == "l0_then_recency":
        winner = resolve_with_l0(conflict, l0_memories)
        if winner:
            return (winner, "l0_alignment")
        winner = resolve_by_recency(conflict)
        return (winner, "recency")
    
    elif strategy == "l0_then_importance":
        winner = resolve_with_l0(conflict, l0_memories)
        if winner:
            return (winner, "l0_alignment")
        winner = resolve_by_importance(conflict, memory_store)
        return (winner, "importance")
    
    elif strategy == "recency":
        winner = resolve_by_recency(conflict)
        return (winner, "recency")
    
    elif strategy == "importance":
        winner = resolve_by_importance(conflict, memory_store)
        return (winner, "importance")
    
    else:
        # Default to recency
        winner = resolve_by_recency(conflict)
        return (winner, "default_recency")
