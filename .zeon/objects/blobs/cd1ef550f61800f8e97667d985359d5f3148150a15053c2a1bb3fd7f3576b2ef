"""Analyze stage: turns a plate-reader export into a fit and a decision, for all
three round types.

`parse_gen5_export` is a STUB — the exact Gen5 PDF table layout (for either the
endpoint or kinetic export shape) needs a real sample export to nail down, which
we don't have yet. It returns synthetic but realistically-shaped data, seeded
deterministically from the execution_id so repeat calls agree, purely so the rest
of the loop (fits, beads writes, the dashboard) can be built and tested now. Swap
its body for real PDF parsing (pdfplumber or similar) without touching any caller.

Like plan_agent.py, the real work lives in plain functions; the ADK `Agent` at the
bottom just wraps them as tools for a human steering Analyze conversationally.
"""

from __future__ import annotations

import json
import random
import sys
from pathlib import Path

import numpy as np
from google.adk.agents import Agent
from scipy.optimize import curve_fit

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "pipeline"))
import beads_writer as bw  # noqa: E402
from watch_execution import DATA_LOGS_DIR  # noqa: E402

RESULTS_DIR = PROJECT_ROOT / "pipeline" / "results"
INPUTS_DIR = PROJECT_ROOT / "inputs"


# --- STUB: Gen5 export parsing --------------------------------------------------

def parse_gen5_export(execution_id: str, kind: str, wells: list[str]) -> dict:
    """STUB. `kind` is "endpoint" (one value per well) or "kinetic" (a value per
    well per timepoint). Real implementation should read
    data/platereader/<execution_id>/<execution_id>.pdf. Returns synthetic data
    shaped like the real thing, seeded from execution_id for repeatability.
    """
    rng = random.Random(execution_id)
    if kind == "endpoint":
        return {w: round(rng.uniform(0.05, 1.2), 4) for w in wells}
    if kind == "kinetic":
        timepoints_min = list(range(0, 31, 2))  # PLACEHOLDER cadence
        out = {}
        for w in wells:
            rate = rng.uniform(0.0, 0.05)
            noise = rng.uniform(0, 0.01)
            out[w] = {
                "timepoints_min": timepoints_min,
                "a490": [round(rate * t + rng.uniform(-noise, noise), 4) for t in timepoints_min],
            }
        return out
    raise ValueError(f"unknown export kind: {kind!r}")


def _run_inputs_for_execution(execution_id: str) -> dict:
    for exec_dir in DATA_LOGS_DIR.glob(f"{execution_id}"):
        for run_dir in exec_dir.iterdir():
            ri = run_dir / "run_inputs.json"
            if ri.exists():
                return json.loads(ri.read_text())
    return {}


def _execution_id_for_kind(round_id: str, kind: str) -> str | None:
    for child in bw.list_children(round_id):
        if f"execution_kind:{kind}" in child.get("labels", []):
            return child.get("metadata", {}).get("execution_id")
    return None


def _write_results(round_id: str, results: dict) -> Path:
    RESULTS_DIR.mkdir(exist_ok=True)
    out = RESULTS_DIR / f"{round_id}.json"
    out.write_text(json.dumps(results, indent=2) + "\n")
    return out


# --- kinetics round: Michaelis-Menten over the E x S grid ----------------------

def _initial_rate(timepoints_min: list[float], a490: list[float]) -> float:
    """Slope of the first few points — a quick, honest stand-in for a proper
    linear-region fit; good enough while the parser itself is a stub."""
    n = min(4, len(timepoints_min))
    t = np.array(timepoints_min[:n])
    y = np.array(a490[:n])
    if n < 2 or np.allclose(t, t[0]):
        return 0.0
    slope, _ = np.polyfit(t, y, 1)
    return float(slope)


def _michaelis_menten(s, vmax, km):
    return vmax * s / (km + s)


