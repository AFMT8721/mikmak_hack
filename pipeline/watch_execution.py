"""Execute stage: notices when a human-triggered Zeon run has landed, links it to
the round, and (for cfps_expression rounds) creates the gap-timer gate between
Part 1 and Part 2. Never triggers a run itself — the zeon CLI has no run command;
runs only start from the Zeon app, by a person (per this project's CLAUDE.md).

Matches a round to a physical run by `run_name`: every workflow here declares
`run_name` as an input, so it round-trips into
data/logs/<execution_id>/<run_name>_<timestamp>/run_inputs.json once
save_run_folder (the last node of every workflow) writes it.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "pipeline"))
import beads_writer as bw  # noqa: E402

DATA_LOGS_DIR = PROJECT_ROOT / "data" / "logs"
DATA_PLATEREADER_DIR = PROJECT_ROOT / "data" / "platereader"
INPUTS_DIR = PROJECT_ROOT / "inputs"

# PLACEHOLDER — minutes between Part 1 starting the shaker and running Part 2's
# sfGFP check (canvas doc: "green signal has appeared as early as ~30 min").
CFPS_EXPRESSION_CONFIRM_DELAY_MINUTES = 30


def expected_run_name(round_id: str) -> str | None:
    """The run_name a Plan-generated preset asked the operator to use — only
    exists for kinetics/inhibitor_dose_response rounds (cfps_expression rounds
    are set up by hand via cfps_mastermix's own canvas, no preset)."""
    preset = INPUTS_DIR / f"{round_id}.json"
    if not preset.exists():
        return None
    return json.loads(preset.read_text()).get("run_name")


def find_execution_by_run_name(run_name: str | None) -> str | None:
    if not run_name or not DATA_LOGS_DIR.exists():
        return None
    for exec_dir in DATA_LOGS_DIR.iterdir():
        if not exec_dir.is_dir():
            continue
        for run_dir in exec_dir.iterdir():
            ri = run_dir / "run_inputs.json"
            if not ri.exists():
                continue
            try:
                inputs = json.loads(ri.read_text())
            except json.JSONDecodeError:
                continue
            if inputs.get("run_name") == run_name:
                return exec_dir.name
    return None


def platereader_export_ready(execution_id: str) -> bool:
    d = DATA_PLATEREADER_DIR / execution_id
    return d.exists() and any(d.iterdir())


def watch_single_execution_round(round_id: str, run_name: str | None = None) -> dict:
    """kinetics / inhibitor_dose_response: one execution, one platereader export."""
    round_ = bw.show_round(round_id)
    stage = round_.get("_stage")
    run_name = run_name or expected_run_name(round_id)
    exec_id = find_execution_by_run_name(run_name)

    if exec_id is None:
        return {"status": "waiting_for_execution", "run_name": run_name}

    if stage == "approved":
        bw.set_stage(round_id, "running", reason=f"detected execution {exec_id}")
    if not any(c.get("metadata", {}).get("execution_id") == exec_id for c in bw.list_children(round_id)):
        bw.link_execution(round_id, "run", exec_id)

    if platereader_export_ready(exec_id):
        return {"status": "ready_for_analyze", "execution_id": exec_id}
    return {"status": "running", "execution_id": exec_id}


def _has_kind(children: list[dict], kind: str) -> bool:
    return any(f"execution_kind:{kind}" in c.get("labels", []) for c in children)


def watch_cfps_expression_round(
    round_id: str,
    part1_run_name: str,
    part2_run_name: str | None = None,
) -> dict:
    """cfps_expression: two hand-run executions (the existing cfps_mastermix
    canvas, then cfps_sfgfp_confirmation), bridged by a beads timer gate. Both
    run names are supplied by the operator — Part 1's own canvas already does
    condition planning, so this round type has no Plan-generated input preset.
    """
    round_ = bw.show_round(round_id)
    stage = round_.get("_stage")
    children = bw.list_children(round_id)

    if not _has_kind(children, "part1"):
        exec1 = find_execution_by_run_name(part1_run_name)
        if exec1 is None:
            return {"status": "waiting_for_part1", "run_name": part1_run_name}
        if stage == "approved":
            bw.set_stage(round_id, "running", reason=f"Part 1 execution {exec1} detected")
        bw.link_execution(round_id, "part1", exec1)
        gate_id = bw.create_timer_gate(
            round_id, CFPS_EXPRESSION_CONFIRM_DELAY_MINUTES,
            reason="waiting to run Part 2 (sfGFP confirmation)",
        )
        bw.set_metadata(round_id, pending_gate_id=gate_id)
        return {"status": "part1_detected_awaiting_gate", "execution_id": exec1, "gate_id": gate_id}

    if not _has_kind(children, "part2"):
        if not part2_run_name:
            return {"status": "part1_done_awaiting_part2_run_name"}
        exec2 = find_execution_by_run_name(part2_run_name)
        if exec2 is None:
            return {"status": "waiting_for_part2", "run_name": part2_run_name}
        bw.link_execution(round_id, "part2", exec2)
        return {"status": "ready_for_analyze", "execution_id": exec2}

    return {"status": "already_complete"}


if __name__ == "__main__":
    import argparse
    import time

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("round_id")
    parser.add_argument("--part1-run-name", help="cfps_expression rounds only")
    parser.add_argument("--part2-run-name", help="cfps_expression rounds only")
    parser.add_argument("--poll-seconds", type=int, default=0, help="0 = check once and exit")
    args = parser.parse_args()

    def check() -> dict:
        round_ = bw.show_round(args.round_id)
        if round_.get("_assay_type") == "cfps_expression":
            return watch_cfps_expression_round(args.round_id, args.part1_run_name, args.part2_run_name)
        return watch_single_execution_round(args.round_id)

    while True:
        result = check()
        print(json.dumps(result))
        if not args.poll_seconds or result["status"] in ("ready_for_analyze", "already_complete"):
            break
        time.sleep(args.poll_seconds)
