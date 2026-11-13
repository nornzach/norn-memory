"""Memory hierarchy layer definitions and weight calculations.

This module defines the five-layer memory pyramid and provides functions
for calculating memory weights based on recency, importance, and layer.
"""

from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Optional


class MemoryLayer(str, Enum):
    """Five-layer memory pyramid from most stable to most transient."""
    
    L0_CANONICAL = "L0"  # Canonical truths, user-declared principles
    L1_CORE = "L1"       # Core semantic: stable facts, preferences, skills
    L2_EPISODIC = "L2"   # Episodic: specific events with time/place context
    L3_WORKING = "L3"    # Working memory: current task context
    L4_TRANSIENT = "L4"  # Transient buffer: temporary states, most discarded


# Base weight for each layer (0-10 scale)
LAYER_BASE_WEIGHTS = {
    MemoryLayer.L0_CANONICAL: 10.0,
    MemoryLayer.L1_CORE: 8.0,
    MemoryLayer.L2_EPISODIC: 5.0,
    MemoryLayer.L3_WORKING: 2.5,
    MemoryLayer.L4_TRANSIENT: 1.0,
}

# Decay factor per hour (exponential decay)
# decay^hours_since_access = recency_multiplier
LAYER_DECAY_FACTORS = {
    MemoryLayer.L0_CANONICAL: 1.0,      # Never decays
    MemoryLayer.L1_CORE: 0.999967,      # Half-life ~90 days (2160 hours)
    MemoryLayer.L2_EPISODIC: 0.999031,  # Half-life ~30 days (720 hours)
    MemoryLayer.L3_WORKING: 0.990643,   # Half-life ~3 days (72 hours)
    MemoryLayer.L4_TRANSIENT: 0.500000, # Half-life ~1 hour
}

# For display and sorting
LAYER_RANKS = {
    MemoryLayer.L0_CANONICAL: 5,
    MemoryLayer.L1_CORE: 4,
    MemoryLayer.L2_EPISODIC: 3,
    MemoryLayer.L3_WORKING: 2,
    MemoryLayer.L4_TRANSIENT: 1,
}

# Retention policies: archive or delete after this many days of inactivity
LAYER_RETENTION_DAYS = {
    MemoryLayer.L0_CANONICAL: None,  # Never
    MemoryLayer.L1_CORE: None,       # Never
    MemoryLayer.L2_EPISODIC: 180,    # 6 months
    MemoryLayer.L3_WORKING: 30,      # 1 month
    MemoryLayer.L4_TRANSIENT: 7,     # 1 week
}


