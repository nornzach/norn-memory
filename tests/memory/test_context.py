"""Integration tests for context isolation in memory hierarchy."""

from types import SimpleNamespace
from unittest.mock import MagicMock

from norn_m.memory.main import Memory

from norn_m.memory.context import (
    infer_context,
    parse_context,
    get_context_display_name,
    should_cross_context_search,
    CONTEXT_CHAT,
    CONTEXT_DEBUG_PREFIX,
)


class TestContextInference:
    """Test automatic context inference from metadata and agent_id."""
    
    def test_explicit_context_in_metadata(self):
        """Explicit context in metadata should be used directly."""
        metadata = {"context": "custom-context"}
        result = infer_context(metadata)
        assert result == "custom-context"
    
    def test_infer_from_debug_agent(self):
        """Debug-related agent_id should infer debug context."""
        result = infer_context({}, agent_id="debug-session-abc123", run_id="run-xyz")
        assert result.startswith(CONTEXT_DEBUG_PREFIX)
        assert "run-xyz" in result or "abc123" in result
    
    def test_infer_from_troubleshoot_agent(self):
        """Troubleshoot agent should also infer debug context."""
        result = infer_context({}, agent_id="troubleshoot-issue-456")
        assert result.startswith(CONTEXT_DEBUG_PREFIX)
    
    def test_infer_from_release_agent(self):
        """Release-related agent_id should infer release context."""
        result = infer_context({}, agent_id="release-v2.0")
        assert result == "release-2.0"
    
    def test_infer_from_deploy_agent(self):
        """Deploy agent should infer release context."""
        result = infer_context({}, agent_id="deploy-production-1.5.3")
        assert result.startswith("release-")
    
    def test_infer_from_research_agent(self):
        """Research agent should infer research context."""
        result = infer_context({}, agent_id="research-memory-systems")
        assert result == "research-memory-systems"
    
    def test_infer_from_scout_agent(self):
        """Scout agent should infer research context."""
        result = infer_context({}, agent_id="scout-codebase")
        assert result.startswith("research-")
    
    def test_infer_from_planning_agent(self):
        """Planning agent should infer planning context."""
        result = infer_context({}, agent_id="planning-agent")
        assert result == "planning"
    
    def test_infer_from_project_metadata(self):
        """Project in metadata should infer project context."""
        result = infer_context({"project": "norn-memory"})
        assert result == "project-norn-memory"
    
    def test_infer_from_project_with_spaces(self):
        """Project names with spaces should be sanitized."""
        result = infer_context({"project": "My Cool Project"})
        assert result == "project-my-cool-project"
    
    def test_infer_from_version_metadata(self):
        """Version in metadata should infer release context."""
        result = infer_context({"version": "2.1.0"})
        assert result == "release-2.1.0"
    
    def test_infer_from_issue_metadata(self):
        """Issue number in metadata should infer debug context."""
        result = infer_context({"issue": "123"})
        assert result == "debug-123"
    
    def test_default_to_chat(self):
        """No indicators should default to chat context."""
        result = infer_context({})
        assert result == CONTEXT_CHAT
    
    def test_agent_priority_over_metadata(self):
        """Agent_id patterns should take priority over generic metadata."""
        result = infer_context(
            {"project": "some-project"},
            agent_id="debug-critical-issue"
        )
        assert result.startswith(CONTEXT_DEBUG_PREFIX)


class TestContextParsing:
    """Test parsing context strings into type and id."""
    
    def test_parse_project_context(self):
        """Parse project-{name} format."""
        result = parse_context("project-norn-memory")
        assert result == {"type": "project", "id": "norn-memory"}
    
    def test_parse_debug_context(self):
        """Parse debug-{id} format."""
        result = parse_context("debug-abc123")
        assert result == {"type": "debug", "id": "abc123"}
    
    def test_parse_release_context(self):
        """Parse release-{version} format."""
        result = parse_context("release-2.0.0")
        assert result == {"type": "release", "id": "2.0.0"}
    
    def test_parse_research_context(self):
        """Parse research-{topic} format."""
        result = parse_context("research-ai-memory")
        assert result == {"type": "research", "id": "ai-memory"}
    
    def test_parse_planning_context(self):
        """Parse planning context."""
        result = parse_context("planning")
        assert result == {"type": "planning", "id": None}
    
    def test_parse_chat_context(self):
        """Parse chat context."""
        result = parse_context("chat")
        assert result == {"type": "chat", "id": None}
    
    def test_parse_empty_context(self):
        """Empty context defaults to chat."""
        result = parse_context("")
        assert result == {"type": "chat", "id": None}
    
    def test_parse_unknown_format(self):
        """Unknown format is treated as custom."""
        result = parse_context("some-random-context")
        assert result == {"type": "custom", "id": "some-random-context"}


class TestContextDisplayName:
    """Test human-readable context names."""
    
    def test_display_project_context(self):
        """Project context should show 'Project: {name}'."""
        result = get_context_display_name("project-norn-memory")
        assert result == "Project: norn-memory"
    
    def test_display_debug_context(self):
        """Debug context should show 'Debug Session: {id}'."""
        result = get_context_display_name("debug-abc123")
        assert result == "Debug Session: abc123"
    
    def test_display_chat_context(self):
        """Chat context should show 'Chat'."""
        result = get_context_display_name("chat")
        assert result == "Chat"
    
    def test_display_planning_context(self):
        """Planning context should show 'Planning'."""
        result = get_context_display_name("planning")
        assert result == "Planning"


