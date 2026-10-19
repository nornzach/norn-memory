import importlib.metadata

__version__ = importlib.metadata.version("norn-m")

from norn_m.memory.main import AsyncMemory, Memory  # noqa
