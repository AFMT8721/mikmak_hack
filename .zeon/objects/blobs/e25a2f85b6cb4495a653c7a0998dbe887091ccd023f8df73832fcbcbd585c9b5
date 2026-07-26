# mikmak_hack — TEM-1 antibiotic-resistance screening, run by a robot

Built by Team MIKMAK for the AI for Science World Models Hack.

## What this project is

This is a **lab bench run by a robot**, described entirely in text files (no
proprietary lab notebook, no black-box software). It lives on
[Zeon](https://zeonsystems.app), a platform that lets you write a robot's motions
as Python "skills," chain them into "workflows" (like a flowchart), and run the
result either in a simulator or on a real robot arm.

On top of that bench, this repo adds an **automated science pipeline**: software
that plans experiments, checks them for safety, waits for a human to approve them,
watches for the robot to actually run them, and then reads the results and decides
what to try next — looping back to plan the following round automatically.

## What it's trying to find out

**TEM-1** is a bacterial enzyme that makes penicillin-family antibiotics stop
working — it's one of the most common reasons an antibiotic that should kill an
infection doesn't. This project screens a library of candidate drug compounds to
see which ones block TEM-1, and how strongly.

To get there, the robot runs three kinds of experiment, always in this order:

1. **Kinetics characterization** — a warm-up experiment with purified TEM-1
   enzyme and the color-changing test chemical (nitrocefin), at several strengths
   of each. This tells the pipeline what concentrations and timing will actually
   produce a readable result later.
2. **Make & confirm the enzyme** — the robot cell-free-manufactures TEM-1 from
   DNA (no living cells involved), then does a quick fluorescence check partway
   through to confirm it actually worked before spending a real screen on it.
3. **Screen a compound** — the robot adds one candidate drug (at several doses)
   plus the test chemical to the confirmed TEM-1 wells, then watches the reaction
   happen in real time on the plate reader. A compound that works makes the
   reaction visibly slower.

Every step above is one "round." Every round is logged — what was planned, what
was approved, what actually ran, and what was decided — so there's a full,
inspectable history of the whole campaign.

## How it's organized

| Folder | What's in it |
|---|---|
| `workflows/` | The step-by-step instructions the robot follows for each experiment type |
| `skills/` | The individual robot motions (pick up pipette, aspirate, dispense, read plate, ...) those workflows are built from |
| `canvas/` | The on-screen forms you fill in before pressing Run in the Zeon app |
| `pipeline/` | The automation described below — planning, checking, approving, watching, analyzing |
| `worlds/` | The 3D layout of the bench (what's on the deck and where) |
| `data/` | Results and logs from real runs (created once you start running things) |

## How the automation works, step by step

Think of it as five stations a round passes through:

1. **Plan** — decides the next experiment's exact settings (which compound,
   which doses, which wells) and writes them to a file under `inputs/`.
2. **Simulate** — a safety check. Runs the project's validator (and, once
   available, a robot-motion checker) against what Plan just wrote. If something
   looks wrong, the round is flagged and stops here.
3. **Approve** — a human reviews the plan and clicks Approve or Reject in a
   small web app. Nothing runs without this step.
4. **Execute** — **a person runs the workflow themselves**, in the Zeon app,
   using the file Plan wrote. The automation has no way to press Run for you —
   it just watches the `data/` folder and notices once your run has finished.
5. **Analyze** — once results land, this reads them, fits the science (does
   dose X block the enzyme? by how much?), and decides what the next round
   should try — which feeds back into step 1.

Every one of those five steps writes what happened to **beads**, a small
tracked history log (`bd` command, files under `.beads/`) — so at any point you
can see every round, what stage it's at, and why.

## Doing things as a user

### One-time setup

```bash
uv sync                      # installs the Python dependencies
brew install beads            # the bd command, if not already installed
```

### Plan the next experiment

```bash
uv run python -c "
import sys; sys.path.insert(0, 'pipeline')
from pipeline.agents.plan_agent import plan_and_record_kinetics_round
plan_and_record_kinetics_round()
"
```

(There's an equivalent `plan_and_record_inhibitor_round(...)` for the compound
screen, once a kinetics round has decided and you know which wells are
confirmed-expressed.) This prints a round ID like `mikmak-abc123` and writes its
settings to `inputs/mikmak-abc123.json`.

### Check the plan is safe

```bash
uv run python pipeline/simulate.py mikmak-abc123
```

### Approve it

```bash
uv run marimo run pipeline/apps/approve.py
```

Open the link it prints, pick your round, review the settings, click **Approve**.

### Run it for real

Open the [Zeon app](https://zeonsystems.app), open the matching workflow (e.g.
`cfps_inhibitor_dose_response`), and paste in the values from
`inputs/mikmak-abc123.json` — or use the on-screen canvas if the workflow has
one. Press **Run** yourself; only a person can start a real robot run.

### See what's happened / what it found

```bash
uv run marimo run pipeline/apps/dashboard.py
```

Shows every round, its current stage, and — once Analyze has run — the actual
fitted results (dose-response curves, IC50s, go/no-go calls).

### Check on a round any time

```bash
bd show mikmak-abc123          # this round's full history
bd list                        # every round tracked so far
```

## Things to know before you rely on results

- **The compound library is a placeholder.** `pipeline/library/compounds.csv`
  has 3 made-up example rows. Swap in the real list (same three columns:
  `compound_id,source_well,stock_conc_um`) and everything downstream just works.
- **Plate-reader parsing is a stub.** The step that reads the reader's exported
  report currently returns realistic-looking fake numbers, not real data, until
  a real sample export is available to build the real parser against.
- **Concentration ranges are placeholders**, clearly marked in the code, meant
  to be replaced with real values from whoever's running the wet-lab side.
- **Nothing here has been run on a real robot yet** — this has been checked by
  running the whole loop with fake stand-in data, and by the project's own
  automatic file checker (`scripts/validate.py`), which currently passes clean.

See `CLAUDE.md` for the full technical map of the project (for anyone editing
the workflows/skills directly rather than just running the pipeline).