class TestCrossContextSearch:
    """Test context isolation rules in search."""
    
    def test_same_context_always_included(self):
        """Memories from the same context should always be included."""
        assert should_cross_context_search("project-a", "project-a") is True
        assert should_cross_context_search("debug-123", "debug-123") is True
    
    def test_chat_memories_universal(self):
        """Chat memories should be accessible from all contexts."""
        assert should_cross_context_search("project-a", "chat") is True
        assert should_cross_context_search("debug-123", "chat") is True
        assert should_cross_context_search("release-2.0", "chat") is True
    
    def test_debug_memories_isolated(self):
        """Debug memories should not leak to other contexts."""
        assert should_cross_context_search("project-a", "debug-123") is False
        assert should_cross_context_search("chat", "debug-123") is False
        assert should_cross_context_search("debug-456", "debug-123") is False
    
    def test_release_memories_isolated(self):
        """Release memories should be isolated to that release."""
        assert should_cross_context_search("project-a", "release-2.0") is False
        assert should_cross_context_search("chat", "release-2.0") is False
    
    def test_research_can_access_projects(self):
        """Research context can access project and planning memories."""
        assert should_cross_context_search("research-topic", "project-a") is True
        assert should_cross_context_search("research-topic", "planning") is True
        assert should_cross_context_search("research-topic", "chat") is True
    
    def test_projects_can_access_chat_and_planning(self):
        """Project context can access chat and planning."""
        assert should_cross_context_search("project-a", "chat") is True
        assert should_cross_context_search("project-a", "planning") is True
    
    def test_projects_isolated_from_each_other(self):
        """Different projects are isolated from each other."""
        result = should_cross_context_search("project-a", "project-b")
        assert result is False  # Projects don't cross-contaminate
    
    def test_planning_can_access_projects(self):
        """Planning context can access project memories."""
        assert should_cross_context_search("planning", "project-a") is True
        assert should_cross_context_search("planning", "chat") is True


class TestContextSanitization:
    """Test context name sanitization."""
    
    def test_sanitize_with_spaces(self):
        """Spaces should be converted to hyphens."""
        from norn_m.memory.context import _sanitize_context_name
        result = _sanitize_context_name("My Project Name")
        assert result == "my-project-name"
    
    def test_sanitize_with_special_chars(self):
        """Special characters should be removed or converted."""
        from norn_m.memory.context import _sanitize_context_name
        result = _sanitize_context_name("project@2023!")
        assert result == "project-2023"
    
    def test_sanitize_long_name(self):
        """Long names should be truncated."""
        from norn_m.memory.context import _sanitize_context_name
        long_name = "a" * 100
        result = _sanitize_context_name(long_name)
        assert len(result) <= 50
    
    def test_sanitize_preserve_hyphen_underscore(self):
        """Hyphens and underscores should be preserved."""
        from norn_m.memory.context import _sanitize_context_name
        result = _sanitize_context_name("my-project_name")
        assert result == "my-project_name"


class TestVersionExtraction:
    """Test version string extraction."""
    
    def test_extract_version_v_prefix(self):
        """Extract version with 'v' prefix."""
        from norn_m.memory.context import _extract_version
        assert _extract_version("release-v2.0") == "2.0"
        assert _extract_version("deploy-v1.5.3") == "1.5.3"
    
    def test_extract_version_no_prefix(self):
        """Extract version without prefix."""
        from norn_m.memory.context import _extract_version
        assert _extract_version("release-2.0.1") == "2.0.1"
    
    def test_extract_version_with_text(self):
        """Extract version from text."""
        from norn_m.memory.context import _extract_version
        assert _extract_version("deploying version 3.1") == "3.1"
    
    def test_extract_no_version(self):
        """Return None if no version found."""
        from norn_m.memory.context import _extract_version
        assert _extract_version("no-version-here") is None


class TestTopicExtraction:
    """Test research topic extraction."""
    
    def test_extract_topic_from_research(self):
        """Extract topic from research- prefix."""
        from norn_m.memory.context import _extract_topic
        assert _extract_topic("research-memory-systems") == "memory-systems"
    
    def test_extract_topic_from_investigate(self):
        """Extract topic from investigate- prefix."""
        from norn_m.memory.context import _extract_topic
        assert _extract_topic("investigate-performance") == "performance"
    
    def test_extract_topic_from_scout(self):
        """Extract topic from scout- prefix."""
        from norn_m.memory.context import _extract_topic
        assert _extract_topic("scout-codebase") == "codebase"
    
    def test_extract_no_topic(self):
        """Return None if no topic found."""
        from norn_m.memory.context import _extract_topic
        assert _extract_topic("no-topic-here") is None


def test_isolation_applies_inside_search():
    """should_cross_context_search is called from _search_vector_store: a chat query must not
    see a debug memory even when it is the most similar hit."""
    memory = MagicMock(spec=Memory)
    memory.vector_store = MagicMock()
    memory.vector_store.search.return_value = [
        SimpleNamespace(id="dbg", score=0.99, payload={"data": "debug note", "context": "debug-x"}),
        SimpleNamespace(id="gen", score=0.5, payload={"data": "general note", "context": "chat"}),
    ]
    memory.embedding_model = MagicMock()
    memory.embedding_model.embed.return_value = [0.1, 0.2]
    memory._compute_entity_boosts.return_value = {}
    memory.keyword_search_memories = None
    memory._search_vector_store = Memory._search_vector_store.__get__(memory, Memory)

    results = memory._search_vector_store("q", {}, 10)

    ids = [m["id"] for m in results]
    assert ids == ["gen"]