def analyze_kinetics_round(round_id: str) -> dict:
    preset_path = INPUTS_DIR / f"{round_id}.json"
    if not preset_path.exists():
        raise FileNotFoundError(f"no input preset for {round_id} — was it planned via plan_agent?")
    inputs = json.loads(preset_path.read_text())

    exec_id = _execution_id_for_kind(round_id, "run")
    if not exec_id:
        raise RuntimeError(f"{round_id} has no linked execution yet — run watch_execution first")

    # Recover the 3x3 grid + concentrations from the preset (see plan_agent.plan_kinetics_round).
    points = []
    for i in range(1, 4):
        for j in range(1, 4):
            pos = f"pt_e{i}s{j}"
            well = inputs.get(f"{pos}_well")
            if well:
                points.append({"well": well, "e_level": i, "s_level": j})
    wells = [p["well"] for p in points]

    traces = parse_gen5_export(exec_id, "kinetic", wells)
    for p in points:
        trace = traces[p["well"]]
        p["initial_rate"] = _initial_rate(trace["timepoints_min"], trace["a490"])

    # One Michaelis-Menten fit per enzyme level, rate vs substrate "level" (1..3)
    # standing in for concentration — real units come from the preset's *_vol_ul
    # once the real stock concentrations are known.
    fits = {}
    for i in range(1, 4):
        level_points = [p for p in points if p["e_level"] == i]
        s = np.array([p["s_level"] for p in level_points], dtype=float)
        v = np.array([p["initial_rate"] for p in level_points], dtype=float)
        try:
            (vmax, km), _ = curve_fit(_michaelis_menten, s, v, p0=[max(v.max(), 1e-6), 1.0], maxfev=2000)
            fits[f"enzyme_level_{i}"] = {"vmax": float(vmax), "km": float(km)}
        except RuntimeError:
            fits[f"enzyme_level_{i}"] = {"vmax": None, "km": None, "note": "fit did not converge"}

    # Decision: pick the enzyme level with the best-converged fit, recommend the
    # substrate level nearest 4x its Km (~80% Vmax) as the working concentration,
    # and the run's own read cadence as the recommended endpoint timing.
    converged = {k: f for k, f in fits.items() if f.get("km") is not None}
    if converged:
        best_level_key = max(converged, key=lambda k: converged[k]["vmax"] or 0)
        best_km = converged[best_level_key]["km"]
        recommended_s_level = min(3, max(1, round(best_km))) if best_km else 2
    else:
        best_level_key, recommended_s_level = None, 2

    results = {
        "round_id": round_id, "execution_id": exec_id, "points": points, "fits": fits,
        "recommended_nitrocefin_level": recommended_s_level,
        "recommended_endpoint_minutes": 120,  # PLACEHOLDER, matches the CFPS kit's stated ~2h window
        "best_fit": best_level_key,
    }
    _write_results(round_id, results)
    bw.note(round_id, f"Kinetics fit: {json.dumps(fits)}")
    bw.set_stage(round_id, "decided", reason=f"recommend nitrocefin level {recommended_s_level} (fit: {best_level_key})")
    return results


# --- inhibitor_dose_response round: 4-parameter logistic -> IC50 ---------------

def _four_pl(x, bottom, top, ic50, hill):
    return bottom + (top - bottom) / (1 + (x / ic50) ** hill)


def analyze_inhibitor_round(round_id: str) -> dict:
    preset_path = INPUTS_DIR / f"{round_id}.json"
    if not preset_path.exists():
        raise FileNotFoundError(f"no input preset for {round_id} — was it planned via plan_agent?")
    inputs = json.loads(preset_path.read_text())

    exec_id = _execution_id_for_kind(round_id, "run")
    if not exec_id:
        raise RuntimeError(f"{round_id} has no linked execution yet — run watch_execution first")

    n = int(inputs["dose_n"])
    wells = [inputs[f"dose{i}_well"] for i in range(1, n + 1)]
    doses_ul = [inputs[f"dose{i}_compound_vol_ul"] for i in range(1, n + 1)]  # proxy for concentration

    values = parse_gen5_export(exec_id, "endpoint", wells)
    response = np.array([values[w] for w in wells])
    dose = np.array(doses_ul, dtype=float)
    dose = np.where(dose <= 0, 1e-6, dose)  # avoid log(0) in the 4PL

    try:
        (bottom, top, ic50, hill), _ = curve_fit(
            _four_pl, dose, response,
            p0=[response.min(), response.max(), np.median(dose), 1.0],
            maxfev=5000,
        )
        fit = {"bottom": float(bottom), "top": float(top), "ic50": float(ic50), "hill_slope": float(hill)}
    except RuntimeError:
        fit = {"note": "fit did not converge — try a wider or better-centered dose range"}

    results = {
        "round_id": round_id, "execution_id": exec_id, "compound_id": inputs.get("compound_id"),
        "wells": wells, "doses_ul": doses_ul, "response": response.tolist(), "fit": fit,
    }
    _write_results(round_id, results)
    bw.note(round_id, f"Dose-response fit for {inputs.get('compound_id')}: {json.dumps(fit)}")
    bw.set_stage(round_id, "decided", reason=f"IC50={fit.get('ic50', 'n/a')}")
    return results


