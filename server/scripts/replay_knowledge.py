"""Evaluate extraction against labelled examples without writing proposals or memories."""

import argparse
import json
from pathlib import Path

from knowledge import Preview, preview


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("examples", type=Path)
    args = parser.parse_args()
    import main as server

    if not server.get_current_config().get("llm"):
        parser.error("Configure the server's LLM before replay.")

    failed = 0
    for row in json.loads(args.examples.read_text()):
        result = preview(Preview.model_validate({name: row[name] for name in ("project", "messages")}))
        kinds = {item["type"] for item in result["proposals"]}
        coverage = kinds | ({"procedure_or_troubleshooting"} if kinds & {"procedure", "troubleshooting"} else set())
        passed = kinds <= set(row["allowed"]) and set(row["required"]) <= coverage
        failed += not passed
        print(json.dumps({"name": row["name"], "passed_types": passed, **result}, ensure_ascii=False))
    return int(bool(failed))


if __name__ == "__main__":
    raise SystemExit(main())
