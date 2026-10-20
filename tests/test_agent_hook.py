"""Tests for the memory hook script agents install from /agent-hooks/norn_m_hook.py.

The script is standalone (standard library only), so it is loaded by path and run against a stub HTTP
server instead of the real API.
"""

import importlib.util
import io
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest.mock import patch

import pytest

SCRIPT = Path(__file__).resolve().parent.parent / "server" / "agent_hooks" / "norn_m_hook.py"


@pytest.fixture
def hook(tmp_path, monkeypatch):
    monkeypatch.setenv("NORN_M_HOME", str(tmp_path / "norn-m"))
    spec = importlib.util.spec_from_file_location("norn_m_hook", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class Stub:
    """A stand-in Norn-M API that records requests and answers from a script."""

    def __init__(self):
        self.requests = []
        self.search_results = []
        self.status = 200
        stub = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                stub.requests.append((self.path, self.headers, body))
                payload = {"results": stub.search_results} if self.path == "/search" else {"results": []}
                data = json.dumps(payload if stub.status == 200 else {"detail": "nope"}).encode()
                self.send_response(stub.status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *args):
                pass

        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def paths(self):
        return [path for path, _, _ in self.requests]


@pytest.fixture
def stub():
    server = Stub()
    yield server
    server.server.shutdown()


def write_settings(hook, url, **extra):
    hook.HOME.mkdir(parents=True, exist_ok=True)
    settings = {"url": url, "api_key": "nmsk_test_not_real", "user_id": "alice", "device": "mac", **extra}
    (hook.HOME / "claude-code.json").write_text(json.dumps(settings))


def run(hook, command, data, *args):
    out = io.StringIO()
    with patch("sys.stdin", io.StringIO(json.dumps(data))), patch("sys.stdout", out):
        code = hook.main([command, "--agent", "claude-code", *args])
    return code, out.getvalue()


def memory(id_, text, score, project=None):
    return {"id": id_, "memory": text, "score": score, "metadata": {"project": project} if project else None}


class TestTranscript:
    def test_takes_the_last_prompt_and_the_reply_after_it(self, hook, tmp_path):
        lines = [
            {"type": "user", "message": {"role": "user", "content": "first question"}},
            {"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": "old"}]}},
            {"type": "user", "message": {"role": "user", "content": "Use pnpm here, never npm"}},
            {"type": "assistant", "message": {"role": "assistant", "content": [{"type": "tool_use", "name": "Bash"}]}},
            {"type": "user", "message": {"role": "user", "content": [{"type": "tool_result", "content": "ok"}]}},
            {"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": "Noted."}]}},
        ]
        path = tmp_path / "t.jsonl"
        path.write_text("\n".join(json.dumps(line) for line in lines) + "\nnot json\n")

        assert hook.last_exchange(str(path)) == ("Use pnpm here, never npm", "Noted.")

    def test_skips_system_text_slash_commands_and_meta_entries(self, hook, tmp_path):
        lines = [
            {"type": "user", "message": {"role": "user", "content": "Deploy with the blue pipeline"}},
            {"type": "user", "isMeta": True, "message": {"role": "user", "content": "Caveat: generated"}},
            {"type": "user", "message": {"role": "user", "content": "<command-name>/clear</command-name>"}},
            {"type": "user", "message": {"role": "user", "content": "<system-reminder>x</system-reminder>"}},
        ]
        path = tmp_path / "t.jsonl"
        path.write_text("\n".join(json.dumps(line) for line in lines))

        assert hook.last_exchange(str(path)) == ("Deploy with the blue pipeline", "")

    def test_missing_transcript_is_empty(self, hook, tmp_path):
        assert hook.last_exchange(str(tmp_path / "gone.jsonl")) == ("", "")


class TestProject:
    def test_uses_the_git_repository_folder(self, hook, tmp_path):
        repo = tmp_path / "My-Repo"
        (repo / ".git").mkdir(parents=True)
        (repo / "src" / "deep").mkdir(parents=True)

        assert hook.project_of(str(repo / "src" / "deep")) == "my-repo"


