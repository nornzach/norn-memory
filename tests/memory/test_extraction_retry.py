"""A malformed extraction reply from the LLM must be retried once, then fail loudly.

Before this, ``add(..., infer=True)`` swallowed any JSON parse error of the extraction reply and returned
``[]``, so the caller got a success with no results and the fact was silently lost. An empty reply or an
empty ``memory`` list is still a genuine "nothing to remember" and keeps returning ``[]``.
"""

import asyncio
import json
from unittest.mock import MagicMock, Mock

import pytest

from norn_m.exceptions import LLMError
from norn_m.memory.main import AsyncMemory, Memory

VALID = json.dumps({"memory": [{"text": "User's name is Aryan"}, {"text": "User works as an engineer"}]})
# The shape DeepSeek returned in the live failure: "Expecting ',' delimiter".
MALFORMED = '{"memory": [{"text": "User\'s name is Aryan"} {"text": "User works as an engineer"}]}'
MESSAGES = [{"role": "user", "content": "My name is Aryan. I work as an engineer."}]


def _setup_mocks(mocker):
    mocker.patch("norn_m.utils.factory.EmbedderFactory.create", MagicMock())
    mocker.patch(
        "norn_m.utils.factory.VectorStoreFactory.create",
        side_effect=[MagicMock(search=Mock(return_value=[])), MagicMock()],
    )
    mocker.patch("norn_m.utils.factory.LlmFactory.create", MagicMock())
    mocker.patch("norn_m.memory.storage.SQLiteManager", MagicMock())
    mocker.patch("norn_m.memory.main.extract_entities_batch", return_value=[])


@pytest.fixture(params=["sync", "async"])
def memory(request, mocker):
    _setup_mocks(mocker)
    memory = (Memory if request.param == "sync" else AsyncMemory)()
    memory.config = mocker.MagicMock()
    memory.config.custom_instructions = None
    memory.custom_instructions = None
    memory.db.get_last_messages = MagicMock(return_value=[])
    memory.db.save_messages = MagicMock()
    memory.db.batch_add_history = MagicMock()
    memory.embedding_model.embed_batch = Mock(side_effect=lambda texts, action: [[0.1, 0.2, 0.3] for _ in texts])
    return memory


def _add(memory, replies):
    memory.llm.generate_response = Mock(side_effect=list(replies))
    if isinstance(memory, AsyncMemory):
        return asyncio.run(
            memory._add_to_vector_store(messages=MESSAGES, metadata={}, effective_filters={}, infer=True)
        )
    return memory._add_to_vector_store(messages=MESSAGES, metadata={}, filters={}, infer=True)


def test_valid_reply_is_extracted_with_one_call(memory):
    result = _add(memory, [VALID])

    assert [r["memory"] for r in result] == ["User's name is Aryan", "User works as an engineer"]
    assert memory.llm.generate_response.call_count == 1


def test_malformed_reply_is_retried_once_with_the_same_prompts(memory):
    result = _add(memory, [MALFORMED, VALID])

    assert [r["memory"] for r in result] == ["User's name is Aryan", "User works as an engineer"]
    first, retry = memory.llm.generate_response.call_args_list
    assert first == retry


def test_malformed_twice_raises_llm_error_instead_of_returning_empty(memory):
    with pytest.raises(LLMError, match="malformed") as exc_info:
        _add(memory, [MALFORMED, MALFORMED])

    assert memory.llm.generate_response.call_count == 2
    assert isinstance(exc_info.value.__cause__, json.JSONDecodeError)
    # Nothing was stored, so nothing may be reported or saved as processed.
    memory.vector_store.insert.assert_not_called()


@pytest.mark.parametrize("reply", ["", "   ", '{"memory": []}', "```json\n{}\n```"])
def test_genuinely_empty_reply_returns_empty_without_retry(memory, reply):
    assert _add(memory, [reply]) == []
    assert memory.llm.generate_response.call_count == 1
    memory.db.save_messages.assert_called_once()
