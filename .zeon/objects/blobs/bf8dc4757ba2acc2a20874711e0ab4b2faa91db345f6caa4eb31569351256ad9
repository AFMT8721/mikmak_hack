import marimo

__generated_with = "0.23.15"
app = marimo.App(width="medium")


@app.cell
def _():
    import json
    import sys
    from pathlib import Path

    import marimo as mo

    PROJECT_ROOT = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(PROJECT_ROOT / "pipeline"))

    BEADS_JSONL = PROJECT_ROOT / ".beads" / "issues.jsonl"
    RESULTS_DIR = PROJECT_ROOT / "pipeline" / "results"
    return BEADS_JSONL, RESULTS_DIR, json, mo


@app.cell
def _(mo):
    mo.md("""
    # TEM1 CFPS screening — audit + results

    Reads `.beads/issues.jsonl` (the passive export of the single-writer beads
    DAG — see `pipeline/beads_writer.py`) for round history, and
    `pipeline/results/<round_id>.json` (written by `analyze_agent.py`) for fits.
    Nothing here writes to beads; this is a read-only view.
    """)
    return


@app.cell
def _(BEADS_JSONL, json, mo):
    if not BEADS_JSONL.exists() or not BEADS_JSONL.read_text().strip():
        mo.stop(True, mo.md("No beads yet — plan a round first (`pipeline/agents/plan_agent.py`)."))

    all_issues = {}
    for line in BEADS_JSONL.read_text().splitlines():
        line = line.strip()
        if not line:
            continue
        _rec = json.loads(line)
        all_issues[_rec["id"]] = _rec

    def label_value(rec, prefix):
        for lbl in rec.get("labels", []):
            if lbl.startswith(prefix):
                return lbl[len(prefix):]
        return None

    rounds = {
        rid: _rec for rid, _rec in all_issues.items()
        if _rec.get("issue_type") == "task" and "." not in rid and label_value(_rec, "assay:")
    }
    return all_issues, label_value, rounds


@app.cell
def _(label_value, mo, rounds):
    table_rows = [
        {
            "round_id": rid,
            "assay_type": label_value(_rec, "assay:"),
            "stage": label_value(_rec, "stage:"),
            "title": _rec.get("title", ""),
            "created_at": _rec.get("created_at", ""),
        }
        for rid, _rec in sorted(rounds.items(), key=lambda kv: kv[1].get("created_at", ""))
    ]
    mo.vstack([mo.md(f"**{len(table_rows)}** round(s) tracked."), mo.ui.table(table_rows, selection=None)])
    return


@app.cell
def _(mo, rounds):
    picker = mo.ui.dropdown(
        options={f"{rid} — {rec.get('title', '')}": rid for rid, rec in rounds.items()},
        label="Inspect a round",
    )
    picker
    return (picker,)


@app.cell
def _(all_issues, label_value, mo, picker, rounds):
    if not picker.value:
        mo.stop(True, mo.md("Pick a round above."))

    round_id = picker.value
    round_rec = rounds[round_id]

    children = [
        v for v in all_issues.values()
        if v.get("id", "").startswith(f"{round_id}.") and v.get("issue_type") == "task"
    ]
    exec_rows = [
        {
            "kind": label_value(c, "execution_kind:"),
            "execution_id": (c.get("metadata") or {}).get("execution_id"),
            "id": c["id"],
        }
        for c in children
    ]

    blocks = [
        dep["depends_on_id"] for dep in round_rec.get("dependencies", [])
        if dep.get("type") == "blocks"
    ]

    mo.vstack(
        [
            mo.md(f"## {round_id}"),
            mo.md(f"assay: `{label_value(round_rec, 'assay:')}` · stage: `{label_value(round_rec, 'stage:')}`"),
            mo.md(f"blocked on: {', '.join(blocks) if blocks else '_nothing_'}"),
            mo.md("### Linked executions"),
            mo.ui.table(exec_rows, selection=None) if exec_rows else mo.md("_none yet_"),
        ]
    )
    return (round_id,)


@app.cell
def _(RESULTS_DIR, json, mo, round_id):
    result_path = RESULTS_DIR / f"{round_id}.json"
    if not result_path.exists():
        mo.stop(True, mo.md("_No analysis results yet for this round (Analyze hasn't run)._"))
    results = json.loads(result_path.read_text())
    return (results,)


@app.cell
def _(mo, results, round_id):
    assay_guess = "inhibitor" if "fit" in results and "doses_ul" in results else (
        "kinetics" if "fits" in results else "cfps_expression"
    )

    if assay_guess == "kinetics":
        _kinetics_rows = [{"grid_point": k, **v} for k, v in results["fits"].items()]
        body = mo.vstack(
            [
                mo.ui.table(_kinetics_rows, selection=None),
                mo.md(
                    f"**Recommendation:** nitrocefin level `{results['recommended_nitrocefin_level']}`, "
                    f"endpoint `{results['recommended_endpoint_minutes']} min` "
                    f"(best fit: `{results['best_fit']}`)"
                ),
            ]
        )
    elif assay_guess == "inhibitor":
        svg = _svg_dose_response(results["doses_ul"], results["response"], results["fit"])
        fit = results["fit"]
        ic50_line = f"**IC50 ≈ {fit['ic50']:.3g} µL-equivalent** (Hill slope {fit['hill_slope']:.2f})" if "ic50" in fit else fit.get("note", "")
        body = mo.vstack([mo.md(f"### {results.get('compound_id', '')}"), mo.Html(svg), mo.md(ic50_line)])
    else:
        go = results.get("go")
        banner = mo.md(f"## {'✅ GO' if go else '❌ NO-GO'}")
        body = mo.vstack(
            [
                banner,
                mo.md(
                    f"positive: `{results.get('pos_mean')}` · negative: `{results.get('neg_mean')}` · "
                    f"sample: `{results.get('sample_mean')}`"
                ),
            ]
        )

    mo.vstack([mo.md(f"### Analysis — {round_id}"), body])
    return


if __name__ == "__main__":
    app.run()
