"""Tests for reflection and conflict detection modules."""

import pytest
from datetime import datetime, timezone
from unittest.mock import Mock

from norn_m.memory.reflection import (
    should_trigger_reflection,
    generate_reflection_questions,
    should_promote_to_core,
    REFLECTION_IMPORTANCE_THRESHOLD,
    REFLECTION_COUNT_THRESHOLD,
)
from norn_m.memory.conflict import (
    detect_conflicts,
    resolve_with_l0,
    resolve_by_recency,
    resolve_by_importance,
    resolve_conflict,
    CONFLICT_CONTRADICTION,
    CONFLICT_SUPERSEDED,
)


class TestReflectionTrigger:
    """Test reflection trigger conditions."""
    
    def test_trigger_by_importance_sum(self):
        """Reflection should trigger when importance sum exceeds threshold."""
        should, reason = should_trigger_reflection(
            memories_since_last=10,
            importance_sum=REFLECTION_IMPORTANCE_THRESHOLD + 1,
        )
        assert should is True
        assert "importance_sum" in reason
    
    def test_trigger_by_count(self):
        """Reflection should trigger when count exceeds threshold."""
        should, reason = should_trigger_reflection(
            memories_since_last=REFLECTION_COUNT_THRESHOLD + 1,
            importance_sum=50,
        )
        assert should is True
        assert "count" in reason
    
    def test_no_trigger_below_thresholds(self):
        """Reflection should not trigger below both thresholds."""
        should, reason = should_trigger_reflection(
            memories_since_last=50,
            importance_sum=100,
        )
        assert should is False
        assert reason == ""


class TestReflectionQuestions:
    """Test reflection question generation."""
    
    def test_generate_core_questions(self):
        """Core questions should always be generated."""
        memories = [{"memory": "Some fact"}]
        questions = generate_reflection_questions(memories)
        
        assert len(questions) > 0
        assert any("insights" in q.lower() for q in questions)
    
    def test_generate_preference_questions(self):
        """Preference-related questions when preferences present."""
        memories = [
            {"memory": "I prefer TypeScript over JavaScript"},
            {"memory": "I prefer dark mode"},
        ]
        questions = generate_reflection_questions(memories)
        
        assert any("preference" in q.lower() or "pattern" in q.lower() for q in questions)
    
    def test_generate_problem_questions(self):
        """Problem-related questions when issues present."""
        memories = [
            {"memory": "Encountered a bug in the auth system"},
            {"memory": "Problem with database connection"},
        ]
        questions = generate_reflection_questions(memories)
        
        assert any("problem" in q.lower() or "challenge" in q.lower() for q in questions)
    
    def test_generate_decision_questions(self):
        """Decision-related questions when decisions present."""
        memories = [
            {"memory": "Decided to use PostgreSQL for persistence"},
            {"memory": "Chose React over Vue"},
        ]
        questions = generate_reflection_questions(memories)
        
        assert any("decision" in q.lower() or "principle" in q.lower() for q in questions)
    
    def test_empty_memories(self):
        """Empty memory list should return empty questions."""
        questions = generate_reflection_questions([])
        assert questions == []


class TestPromotionToCore:
    """Test L2 → L1 promotion logic via reflection."""
    
    def test_promote_when_referenced_by_insights(self):
        """Memory should promote when referenced by multiple high-importance insights."""
        memory = {
            "id": "mem123",
            "layer": "L2",
            "memory": "Always write tests first",
        }
        
        insights = [
            {
                "text": "Strong testing culture",
                "importance": 8,
                "source_memory_ids": ["mem123", "mem456"],
            },
            {
                "text": "Quality-driven development",
                "importance": 9,
                "source_memory_ids": ["mem123", "mem789"],
            },
        ]
        
        assert should_promote_to_core(memory, insights) is True
    
    def test_no_promote_single_reference(self):
        """Memory should not promote with only one reference."""
        memory = {
            "id": "mem123",
            "layer": "L2",
        }
        
        insights = [
            {
                "text": "Some insight",
                "importance": 8,
                "source_memory_ids": ["mem123"],
            },
        ]
        
        assert should_promote_to_core(memory, insights) is False
    
    def test_no_promote_low_importance(self):
        """Memory should not promote if insights have low importance."""
        memory = {
            "id": "mem123",
            "layer": "L2",
        }
        
        insights = [
            {
                "text": "Minor observation",
                "importance": 3,
                "source_memory_ids": ["mem123"],
            },
            {
                "text": "Another minor thing",
                "importance": 4,
                "source_memory_ids": ["mem123"],
            },
        ]
        
        assert should_promote_to_core(memory, insights) is False
    
    def test_no_promote_already_l1(self):
        """L1 memories should not be promoted."""
        memory = {
            "id": "mem123",
            "layer": "L1",
        }
        
        insights = [
            {
                "importance": 10,
                "source_memory_ids": ["mem123"],
            },
        ]
        
        assert should_promote_to_core(memory, insights) is False