def calculate_recency(last_accessed_at: datetime, now: Optional[datetime] = None, layer: MemoryLayer = MemoryLayer.L3_WORKING) -> float:
    """Calculate recency multiplier based on time since last access.
    
    Args:
        last_accessed_at: When the memory was last accessed
        now: Current time (defaults to now)
        layer: Memory layer (determines decay rate)
    
    Returns:
        Recency multiplier in range [0, 1], where 1 is most recent
    """
    if now is None:
        now = datetime.now(timezone.utc)
    
    # Ensure timezone aware
    if last_accessed_at.tzinfo is None:
        last_accessed_at = last_accessed_at.replace(tzinfo=timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    
    hours_since_access = (now - last_accessed_at).total_seconds() / 3600.0
    
    # L0 canonical memories never decay
    if layer == MemoryLayer.L0_CANONICAL:
        return 1.0
    
    decay_factor = LAYER_DECAY_FACTORS[layer]
    recency = decay_factor ** hours_since_access
    
    return max(0.0, min(1.0, recency))


def calculate_weight(
    layer: MemoryLayer,
    importance: float,
    last_accessed_at: datetime,
    now: Optional[datetime] = None,
) -> float:
    """Calculate the current weight of a memory.
    
    Weight = base_weight × (importance / 10) × recency
    
    Args:
        layer: Memory layer
        importance: Importance score (1-10)
        last_accessed_at: When memory was last accessed
        now: Current time (defaults to now)
    
    Returns:
        Weight score, typically in range [0, 10]
    """
    base_weight = LAYER_BASE_WEIGHTS[layer]
    importance_normalized = importance / 10.0
    recency = calculate_recency(last_accessed_at, now, layer)
    
    return base_weight * importance_normalized * recency


def assign_initial_layer(importance: float) -> MemoryLayer:
    """Assign initial layer based on importance score at extraction time.
    
    Args:
        importance: Importance score from LLM (1-10)
    
    Returns:
        Initial memory layer
    """
    if importance < 3:
        return MemoryLayer.L4_TRANSIENT
    elif importance < 5:
        return MemoryLayer.L3_WORKING
    elif importance < 8:
        return MemoryLayer.L2_EPISODIC
    else:
        return MemoryLayer.L1_CORE


def should_promote(layer: MemoryLayer, access_count: int, age_hours: float) -> Optional[MemoryLayer]:
    """Determine if a memory should be promoted to a higher layer.
    
    Promotion rules:
    - L4 → L3: accessed 3+ times in session
    - L3 → L2: accessed 3+ times across sessions, or older than 7 days
    - L2 → L1: should be done through reflection, not automatic
    - L1 → L0: requires explicit user action
    
    Args:
        layer: Current layer
        access_count: Number of times accessed
        age_hours: Hours since memory was created
    
    Returns:
        New layer if promotion is warranted, None otherwise
    """
    if layer == MemoryLayer.L4_TRANSIENT and access_count >= 3:
        return MemoryLayer.L3_WORKING
    
    if layer == MemoryLayer.L3_WORKING:
        # Promote to episodic if frequently accessed or has aged
        if access_count >= 3 or age_hours >= 168:  # 7 days
            return MemoryLayer.L2_EPISODIC
    
    # L2 → L1 and L1 → L0 require reflection or user action
    return None


def should_demote(layer: MemoryLayer, hours_since_access: float, importance: float) -> Optional[MemoryLayer]:
    """Determine if a memory should be demoted to a lower layer or archived.
    
    Demotion rules:
    - L4: archive after 7 days inactive (if importance < 3)
    - L3: demote to L4 after 7 days inactive (if importance < 4)
    - L2: demote to L3 after 30 days inactive (if importance < 5)
    - L1 and L0: never auto-demote
    
    Args:
        layer: Current layer
        hours_since_access: Hours since last access
        importance: Importance score
    
    Returns:
        New layer if demotion is warranted, None if should be archived, or current layer if no change
    """
    if layer == MemoryLayer.L4_TRANSIENT:
        if hours_since_access >= 168 and importance < 3:  # 7 days
            return None  # Archive/delete
    
    if layer == MemoryLayer.L3_WORKING:
        if hours_since_access >= 168 and importance < 4:  # 7 days
            return MemoryLayer.L4_TRANSIENT
    
    if layer == MemoryLayer.L2_EPISODIC:
        if hours_since_access >= 720 and importance < 5:  # 30 days
            return MemoryLayer.L3_WORKING
    
    # L1 and L0 never auto-demote
    return layer


def get_layer_description(layer: MemoryLayer) -> str:
    """Get human-readable description of a memory layer."""
    descriptions = {
        MemoryLayer.L0_CANONICAL: "Canonical Memory: User-declared principles and core truths",
        MemoryLayer.L1_CORE: "Core Memory: Stable facts, preferences, and skills",
        MemoryLayer.L2_EPISODIC: "Episodic Memory: Specific events with time and place",
        MemoryLayer.L3_WORKING: "Working Memory: Current task context",
        MemoryLayer.L4_TRANSIENT: "Transient Buffer: Temporary states",
    }
    return descriptions.get(layer, "Unknown layer")


def validate_importance(importance: float) -> float:
    """Validate and clamp importance score to valid range [1, 10]."""
    return max(1.0, min(10.0, importance))
