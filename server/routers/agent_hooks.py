"""Serves the hook script that the dashboard's agent setup prompt installs (see agent_hooks/norn_m_hook.py).

It is public: the script holds no secrets, and agents fetch it with curl before they have a key set up.
"""

from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse

HOOK_SCRIPT = Path(__file__).resolve().parent.parent / "agent_hooks" / "norn_m_hook.py"

router = APIRouter(prefix="/agent-hooks", tags=["agent hooks"])


@router.get("/norn_m_hook.py", summary="Download the memory hook script for coding agents")
def hook_script():
    return FileResponse(HOOK_SCRIPT, media_type="text/x-python; charset=utf-8", filename="norn_m_hook.py")
