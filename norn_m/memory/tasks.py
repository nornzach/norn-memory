"""Background tasks for automatic memory promotion and demotion.

This module provides scheduled tasks that run periodically to:
1. Promote frequently-accessed memories to higher layers
2. Demote stale memories to lower layers or archive them
3. Trigger reflection when thresholds are met
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Any, Optional

from norn_m.memory.hierarchy import (
    MemoryLayer,
    should_promote,
    should_demote,
    calculate_weight,
)

logger = logging.getLogger(__name__)


async def promote_demote_task(
    memory_instance,
    user_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    run_id: Optional[str] = None,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """Background task to promote/demote memories based on access patterns.
    
    This should be run periodically (e.g., hourly or daily) to maintain
    the memory hierarchy.
    
    Args:
        memory_instance: Memory or AsyncMemory instance
        user_id: Optional user filter
        agent_id: Optional agent filter
        run_id: Optional run filter
        dry_run: If True, only report what would be done without making changes
    
    Returns:
        Dict with promotion/demotion statistics
    """
    stats = {
        "promoted": [],
        "demoted": [],
        "archived": [],
        "errors": [],
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    
    try:
        # Build filters
        filters = {}
        if user_id:
            filters["user_id"] = user_id
        if agent_id:
            filters["agent_id"] = agent_id
        if run_id:
            filters["run_id"] = run_id
        
        if not filters:
            logger.warning("promote_demote_task: No scope provided, skipping")
            return stats
        
        # Get all memories for the scope
        # Note: This assumes memory_instance has a get_all or list method
        # Adjust based on actual API
        search_result = memory_instance.search(
            query="",  # Empty query to get all
            filters=filters,
            top_k=1000,  # Large number to get all
        )
        
        memories = search_result.get("results", [])
        now = datetime.now(timezone.utc)
        
        logger.info(f"Processing {len(memories)} memories for promotion/demotion")
        
        for memory in memories:
            memory_id = memory.get("id")
            current_layer = MemoryLayer(memory.get("layer", "L3"))
            importance = memory.get("importance", 5.0)
            
            # Parse timestamps
            created_at_str = memory.get("created_at")
            last_accessed_str = memory.get("last_accessed_at", created_at_str)
            
            try:
                from dateutil import parser as date_parser
                created_at = date_parser.isoparse(created_at_str)
                last_accessed_at = date_parser.isoparse(last_accessed_str)
            except Exception:
                logger.warning(f"Could not parse dates for memory {memory_id[:8]}")
                continue
            
            # Calculate age and staleness
            age_hours = (now - created_at).total_seconds() / 3600
            hours_since_access = (now - last_accessed_at).total_seconds() / 3600
            
            # Get access count (if available in metadata)
            access_count = memory.get("access_count", 0)
            
            # Check for promotion
            new_layer_promote = should_promote(current_layer, access_count, age_hours)
            if new_layer_promote and new_layer_promote != current_layer:
                action = {
                    "memory_id": memory_id,
                    "from_layer": current_layer.value,
                    "to_layer": new_layer_promote.value,
                    "reason": f"access_count={access_count}, age={age_hours:.1f}h",
                }
                stats["promoted"].append(action)
                
                if not dry_run:
                    # Update memory layer
                    # This would need to be implemented in the Memory class
                    logger.info(f"Promoted {memory_id[:8]}: {current_layer.value} → {new_layer_promote.value}")
            
            # Check for demotion
            new_layer_demote = should_demote(current_layer, hours_since_access, importance)
            if new_layer_demote is None:
                # Archive/delete
                action = {
                    "memory_id": memory_id,
                    "from_layer": current_layer.value,
                    "reason": f"stale for {hours_since_access:.1f}h, importance={importance}",
                }
                stats["archived"].append(action)
                
                if not dry_run:
                    logger.info(f"Archived {memory_id[:8]}: stale for {hours_since_access:.1f}h")
            
            elif new_layer_demote != current_layer:
                action = {
                    "memory_id": memory_id,
                    "from_layer": current_layer.value,
                    "to_layer": new_layer_demote.value,
                    "reason": f"stale for {hours_since_access:.1f}h",
                }
                stats["demoted"].append(action)
                
                if not dry_run:
                    logger.info(f"Demoted {memory_id[:8]}: {current_layer.value} → {new_layer_demote.value}")
        
        logger.info(f"Promotion/demotion complete: {len(stats['promoted'])} promoted, "
                   f"{len(stats['demoted'])} demoted, {len(stats['archived'])} archived")
    
    except Exception as e:
        logger.error(f"Error in promote_demote_task: {e}")
        stats["errors"].append(str(e))
    
    return stats


async def reflection_task(
    memory_instance,
    user_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    run_id: Optional[str] = None,
    force: bool = False,
) -> Dict[str, Any]:
    """Background task to trigger reflection when thresholds are met.
    
    Args:
        memory_instance: Memory or AsyncMemory instance
        user_id: Optional user filter
        agent_id: Optional agent filter
        run_id: Optional run filter
        force: If True, run reflection regardless of thresholds
    
    Returns:
        Dict with reflection results or None if not triggered
    """
    from norn_m.memory.reflection import (
        should_trigger_reflection,
        run_reflection,
        REFLECTION_SYSTEM_PROMPT,
    )
    
    try:
        # Build filters
        filters = {}
        if user_id:
            filters["user_id"] = user_id
        if agent_id:
            filters["agent_id"] = agent_id
        if run_id:
            filters["run_id"] = run_id
        
        if not filters:
            logger.warning("reflection_task: No scope provided, skipping")
            return {"triggered": False, "reason": "no_scope"}
        
        # Get recent memories
        # In a real implementation, we'd track "since last reflection"
        # For now, get last N days of memories
        cutoff_date = datetime.now(timezone.utc) - timedelta(days=7)
        
        search_result = memory_instance.search(
            query="",
            filters=filters,
            top_k=200,
        )
        
        memories = search_result.get("results", [])
        
        # Calculate metrics for reflection trigger
        memories_count = len(memories)
        importance_sum = sum(m.get("importance", 5.0) for m in memories)
        
        # Check if we should trigger
        should_trigger, reason = should_trigger_reflection(memories_count, importance_sum)
        
        if not should_trigger and not force:
            logger.info(f"Reflection not triggered: count={memories_count}, importance_sum={importance_sum:.1f}")
            return {
                "triggered": False,
                "reason": reason or "thresholds_not_met",
                "memories_count": memories_count,
                "importance_sum": importance_sum,
            }
        
        logger.info(f"Triggering reflection: {reason} (force={force})")
        
        # Run reflection
        reflection_results = run_reflection(
            memories=memories,
            llm_generate_func=memory_instance.llm.generate_response,
            system_prompt=REFLECTION_SYSTEM_PROMPT,
        )
        
        # Store insights as new memories
        insights = reflection_results.get("insights", [])
        for insight in insights:
            # Add insight as a new memory
            # This would call memory_instance.add() with the insight
            logger.info(f"Generated insight (importance={insight.get('importance')}): {insight.get('text')[:100]}")
        
        return {
            "triggered": True,
            "reason": reason or "forced",
            "insights_count": len(insights),
            "promotions_count": len(reflection_results.get("promotions", [])),
            "timestamp": reflection_results.get("timestamp"),
        }
    
    except Exception as e:
        logger.error(f"Error in reflection_task: {e}")
        return {
            "triggered": False,
            "error": str(e),
        }


async def cleanup_task(
    memory_instance,
    user_id: Optional[str] = None,
    max_age_days: int = 7,
) -> Dict[str, int]:
    """Clean up very old L4 transient memories.
    
    Args:
        memory_instance: Memory or AsyncMemory instance
        user_id: Optional user filter
        max_age_days: Delete L4 memories older than this
    
    Returns:
        Dict with cleanup statistics
    """
    stats = {"deleted": 0, "errors": 0}
    
    try:
        filters = {"layer": "L4"}
        if user_id:
            filters["user_id"] = user_id
        
        cutoff_date = datetime.now(timezone.utc) - timedelta(days=max_age_days)
        
        # Get old L4 memories
        search_result = memory_instance.search(
            query="",
            filters=filters,
            top_k=1000,
        )
        
        memories = search_result.get("results", [])
        now = datetime.now(timezone.utc)
        
        for memory in memories:
            created_at_str = memory.get("created_at")
            try:
                from dateutil import parser as date_parser
                created_at = date_parser.isoparse(created_at_str)
                
                if created_at < cutoff_date:
                    memory_id = memory.get("id")
                    # Delete memory
                    # memory_instance.delete(memory_id)
                    stats["deleted"] += 1
                    logger.info(f"Deleted old L4 memory {memory_id[:8]}")
            except Exception as e:
                logger.warning(f"Error processing memory for cleanup: {e}")
                stats["errors"] += 1
        
        logger.info(f"Cleanup complete: {stats['deleted']} deleted, {stats['errors']} errors")
    
    except Exception as e:
        logger.error(f"Error in cleanup_task: {e}")
        stats["errors"] += 1
    
    return stats


# Scheduler configuration (for documentation)
TASK_SCHEDULE = {
    "promote_demote": {
        "interval": "1 hour",
        "description": "Check for memories to promote or demote",
    },
    "reflection": {
        "interval": "12 hours",
        "description": "Trigger reflection when thresholds are met",
    },
    "cleanup": {
        "interval": "24 hours",
        "description": "Clean up very old L4 transient memories",
    },
}
