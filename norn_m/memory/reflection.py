"""Memory reflection engine for pattern detection and insight extraction.

This module implements the reflection mechanism inspired by Stanford's
Generative Agents paper, where the system periodically reviews memories
to extract higher-order patterns and insights.
"""

import logging
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional, Tuple

from norn_m.memory.hierarchy import MemoryLayer, assign_initial_layer, validate_importance

logger = logging.getLogger(__name__)


# Reflection triggers
REFLECTION_IMPORTANCE_THRESHOLD = 150  # Sum of importance scores
REFLECTION_COUNT_THRESHOLD = 100  # Number of memories since last reflection


def should_trigger_reflection(
    memories_since_last: int,
    importance_sum: float,
) -> Tuple[bool, str]:
    """Determine if reflection should be triggered.
    
    Reflection is triggered when:
    1. Sum of importance scores exceeds threshold, OR
    2. Number of new memories exceeds threshold
    
    Args:
        memories_since_last: Number of memories added since last reflection
        importance_sum: Sum of importance scores since last reflection
    
    Returns:
        Tuple of (should_trigger, reason)
    """
    if importance_sum >= REFLECTION_IMPORTANCE_THRESHOLD:
        return (True, f"importance_sum={importance_sum:.1f} >= {REFLECTION_IMPORTANCE_THRESHOLD}")
    
    if memories_since_last >= REFLECTION_COUNT_THRESHOLD:
        return (True, f"count={memories_since_last} >= {REFLECTION_COUNT_THRESHOLD}")
    
    return (False, "")


def generate_reflection_questions(memories: List[Dict[str, Any]]) -> List[str]:
    """Generate high-level questions based on recent memories.
    
    Questions focus on patterns, insights, and connections between memories.
    
    Args:
        memories: List of recent memory dicts with 'memory' text and metadata
    
    Returns:
        List of reflection questions
    """
    if not memories:
        return []
    
    # Analyze memory themes
    has_preferences = any("prefer" in m.get("memory", "").lower() for m in memories)
    has_problems = any(any(word in m.get("memory", "").lower() for word in ["problem", "issue", "bug", "error"]) for m in memories)
    has_decisions = any(any(word in m.get("memory", "").lower() for word in ["decided", "chose", "selected"]) for m in memories)
    has_learnings = any(any(word in m.get("memory", "").lower() for word in ["learned", "discovered", "realized"]) for m in memories)
    
    questions = []
    
    # Core reflection questions (always asked)
    questions.append("What are the 3 most important high-level insights I can infer from recent observations?")
    
    # Conditional questions based on memory content
    if has_preferences:
        questions.append("What consistent preferences or patterns emerge from recent decisions?")
    
    if has_problems:
        questions.append("What common problems or challenges appear across recent experiences?")
    
    if has_decisions:
        questions.append("What principles or criteria guided recent decisions?")
    
    if has_learnings:
        questions.append("What important lessons can be extracted from recent discoveries?")
    
    # Relationship and contradiction questions
    questions.append("Are there any contradictions or tensions between recent observations?")
    questions.append("What connections or relationships exist between seemingly unrelated memories?")
    
    return questions


def extract_insights_from_memories(
    memories: List[Dict[str, Any]],
    llm_generate_func,
    system_prompt: str,
) -> List[Dict[str, Any]]:
    """Extract high-level insights from a set of memories using an LLM.
    
    This is the core reflection process: given a set of recent memories,
    generate higher-order observations and patterns.
    
    Args:
        memories: List of memory dicts
        llm_generate_func: Function to call LLM (takes messages, returns text)
        system_prompt: System prompt for the reflection task
    
    Returns:
        List of insight dicts with 'text', 'importance', 'source_memory_ids'
    """
    if not memories:
        return []
    
    # Build context from memories
    memory_texts = []
    for i, mem in enumerate(memories[:50]):  # Limit to 50 most recent
        text = mem.get("memory", "")
        created = mem.get("created_at", "")
        importance = mem.get("importance", 5)
        memory_texts.append(f"{i+1}. [{importance}/10] {text} (created: {created})")
    
    memories_context = "\n".join(memory_texts)
    
    # Generate reflection questions
    questions = generate_reflection_questions(memories)
    questions_text = "\n".join(f"- {q}" for q in questions)
    
    user_prompt = f"""# Recent Memories

{memories_context}

# Reflection Questions

{questions_text}

# Task

Based on the memories above, extract 3-5 high-level insights, patterns, or principles. Each insight should:

1. Synthesize information from multiple memories (not just restating one)
2. Identify patterns, preferences, or principles
3. Be actionable or informative for future decisions
4. Have an importance score (1-10) reflecting its value

Output format (JSON):
{{
  "insights": [
    {{"text": "...", "importance": 8, "source_indices": [1, 3, 5]}},
    ...
  ]
}}
"""
    
    try:
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
        
        response = llm_generate_func(messages=messages, response_format={"type": "json_object"})
        
        # Parse response
        import json
        parsed = json.loads(response)
        insights_raw = parsed.get("insights", [])
        
        # Convert to internal format with memory IDs
        insights = []
        for insight in insights_raw:
            text = insight.get("text")
            importance = validate_importance(insight.get("importance", 7))
            source_indices = insight.get("source_indices", [])
            
            # Map indices to actual memory IDs
            source_ids = []
            for idx in source_indices:
                if 0 <= idx - 1 < len(memories):
                    mem_id = memories[idx - 1].get("id")
                    if mem_id:
                        source_ids.append(mem_id)
            
            if text:
                insights.append({
                    "text": text,
                    "importance": importance,
                    "source_memory_ids": source_ids,
                    "layer": assign_initial_layer(importance).value,
                    "reflected_at": datetime.now(timezone.utc).isoformat(),
                })
        
        logger.info(f"Extracted {len(insights)} insights from {len(memories)} memories")
        return insights
    
    except Exception as e:
        logger.error(f"Reflection failed: {e}")
        return []


