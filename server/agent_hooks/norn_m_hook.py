#!/usr/bin/env python3
"""Norn-M memory hooks for coding agents.

They make memory automatic instead of leaving it to the agent to call the norn-m MCP tools:

  session-start  (SessionStart)      adds the user's key memories and this project's, or a short warning
                                     when the server can't be reached or rejects the key
  recall         (UserPromptSubmit)  adds memories relevant to the prompt, each one once per session
  capture        (Stop)              sends the turn's prompt and reply to Norn-M, which keeps the durable
                                     facts; it runs detached, so the agent never waits for it
  check                              tests the connection and prints the result (used during setup)

Settings live in ~/.norn-m/<agent>.json, written by the setup prompt on the dashboard's API Keys page:

  {"url": "http://192.168.1.20:8888", "api_key": "nmsk_...", "user_id": "alice",
   "device": "mac", "agent": "claude-code", "min_score": 0.5}

When the server's address or key changes, the dashboard's "update connection" prompt rewrites that file;
the hook entries themselves never change.

Output is Claude Code's hook JSON (hookSpecificOutput.additionalContext). Pass --format text for agents
whose hooks add plain stdout to the conversation instead. Every failure is silent apart from the
session-start warning, so a hook never blocks or breaks the agent. Standard library only, Python 3.8+.
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

VERSION = "1"

HOME = Path(os.environ.get("NORN_M_HOME") or Path.home() / ".norn-m")
STATE_DIR = HOME / "state"
STATE_MAX_AGE = 3 * 24 * 3600

REQUEST_TIMEOUT = 2.5
CAPTURE_TIMEOUT = 90
DEFAULT_MIN_SCORE = 0.5
# Shorter prompts ("yes", "go on") carry nothing to search for or remember.
MIN_PROMPT = 12
MAX_PROMPT = 4000
MAX_REPLY = 4000
# Only the end of a long transcript is read: the last exchange is all capture needs.
TRANSCRIPT_TAIL = 4 * 1024 * 1024

RECALL_LIMIT = 6
PROFILE_QUERY = "the user's preferences, working style, conventions and important facts about them"
TAG = "norn-m-memories"
AGENT_NAME = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
SYSTEM_TEXT = re.compile(r"<system-reminder>.*?</system-reminder>", re.S)

# Self-hosted servers sit on this machine or the LAN; a system-wide HTTP proxy would only get in the way.
_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class ServerError(Exception):
    """The server answered with an error status."""

    def __init__(self, status, detail=""):
        super().__init__(f"HTTP {status}")
        self.status = status
        self.detail = detail


# ---------------------------------------------------------------------------
# Settings and server calls
# ---------------------------------------------------------------------------


def settings_path(agent):
    return HOME / f"{agent}.json"


def load_config(agent):
    try:
        config = json.loads(settings_path(agent).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(config, dict) or not config.get("url") or not config.get("api_key"):
        return None
    config.setdefault("agent", agent)
    return config


def base_url(config):
    """The REST base URL. The MCP endpoint (".../mcp") is accepted too, since the two are easy to mix up."""
    url = str(config["url"]).strip().rstrip("/")
    return url[: -len("/mcp")] if url.endswith("/mcp") else url


def call(config, method, path, body=None, timeout=REQUEST_TIMEOUT):
    headers = {
        "X-API-Key": str(config["api_key"]),
        "Accept": "application/json",
        "User-Agent": f"norn-m-hook/{VERSION}",
    }
    for field, header in (("device", "X-Norn-M-Device"), ("agent", "X-Norn-M-Agent")):
        if config.get(field):
            headers[header] = str(config[field])
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(base_url(config) + path, data=data, method=method, headers=headers)
    try:
        with _opener.open(request, timeout=timeout) as response:
            return json.loads(response.read() or b"null")
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = str(json.loads(exc.read() or b"{}").get("detail", ""))[:300]
        except (ValueError, AttributeError, OSError):
            pass
        raise ServerError(exc.code, detail) from None


def project_of(cwd):
    """The project name agents are told to use: the git repository's folder name, else the folder's."""
    if not cwd:
        return None
    path = Path(cwd)
    for folder in (path, *path.parents):
        if (folder / ".git").exists():
            return folder.name.lower() or None
    return path.name.lower() or None


def search(config, query, top_k, project=None, floor=None):
    body = {"query": query[:MAX_PROMPT], "top_k": top_k}
    if config.get("user_id"):
        body["filters"] = {"user_id": config["user_id"]}
    if project:
        body["project"] = project
    response = call(config, "POST", "/search", body)
    results = response.get("results", []) if isinstance(response, dict) else []
    if floor is None:
        floor = float(config.get("min_score", DEFAULT_MIN_SCORE))
    return [
        item
        for item in results
        if isinstance(item, dict) and item.get("id") and item.get("memory") and (item.get("score") or 0) >= floor
    ]


def gather(config, searches, limit):
    """Runs the searches in parallel and merges them, best score first, each memory once."""
    with ThreadPoolExecutor(max_workers=len(searches)) as pool:
        lists = [future.result() for future in [pool.submit(search, config, *args) for args in searches]]
    best = {}
    for item in (item for items in lists for item in items):
        if item["id"] not in best or (item.get("score") or 0) > (best[item["id"]].get("score") or 0):
            best[item["id"]] = item
    return sorted(best.values(), key=lambda item: item.get("score") or 0, reverse=True)[:limit]


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------


def describe(item):
    text = " ".join(str(item["memory"]).split()).replace(f"</{TAG}>", "")
    meta = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
    when = str(item.get("updated_at") or item.get("created_at") or "")[:10]
    notes = [note for note in (meta.get("project"), when) if note]
    return f"- {text}" + (f" ({', '.join(notes)})" if notes else "")


def block(heading, items):
    return "\n".join([f"<{TAG}>", heading, *(describe(item) for item in items), f"</{TAG}>"])


def emit(event, text, fmt):
    if not text:
        return
    if fmt == "text":
        print(text)
    else:
        print(json.dumps({"hookSpecificOutput": {"hookEventName": event, "additionalContext": text}}))


# ---------------------------------------------------------------------------
# Per-session state: memories already shown, and the latest prompt for capture
# ---------------------------------------------------------------------------


def state_path(agent, session_id):
    digest = hashlib.sha256(str(session_id).encode("utf-8")).hexdigest()[:16]
    return STATE_DIR / f"{agent}-{digest}.json"


def load_state(agent, session_id):
    if not session_id:
        return {}
    try:
        state = json.loads(state_path(agent, session_id).read_text(encoding="utf-8"))
        return state if isinstance(state, dict) else {}
    except (OSError, ValueError):
        return {}


def save_state(agent, session_id, state):
    if not session_id:
        return
    try:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        state_path(agent, session_id).write_text(json.dumps(state), encoding="utf-8")
    except OSError:
        pass


def prune_state():
    cutoff = time.time() - STATE_MAX_AGE
    try:
        for path in STATE_DIR.glob("*.json"):
            if path.stat().st_mtime < cutoff:
                path.unlink()
    except OSError:
        pass


# ---------------------------------------------------------------------------
# Transcript
# ---------------------------------------------------------------------------


def _text(content):
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        text = "\n".join(
            str(part.get("text", ""))
            for part in content
            if isinstance(part, dict) and part.get("type") in ("text", "input_text", "output_text")
        )
    else:
        return ""
    text = SYSTEM_TEXT.sub("", text).strip()
    # Slash commands and their output are recorded as user turns; they aren't something the user said.
    if text.startswith(("<command-", "<local-command")):
        return ""
    return text


def _tail_lines(path):
    with open(path, "rb") as handle:
        handle.seek(0, os.SEEK_END)
        size = handle.tell()
        handle.seek(max(0, size - TRANSCRIPT_TAIL))
        lines = handle.read().decode("utf-8", errors="replace").splitlines()
    return lines[1:] if size > TRANSCRIPT_TAIL else lines


def last_exchange(path):
    """The last user message and the assistant text after it, from a Claude Code style JSONL transcript."""
    if not path:
        return "", ""
    try:
        lines = _tail_lines(path)
    except OSError:
        return "", ""
    prompt, reply = "", []
    for line in lines:
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        if not isinstance(entry, dict) or entry.get("isMeta") or entry.get("isSidechain"):
            continue
        message = entry.get("message")
        if not isinstance(message, dict):
            continue
        role = message.get("role") or entry.get("type")
        text = _text(message.get("content"))
        if not text:
            continue
        if role == "user":
            prompt, reply = text, []
        elif role == "assistant":
            reply.append(text)
    return prompt, "\n\n".join(reply)


# ---------------------------------------------------------------------------
# Hooks
# ---------------------------------------------------------------------------


def session_start(config, data, fmt):
    prune_state()
    agent, session_id = config["agent"], data.get("session_id")
    project = project_of(data.get("cwd"))
    searches = [(PROFILE_QUERY, 8, None, 0.0)]
    if project:
        searches.append((f"{project}: decisions, conventions and context for this project", 6, project, 0.0))
    try:
        items = gather(config, searches, 12)
    except ServerError as exc:
        if exc.status in (401, 403):
            emit(
                "SessionStart",
                f"Norn-M memory: the server at {base_url(config)} rejected this agent's API key, so no memories "
                "were loaded. The key may have been revoked or replaced: tell the user, and ask for the "
                '"Update connection" prompt from the Norn-M dashboard (API Keys, Connect an agent).',
                fmt,
            )
        return
    except (OSError, ValueError):
        emit(
            "SessionStart",
            f"Norn-M memory: the server at {base_url(config)} did not answer, so no memories were loaded for "
            'this session. If it moved to a new address, tell the user and ask for the "Update connection" '
            "prompt from the Norn-M dashboard (API Keys, Connect an agent).",
            fmt,
        )
        return
    if not items:
        return
    emit("SessionStart", block("What Norn-M remembers about the user and this project:", items), fmt)
    state = load_state(agent, session_id)
    state["shown"] = [item["id"] for item in items]
    save_state(agent, session_id, state)


def recall(config, data, fmt):
    agent, session_id = config["agent"], data.get("session_id")
    prompt = str(data.get("prompt") or "").strip()
    state = load_state(agent, session_id)
    if prompt:
        # Kept for capture, for agents whose transcripts it can't read.
        state["prompt"] = prompt[:MAX_PROMPT]
        save_state(agent, session_id, state)
    if len(prompt) < MIN_PROMPT or prompt.startswith("/"):
        return
    project = project_of(data.get("cwd"))
    searches = [(prompt, 5)]
    if project:
        searches.append((prompt, 3, project))
    shown = set(state.get("shown", []))
    items = [item for item in gather(config, searches, RECALL_LIMIT) if item["id"] not in shown]
    if not items:
        return
    emit(
        "UserPromptSubmit",
        block(
            "Memories from Norn-M that may be relevant to this message (stored earlier; they can be out of date):",
            items,
        ),
        fmt,
    )
    state["shown"] = list(shown | {item["id"] for item in items})
    save_state(agent, session_id, state)


def capture(agent, data):
    """Hands the work to a detached copy of this script and returns at once."""
    if data.get("stop_hook_active"):
        return
    if os.name == "nt":
        detach = {"creationflags": 0x00000008 | 0x00000200}  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    else:
        detach = {"start_new_session": True}
    worker = subprocess.Popen(
        [sys.executable, str(Path(__file__).resolve()), "capture-worker", "--agent", agent],
        stdin=subprocess.PIPE,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        **detach,
    )
    worker.stdin.write(json.dumps(data).encode("utf-8"))
    worker.stdin.close()


def capture_worker(config, data):
    agent, session_id = config["agent"], data.get("session_id")
    state = load_state(agent, session_id)
    prompt, reply = last_exchange(data.get("transcript_path"))
    prompt = prompt or str(state.get("prompt") or "")
    reply = str(data.get("last_assistant_message") or "") or reply
    if len(prompt.strip()) < MIN_PROMPT:
        return
    fingerprint = hashlib.sha256(f"{prompt}\0{reply}".encode("utf-8")).hexdigest()
    if state.get("captured") == fingerprint:
        return
    messages = [{"role": "user", "content": prompt[:MAX_PROMPT]}]
    if reply.strip():
        messages.append({"role": "assistant", "content": reply[:MAX_REPLY]})
    body = {"messages": messages, "infer": True, "metadata": {"source": "norn-m-hook"}}
    if config.get("user_id"):
        body["user_id"] = config["user_id"]
    cwd = data.get("cwd")
    if cwd:
        body["cwd"] = str(cwd)
        body["project"] = project_of(cwd)
    call(config, "POST", "/memories", body, timeout=CAPTURE_TIMEOUT)
    state["captured"] = fingerprint
    save_state(agent, session_id, state)


def check(agent):
    config = load_config(agent)
    if config is None:
        print(f"No usable settings at {settings_path(agent)}: it needs at least url and api_key.")
        return 1
    try:
        search(config, "setup check", 1, floor=0.0)
    except ServerError as exc:
        reason = {401: "the API key was rejected", 403: "the API key isn't allowed to search"}.get(exc.status, "")
        print(
            f"Norn-M at {base_url(config)} answered HTTP {exc.status}: {reason or exc.detail or 'see the server log'}"
        )
        return 1
    except (OSError, ValueError) as exc:
        print(f"Could not reach Norn-M at {base_url(config)}: {exc}")
        return 1
    who = f"user {config['user_id']}" if config.get("user_id") else "the key's own user"
    print(f"OK: Norn-M at {base_url(config)} answered for {who} (hook script version {VERSION}).")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="Norn-M memory hooks for coding agents.")
    parser.add_argument("command", choices=["session-start", "recall", "capture", "capture-worker", "check"])
    parser.add_argument("--agent", required=True, help="the agent's name; settings come from ~/.norn-m/<agent>.json")
    parser.add_argument("--format", choices=["claude", "text"], default="claude")
    args = parser.parse_args(argv)
    agent = args.agent.strip().lower()
    if not AGENT_NAME.match(agent):
        print(f"Invalid agent name: {args.agent!r}", file=sys.stderr)
        return 2
    if args.command == "check":
        return check(agent)

    try:
        data = json.loads(sys.stdin.read() or "{}")
    except (ValueError, OSError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    config = load_config(agent)
    if config is None:
        return 0
    try:
        if args.command == "session-start":
            session_start(config, data, args.format)
        elif args.command == "recall":
            recall(config, data, args.format)
        elif args.command == "capture":
            capture(agent, data)
        else:
            capture_worker(config, data)
    except Exception:  # noqa: BLE001 - a memory hook must never break the agent
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