class TestRecall:
    def test_adds_relevant_memories_once_per_session(self, hook, stub, tmp_path):
        write_settings(hook, stub.url + "/mcp")
        stub.search_results = [memory("m1", "Prefers pnpm", 0.7, "web"), memory("m2", "Unrelated", 0.2)]
        data = {"session_id": "s1", "prompt": "Which package manager should I use?", "cwd": str(tmp_path)}

        _, first = run(hook, "recall", data)
        _, second = run(hook, "recall", data)

        context = json.loads(first)["hookSpecificOutput"]
        assert context["hookEventName"] == "UserPromptSubmit"
        assert "- Prefers pnpm (web)" in context["additionalContext"]
        assert "Unrelated" not in context["additionalContext"]
        assert second == ""
        path, headers, body = stub.requests[0]
        assert path == "/search"
        assert body["filters"] == {"user_id": "alice"}
        assert headers["X-API-Key"] == "nmsk_test_not_real"
        assert headers["X-Norn-M-Agent"] == "claude-code"

    def test_short_prompts_and_slash_commands_are_not_searched(self, hook, stub):
        write_settings(hook, stub.url)

        run(hook, "recall", {"session_id": "s1", "prompt": "yes"})
        run(hook, "recall", {"session_id": "s1", "prompt": "/compact the conversation please"})

        assert stub.requests == []

    def test_text_format_prints_the_block(self, hook, stub):
        write_settings(hook, stub.url)
        stub.search_results = [memory("m1", "Prefers pnpm", 0.9)]

        _, out = run(hook, "recall", {"prompt": "Which package manager should I use?"}, "--format", "text")

        assert out.startswith("<norn-m-memories>")

    def test_a_failing_server_adds_nothing(self, hook, stub):
        write_settings(hook, stub.url)
        stub.status = 500

        assert run(hook, "recall", {"prompt": "Which package manager should I use?"}) == (0, "")


class TestSessionStart:
    def test_unreachable_server_warns_once_with_the_address(self, hook):
        write_settings(hook, "http://127.0.0.1:9")

        code, out = run(hook, "session-start", {"session_id": "s1"})

        assert code == 0
        context = json.loads(out)["hookSpecificOutput"]["additionalContext"]
        assert "http://127.0.0.1:9 did not answer" in context
        assert "Update connection" in context

    def test_rejected_key_says_so(self, hook, stub):
        write_settings(hook, stub.url)
        stub.status = 401

        _, out = run(hook, "session-start", {"session_id": "s1"})

        assert "rejected this agent's API key" in out

    def test_loads_profile_and_project_memories(self, hook, stub, tmp_path):
        write_settings(hook, stub.url)
        (tmp_path / "web" / ".git").mkdir(parents=True)
        stub.search_results = [memory("m1", "Likes short answers", 0.3)]

        _, out = run(hook, "session-start", {"session_id": "s1", "cwd": str(tmp_path / "web")})

        assert "Likes short answers" in out
        assert sorted(body.get("project", "") for _, _, body in stub.requests) == ["", "web"]

    def test_no_settings_file_is_silent(self, hook):
        assert run(hook, "session-start", {"session_id": "s1"}) == (0, "")


class TestCapture:
    def test_sends_the_exchange_with_provenance(self, hook, stub, tmp_path):
        write_settings(hook, stub.url)
        transcript = tmp_path / "t.jsonl"
        transcript.write_text(json.dumps({"type": "user", "message": {"role": "user", "content": "Always use UTC"}}))
        data = {
            "session_id": "s1",
            "transcript_path": str(transcript),
            "cwd": str(tmp_path),
            "last_assistant_message": "OK",
        }

        run(hook, "capture-worker", data)
        run(hook, "capture-worker", data)

        assert stub.paths() == ["/memories"]
        body = stub.requests[0][2]
        assert body["messages"] == [
            {"role": "user", "content": "Always use UTC"},
            {"role": "assistant", "content": "OK"},
        ]
        assert body["infer"] is True
        assert body["user_id"] == "alice"
        assert body["project"] == tmp_path.name.lower()

    def test_falls_back_to_the_prompt_recall_saw(self, hook, stub):
        write_settings(hook, stub.url, min_score=0.99)
        run(hook, "recall", {"session_id": "s2", "prompt": "Remember that staging deploys on Fridays"})

        run(hook, "capture-worker", {"session_id": "s2", "last_assistant_message": "Got it."})

        assert stub.requests[-1][2]["messages"][0]["content"] == "Remember that staging deploys on Fridays"

    def test_capture_detaches_and_returns_at_once(self, hook):
        write_settings(hook, "http://127.0.0.1:9")
        with patch.object(hook.subprocess, "Popen") as popen:
            run(hook, "capture", {"session_id": "s1"})

        command = popen.call_args.args[0]
        assert command[-3:] == ["capture-worker", "--agent", "claude-code"]
        popen.return_value.stdin.close.assert_called_once()


class TestCheck:
    def test_reports_ok(self, hook, stub):
        write_settings(hook, stub.url)

        code, out = run(hook, "check", {})

        assert code == 0
        assert out.startswith(f"OK: Norn-M at {stub.url} answered for user alice")
        assert "nmsk_" not in out

    def test_reports_a_rejected_key(self, hook, stub):
        write_settings(hook, stub.url)
        stub.status = 401

        code, out = run(hook, "check", {})

        assert code == 1
        assert "the API key was rejected" in out

    def test_rejects_agent_names_that_are_paths(self, hook):
        assert hook.main(["check", "--agent", "../etc"]) == 2