def should_promote_to_core(
    memory: Dict[str, Any],
    reflection_insights: List[Dict[str, Any]],
) -> bool:
    """Determine if a memory should be promoted to L1 core based on reflection.
    
    Promotion to L1 happens when:
    - Memory is referenced in multiple high-importance insights
    - Memory represents a principle or pattern identified by reflection
    
    Args:
        memory: Memory dict to consider for promotion
        reflection_insights: List of insights from recent reflection
    
    Returns:
        True if memory should be promoted to L1
    """
    current_layer = memory.get("layer", "L3")
    if current_layer in ["L0", "L1"]:
        # Already at top layers
        return False
    
    memory_id = memory.get("id")
    if not memory_id:
        return False
    
    # Count how many high-importance insights reference this memory
    references = 0
    total_insight_importance = 0
    
    for insight in reflection_insights:
        if memory_id in insight.get("source_memory_ids", []):
            references += 1
            total_insight_importance += insight.get("importance", 0)
    
    # Promote if referenced by 2+ insights with combined importance >= 15
    if references >= 2 and total_insight_importance >= 15:
        logger.info(f"Memory {memory_id[:8]} promoted to L1 (referenced {references} times, importance sum {total_insight_importance})")
        return True
    
    return False


def run_reflection(
    memories: List[Dict[str, Any]],
    llm_generate_func,
    system_prompt: Optional[str] = None,
) -> Dict[str, Any]:
    """Run a full reflection cycle on recent memories.
    
    Args:
        memories: List of recent memory dicts
        llm_generate_func: Function to call LLM
        system_prompt: Optional custom system prompt
    
    Returns:
        Dict with:
        - insights: List of extracted insights
        - promotions: List of memory IDs promoted to L1
        - timestamp: When reflection ran
    """
    if system_prompt is None:
        system_prompt = """You are a memory reflection agent. Your task is to analyze a set of recent memories and extract high-level insights, patterns, and principles.

Focus on:
- Recurring themes and patterns
- Underlying preferences and principles
- Connections between seemingly unrelated observations
- Contradictions that need resolution
- Actionable lessons and takeaways

Your insights should be:
- Synthetic (combining multiple memories)
- High-level (not just restating facts)
- Actionable (useful for future decisions)
- Well-scored (importance 1-10)"""
    
    insights = extract_insights_from_memories(memories, llm_generate_func, system_prompt)
    
    # Identify memories to promote
    promotions = []
    for memory in memories:
        if should_promote_to_core(memory, insights):
            promotions.append(memory.get("id"))
    
    return {
        "insights": insights,
        "promotions": promotions,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "memories_analyzed": len(memories),
    }


# Default reflection prompt
REFLECTION_SYSTEM_PROMPT = """You are a memory reflection agent. Your task is to analyze a set of recent memories and extract high-level insights, patterns, and principles.

Focus on:
- Recurring themes and patterns
- Underlying preferences and principles
- Connections between seemingly unrelated observations
- Contradictions that need resolution
- Actionable lessons and takeaways

Your insights should be:
- Synthetic (combining multiple memories)
- High-level (not just restating facts)
- Actionable (useful for future decisions)
- Well-scored (importance 1-10)

IMPORTANT: Output valid JSON only, no explanations or markdown formatting."""