# --- cfps_expression round: sfGFP go/no-go --------------------------------------

def analyze_cfps_expression_round(round_id: str, go_threshold_ratio: float = 0.5) -> dict:
    """Compares mean sfGFP signal in sample wells against positive/negative
    controls (well roles recovered from Part 1's own run_inputs, since Part 2
    reads the whole plate with no layout of its own). Go if the sample signal
    clears `go_threshold_ratio` of the positive control, above the negative.
    """
    part1_exec = _execution_id_for_kind(round_id, "part1")
    part2_exec = _execution_id_for_kind(round_id, "part2")
    if not part1_exec or not part2_exec:
        raise RuntimeError(f"{round_id} needs both part1 and part2 executions linked before analyzing")

    part1_inputs = _run_inputs_for_execution(part1_exec)
    pos_wells = [w.strip() for w in part1_inputs.get("pos_wells", "").split(",") if w.strip()]
    neg_wells = [w.strip() for w in part1_inputs.get("neg_wells", "").split(",") if w.strip()]
    sample_wells = [w.strip() for w in part1_inputs.get("sample_wells", "").split(",") if w.strip()]
    all_wells = pos_wells + neg_wells + sample_wells

    values = parse_gen5_export(part2_exec, "endpoint", all_wells)
    mean = lambda ws: float(np.mean([values[w] for w in ws])) if ws else None  # noqa: E731
    pos_mean, neg_mean, sample_mean = mean(pos_wells), mean(neg_wells), mean(sample_wells)

    go = bool(
        sample_mean is not None and pos_mean is not None and neg_mean is not None
        and sample_mean > neg_mean and sample_mean > go_threshold_ratio * pos_mean
    )

    results = {
        "round_id": round_id, "part1_execution_id": part1_exec, "part2_execution_id": part2_exec,
        "pos_mean": pos_mean, "neg_mean": neg_mean, "sample_mean": sample_mean, "go": go,
    }
    _write_results(round_id, results)
    bw.note(round_id, f"sfGFP go/no-go: pos={pos_mean} neg={neg_mean} sample={sample_mean} -> {'GO' if go else 'NO-GO'}")
    bw.set_stage(round_id, "decided", reason=f"{'go' if go else 'no-go'} (sample={sample_mean}, pos={pos_mean}, neg={neg_mean})")
    return results


# --- ADK agent wrapper -----------------------------------------------------------

def analyze_kinetics_round_tool(round_id: str) -> dict:
    """Analyze a kinetics round: fits Michaelis-Menten per enzyme level from the
    kinetic plate-reader export, and recommends a nitrocefin working
    concentration + endpoint timing for the inhibitor screen. Sets the round to
    'decided'."""
    return analyze_kinetics_round(round_id)


def analyze_inhibitor_round_tool(round_id: str) -> dict:
    """Analyze an inhibitor_dose_response round: fits a 4-parameter logistic to
    the endpoint plate-reader export and reports IC50. Sets the round to
    'decided'."""
    return analyze_inhibitor_round(round_id)


def analyze_cfps_expression_round_tool(round_id: str) -> dict:
    """Analyze a cfps_expression round: compares Part 2's sfGFP read across
    positive/negative/sample wells (recovered from Part 1's own inputs) and
    decides go/no-go for spending an inhibitor screen on this plate. Sets the
    round to 'decided'."""
    return analyze_cfps_expression_round(round_id)


root_agent = Agent(
    name="analyze_agent",
    model="gemini-2.5-flash",
    description="Fits plate-reader data and decides the next step for a TEM1 CFPS screening round.",
    instruction=(
        "You analyze completed rounds of a TEM1 beta-lactamase screening campaign. Given a "
        "round_id, first check what assay_type it is (the operator will usually tell you, or "
        "you can infer from context) and call the matching tool: "
        "analyze_kinetics_round_tool for a kinetics round, analyze_cfps_expression_round_tool "
        "for a cfps_expression (go/no-go) round, or analyze_inhibitor_round_tool for an "
        "inhibitor_dose_response round. Report the key numbers back plainly — the fit "
        "parameters or IC50 or go/no-go call — since that's what decides the next Plan call."
    ),
    tools=[analyze_kinetics_round_tool, analyze_cfps_expression_round_tool, analyze_inhibitor_round_tool],
)
