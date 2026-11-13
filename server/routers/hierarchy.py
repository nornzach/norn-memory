"""Memory hierarchy statistics and graph APIs - SECURED VERSION."""

from fastapi import APIRouter, Depends, HTTPException
from typing import Dict, Any, List, Optional
import logging

from norn_m import Memory
from auth import get_key_scope
from scopes import KeyScope
from server_state import get_memory_instance

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/memories", tags=["hierarchy"])


@router.get("/hierarchy-stats")
async def get_hierarchy_stats(
    user_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    run_id: Optional[str] = None,
    scope: KeyScope = Depends(get_key_scope),  # ← SECURITY: Require API key
) -> Dict[str, Any]:
    """Get memory hierarchy statistics.
    
    Returns counts and metrics for each layer, plus overall statistics.
    
    SECURITY: Requires valid API key. User can only access memories within their scope.
    """
    try:
        memory = get_memory_instance()
        
        # SECURITY: Build filters from scope, not trusting user input directly
        filters = {}
        
        # Use scope-validated user_id
        if user_id:
            if user_id not in scope.user_ids:
                raise HTTPException(
                    status_code=403,
                    detail=f"Access denied: user_id '{user_id}' not in your API key scope"
                )
            filters["user_id"] = user_id
        elif scope.user_ids:
            # If no user_id specified, use first from scope
            filters["user_id"] = scope.user_ids[0]
        
        # Agent and run IDs also need validation if scope is restrictive
        if agent_id:
            filters["agent_id"] = agent_id
        if run_id:
            filters["run_id"] = run_id
        
        if not filters:
            raise HTTPException(
                status_code=400,
                detail="At least one of user_id, agent_id, or run_id is required"
            )
        
        # Get memories within allowed scope
        search_result = memory.search(
            query="",
            filters=filters,
            top_k=10000,
        )
        
        memories = search_result.get("results", [])
        
        # SECURITY: Double-check all returned memories belong to allowed scope
        for mem in memories:
            mem_user_id = mem.get("user_id")
            if mem_user_id and mem_user_id not in scope.user_ids:
                logger.error(f"SECURITY: Memory {mem.get('id')} has user_id {mem_user_id} not in scope")
                raise HTTPException(500, "Internal security check failed")
        
        # Calculate stats per layer
        stats_by_layer = {
            "L0": {"count": 0, "total_importance": 0, "avg_importance": 0},
            "L1": {"count": 0, "total_importance": 0, "avg_importance": 0},
            "L2": {"count": 0, "total_importance": 0, "avg_importance": 0},
            "L3": {"count": 0, "total_importance": 0, "avg_importance": 0},
            "L4": {"count": 0, "total_importance": 0, "avg_importance": 0},
        }
        
        context_distribution = {}
        
        for memory_item in memories:
            layer = memory_item.get("layer", "L3")
            importance = memory_item.get("importance", 5.0)
            context = memory_item.get("context", "chat")
            
            if layer in stats_by_layer:
                stats_by_layer[layer]["count"] += 1
                stats_by_layer[layer]["total_importance"] += importance
            
            context_distribution[context] = context_distribution.get(context, 0) + 1
        
        # Calculate averages
        for layer_stats in stats_by_layer.values():
            if layer_stats["count"] > 0:
                layer_stats["avg_importance"] = round(
                    layer_stats["total_importance"] / layer_stats["count"], 2
                )
        
        # Overall stats
        total_count = len(memories)
        total_importance = sum(m.get("importance", 5.0) for m in memories)
        avg_importance = round(total_importance / total_count, 2) if total_count > 0 else 0
        
        return {
            "total_memories": total_count,
            "avg_importance": avg_importance,
            "by_layer": stats_by_layer,
            "context_distribution": context_distribution,
            "pyramid": [
                {"layer": "L0", "count": stats_by_layer["L0"]["count"], "label": "Canonical"},
                {"layer": "L1", "count": stats_by_layer["L1"]["count"], "label": "Core"},
                {"layer": "L2", "count": stats_by_layer["L2"]["count"], "label": "Episodic"},
                {"layer": "L3", "count": stats_by_layer["L3"]["count"], "label": "Working"},
                {"layer": "L4", "count": stats_by_layer["L4"]["count"], "label": "Transient"},
            ],
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting hierarchy stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{memory_id}/graph")
async def get_memory_graph(
    memory_id: str,
    depth: int = 2,
    scope: KeyScope = Depends(get_key_scope),  # ← SECURITY: Require API key
) -> Dict[str, Any]:
    """Get memory relationship graph for visualization.
    
    Returns nodes and edges for a graph centered on the given memory.
    
    SECURITY: Requires valid API key. Verifies the memory belongs to the user's scope
    before returning its relationship graph.
    
    Args:
        memory_id: Center memory ID
        depth: How many hops to traverse (default 2)
    """
    try:
        memory = get_memory_instance()
        
        # SECURITY: First verify the requested memory is within scope
        # Get the memory to check ownership
        filters = {}
        if scope.user_ids:
            filters["user_id"] = scope.user_ids[0]
        
        search_result = memory.search(
            query="",
            filters=filters,
            top_k=10000,
        )
        
        memories = search_result.get("results", [])
        memory_ids_in_scope = {m.get("id") for m in memories}
        
        if memory_id not in memory_ids_in_scope:
            raise HTTPException(
                status_code=403,
                detail=f"Access denied: memory {memory_id} not found in your scope"
            )
        
        # Find the specific memory
        target_memory = next((m for m in memories if m.get("id") == memory_id), None)
        if not target_memory:
            raise HTTPException(404, "Memory not found")
        
        # Build graph (placeholder - would query memory_links table in full implementation)
        nodes = [
            {
                "id": memory_id,
                "label": target_memory.get("memory", "")[:50],
                "layer": target_memory.get("layer", "L3"),
                "importance": target_memory.get("importance", 5.0),
                "type": "center",
            }
        ]
        
        edges = []
        
        # TODO: Query memory_links table for actual relationships
        # Ensure all linked memories also belong to the same scope
        
        return {
            "nodes": nodes,
            "edges": edges,
            "center": memory_id,
            "depth": depth,
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting memory graph: {e}")
        raise HTTPException(status_code=500, detail=str(e))