class TestConflictDetection:
    """Test conflict detection between memories."""
    
    def test_detect_preference_contradiction(self):
        """Detect contradicting preferences."""
        new_mem = {
            "id": "new123",
            "memory": "I prefer TypeScript for large projects",
        }
        
        existing = [
            {
                "id": "old123",
                "memory": "I prefer JavaScript for all projects",
            },
        ]
        
        conflicts = detect_conflicts(new_mem, existing)
        
        assert len(conflicts) > 0
        assert conflicts[0]["type"] == CONFLICT_CONTRADICTION
    
    def test_detect_superseded(self):
        """Detect explicit supersession."""
        new_mem = {
            "id": "new123",
            "memory": "Switched from MySQL to PostgreSQL for better JSON support",
        }
        
        existing = [
            {
                "id": "old123",
                "memory": "Using MySQL as the database",
            },
        ]
        
        conflicts = detect_conflicts(new_mem, existing)
        
        assert len(conflicts) > 0
        assert conflicts[0]["type"] == CONFLICT_SUPERSEDED
    
    def test_no_conflict_compatible(self):
        """Compatible memories should not conflict."""
        new_mem = {
            "id": "new123",
            "memory": "Started using Docker for local development",
        }
        
        existing = [
            {
                "id": "old123",
                "memory": "Using TypeScript for the frontend",
            },
        ]
        
        conflicts = detect_conflicts(new_mem, existing)
        
        assert len(conflicts) == 0


class TestConflictResolution:
    """Test conflict resolution strategies."""
    
    def test_resolve_with_l0_alignment(self):
        """L0 memories should resolve conflicts."""
        conflict = {
            "new_memory_id": "new123",
            "existing_memory_id": "old123",
            "new_text": "Always use TypeScript for type safety",
            "existing_text": "Use JavaScript for simplicity",
        }
        
        l0_memories = [
            {
                "memory": "Core principle: type safety is critical for maintainability",
            },
        ]
        
        winner = resolve_with_l0(conflict, l0_memories)
        
        assert winner == "new123"  # TypeScript aligns with type safety
    
    def test_resolve_by_recency(self):
        """Recency resolution should prefer new memory."""
        conflict = {
            "new_memory_id": "new123",
            "existing_memory_id": "old123",
        }
        
        winner = resolve_by_recency(conflict)
        
        assert winner == "new123"
    
    def test_resolve_by_importance(self):
        """Importance resolution should prefer higher importance."""
        conflict = {
            "new_memory_id": "new123",
            "existing_memory_id": "old123",
        }
        
        memory_store = {
            "new123": {"importance": 6},
            "old123": {"importance": 8},
        }
        
        winner = resolve_by_importance(conflict, memory_store)
        
        assert winner == "old123"  # Higher importance
    
    def test_resolve_conflict_l0_then_recency(self):
        """Test full resolution with l0_then_recency strategy."""
        conflict = {
            "new_memory_id": "new123",
            "existing_memory_id": "old123",
            "new_text": "Use React",
            "existing_text": "Use Vue",
        }
        
        l0_memories = []
        memory_store = {}
        
        winner, reason = resolve_conflict(
            conflict,
            l0_memories,
            memory_store,
            strategy="l0_then_recency",
        )
        
        assert winner == "new123"
        assert reason == "recency"
    
    def test_resolve_conflict_importance_strategy(self):
        """Test resolution with importance strategy."""
        conflict = {
            "new_memory_id": "new123",
            "existing_memory_id": "old123",
        }
        
        memory_store = {
            "new123": {"importance": 5},
            "old123": {"importance": 9},
        }
        
        winner, reason = resolve_conflict(
            conflict,
            [],
            memory_store,
            strategy="importance",
        )
        
        assert winner == "old123"
        assert reason == "importance"


class TestConflictHelpers:
    """Test conflict detection helper functions."""
    
    def test_extract_preference(self):
        """Test preference extraction."""
        from norn_m.memory.conflict import _extract_preference
        
        text = "I prefer dark mode over light mode"
        pref = _extract_preference(text)
        
        assert pref is not None
        assert "dark" in pref.lower()
    
    def test_extract_tool(self):
        """Test tool extraction."""
        from norn_m.memory.conflict import _extract_tool
        
        text = "I use VSCode for development"
        tool = _extract_tool(text)
        
        assert tool is not None
        assert "vscode" in tool.lower()
    
    def test_same_category_languages(self):
        """Test category detection for programming languages."""
        from norn_m.memory.conflict import _same_category
        
        assert _same_category("Python", "JavaScript") is True
        assert _same_category("Python", "VSCode") is False
    
    def test_same_category_editors(self):
        """Test category detection for editors."""
        from norn_m.memory.conflict import _same_category
        
        assert _same_category("vim", "emacs") is True
        assert _same_category("vim", "Python") is False
