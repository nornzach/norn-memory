import json
import logging
import threading
from copy import deepcopy
from typing import Any, Callable, Dict

from norn_m import Memory

_state_lock = threading.RLock()
_current_config: Dict[str, Any] = {}
_memory_instance: Memory | None = None
_session_factory: Callable | None = None


def set_session_factory(factory: Callable) -> None:
    global _session_factory
    _session_factory = factory


def _load_overrides() -> Dict[str, Any]:
    try:
        if _session_factory is None:
            return {}
        from models import Settings

        session = _session_factory()
        try:
            row = session.get(Settings, "config_overrides")
            if row is None:
                return {}
            return json.loads(row.value)
        finally:
            session.close()
    except Exception:
        return {}


def _save_overrides(overrides: Dict[str, Any]) -> None:
    try:
        if _session_factory is None:
            return
        from models import Settings
        from sqlalchemy.dialects.postgresql import insert

        session = _session_factory()
        try:
            serialized = json.dumps(overrides)
            stmt = (
                insert(Settings)
                .values(key="config_overrides", value=serialized)
                .on_conflict_do_update(
                    index_elements=[Settings.key],
                    set_={"value": serialized},
                )
            )
            session.execute(stmt)
            session.commit()
        finally:
            session.close()
    except Exception:
        logging.warning("Failed to persist config overrides to database", exc_info=True)


def _merge_config(base: Dict[str, Any], updates: Dict[str, Any]) -> Dict[str, Any]:
    merged = deepcopy(base)

    for key, value in updates.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _merge_config(merged[key], value)
        else:
            merged[key] = value

    return merged


# Settings that mean the same thing for every provider, so they survive a provider switch.
PORTABLE_PROVIDER_KEYS = {
    "llm": ("temperature", "max_tokens", "top_p"),
    "embedder": ("embedding_dims",),
}


def _endpoint(section: Dict[str, Any]) -> tuple:
    config = section.get("config") or {}
    # An unset (None) base URL means the provider's default, same as leaving the key out.
    base_urls = tuple(sorted((key, value) for key, value in config.items() if key.endswith("_base_url") and value))
    return section.get("provider"), base_urls


def apply_config_updates(base: Dict[str, Any], updates: Dict[str, Any]) -> Dict[str, Any]:
    """Deep-merge ``updates`` into ``base``, except that an llm/embedder section whose provider or
    base URL changes starts fresh. Otherwise keys only the old provider understands would reach
    the new one (and fail its config class), and a saved API key would be sent to the new URL."""
    merged = _merge_config(base, updates)
    for section, portable in PORTABLE_PROVIDER_KEYS.items():
        old, new = base.get(section), updates.get(section)
        if not isinstance(old, dict) or not isinstance(new, dict):
            continue
        if _endpoint(merged[section]) == _endpoint(old):
            continue
        old_config = old.get("config") or {}
        fresh = deepcopy(new)
        fresh.setdefault("provider", old.get("provider"))
        fresh["config"] = {
            **{key: old_config[key] for key in portable if key in old_config},
            **deepcopy(new.get("config") or {}),
        }
        merged[section] = fresh
    return merged


def initialize_state(default_config: Dict[str, Any]) -> None:
    global _current_config, _memory_instance
    with _state_lock:
        _current_config = deepcopy(default_config)
        overrides = _load_overrides()
        if overrides:
            _current_config = apply_config_updates(_current_config, overrides)
        _memory_instance = Memory.from_config(_current_config)


def update_config(updates: Dict[str, Any]) -> Dict[str, Any]:
    global _current_config, _memory_instance
    with _state_lock:
        next_config = apply_config_updates(_current_config, updates)
        _current_config = next_config
        _memory_instance = Memory.from_config(next_config)
        overrides = _load_overrides()
        overrides = apply_config_updates(overrides, updates)
        _save_overrides(overrides)
        return deepcopy(_current_config)


def get_current_config() -> Dict[str, Any]:
    with _state_lock:
        return deepcopy(_current_config)


def get_memory_instance() -> Memory:
    with _state_lock:
        if _memory_instance is None:
            raise RuntimeError("Norn-M runtime has not been initialized.")
        return _memory_instance
