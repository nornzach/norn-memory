"""The OSS Memory SDK sends nothing anywhere on its own: no analytics, no remote notice config,
no hidden collections. Unsupported parameters fail with a plain error."""

import subprocess
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from norn_m.memory.main import AsyncMemory, Memory


def test_importing_the_sdk_loads_no_analytics_client():
    code = (
        "import sys; import norn_m; from norn_m import Memory, AsyncMemory; "
        "print(sorted(m for m in ('posthog', 'norn_m.memory.telemetry', 'norn_m.memory.notices') if m in sys.modules))"
    )
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True).stdout
    assert out.strip() == "[]"


@pytest.mark.parametrize("module", ["norn_m.memory.telemetry", "norn_m.memory.notices", "norn_m.memory.setup"])
def test_telemetry_modules_are_gone(module):
    import importlib.util

    assert importlib.util.find_spec(module) is None


def _sync_memory():
    memory = Memory.__new__(Memory)
    memory.vector_store = MagicMock()
    memory._delete_memory = MagicMock()
    return memory


def _async_memory():
    memory = AsyncMemory.__new__(AsyncMemory)
    memory.vector_store = MagicMock()
    memory._delete_memory = AsyncMock()
    memory._entity_store = None
    return memory


class TestUnsupportedParameters:
    def test_add_with_timestamp(self):
        with pytest.raises(ValueError, match="^The timestamp parameter is not supported by the OSS Memory SDK.$"):
            Memory.add(_sync_memory(), "hi", user_id="u1", timestamp=1700000000)

    def test_search_with_reference_date(self):
        with pytest.raises(ValueError, match="^The reference_date parameter is not supported by the OSS Memory SDK.$"):
            Memory.search(_sync_memory(), "hi", filters={"user_id": "u1"}, reference_date="2026-01-01")

    def test_project_update_with_decay(self):
        with pytest.raises(ValueError, match="^The decay parameter is not supported by the OSS Memory SDK.$"):
            Memory.__new__(Memory).project.update(decay=True)

    @pytest.mark.parametrize("kwargs", [{}, {"decay": False}])
    def test_project_update_without_decay(self, kwargs):
        with pytest.raises(ValueError, match="Project updates are not supported by the OSS Memory SDK."):
            Memory.__new__(Memory).project.update(**kwargs)

    @pytest.mark.asyncio
    async def test_async_project_update_with_decay(self):
        with pytest.raises(ValueError, match="^The decay parameter is not supported by the OSS Memory SDK.$"):
            await AsyncMemory.__new__(AsyncMemory).project.update(decay=True)

    @pytest.mark.asyncio
    async def test_async_add_with_timestamp(self):
        with pytest.raises(ValueError, match="^The timestamp parameter is not supported by the OSS Memory SDK.$"):
            await AsyncMemory.add(_async_memory(), "hi", user_id="u1", timestamp=1700000000)

    @pytest.mark.asyncio
    async def test_async_search_with_reference_date(self):
        with pytest.raises(ValueError, match="^The reference_date parameter is not supported by the OSS Memory SDK.$"):
            await AsyncMemory.search(_async_memory(), "hi", filters={"user_id": "u1"}, reference_date="2026-01-01")


def test_sync_delete_all_stops_when_vector_store_repeats_batch():
    memory = _sync_memory()
    memories = [SimpleNamespace(id="memory-1"), SimpleNamespace(id="memory-2")]
    memory.vector_store.list.side_effect = [(memories, None), (memories, None)]

    result = Memory.delete_all(memory, user_id="u1")

    assert result == {"message": "Memories deleted successfully!"}
    assert memory.vector_store.list.call_count == 2
    assert memory._delete_memory.call_count == 2


@pytest.mark.asyncio
async def test_async_delete_all_stops_when_vector_store_repeats_batch():
    memory = _async_memory()
    memories = [SimpleNamespace(id="memory-1"), SimpleNamespace(id="memory-2")]
    memory.vector_store.list.side_effect = [
        (memories, None),
        (memories, None),
        RuntimeError("delete_all should have stopped before a third list() call"),
    ]

    result = await AsyncMemory.delete_all(memory, user_id="u1")

    assert result == {"message": "Memories deleted successfully!"}
    assert memory.vector_store.list.call_count == 2
    assert memory._delete_memory.await_count == 2
