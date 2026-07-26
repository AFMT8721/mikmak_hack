// Canvas for the `cfps_inhibitor_dose` workflow (Part 3a of the TEM-1 screen).
//
// Doses up to 4 concentration groups of an already-expressed TEM1 plate (built by
// cfps_mastermix / Part 1, confirmed by cfps_sfgfp_confirmation / Part 2) from a
// pre-arrayed compound library plate holding one working-stock well per
// concentration. Per the project's dose-response plate map (one compound per run,
// 4 concentrations x 2 duplicate wells per row — see
// exp2_100ul_report.md's Plate/well layout section), each group's two duplicate
// wells get the identical compound at the identical concentration, so they share
// one tip and one source well: attach once, aspirate the combined (2x) volume
// once, dispense the per-well volume into each duplicate, eject once. No
// nitrocefin and no reader here — after this run, let the compound incubate with
// the enzyme off-robot, add nitrocefin by hand, then run
// cfps_inhibitor_kinetic_read (Part 3b) to load the reader.
//
// Sandboxed iframe contract: only `react` may be imported, no network/FS, all host
// communication via the injected `zeon.*` globals; `export default` the component.
// Object inputs submit the world-object NAME (never a UUID).
//
// height/overflow on S.page is a deliberate deviation from the canvas doc's "don't
// set your own scroll container" guidance — confirmed with Zeon as the right call
// for this workflow family, where the host's own auto-resize wasn't reaching every
// row. 100vh caps the canvas to its own iframe viewport so it scrolls internally no
// matter what height the host actually grants the iframe.

import React, { useEffect, useMemo, useState } from "react";

declare const zeon: {
  schema: { name: string; type: string; description?: string; defaultValue?: unknown; isArray?: boolean }[];
  worldObjects: { uuid: string; name: string; displayName?: string; meshType?: string }[];
  // NOT the workflow's declared defaults — these are previously *staged* values:
  // a sessionStorage draft, or the saved inputs of a live (running/paused) run,
  // replayed on every mount. The pipeline's planned round arrives via
  // `schema[].defaultValue` instead, so both are consulted below and the planned
  // round wins.
  defaults: Record<string, unknown>;
  submit: (values: Record<string, unknown>) => void;
  onValidationErrors: (cb: (errs: { path: string; message: string }[]) => void) => void;
  resetInputs?: () => void;
};

const ROWS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const COLS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const MAX_GROUPS = 4;

// Mirrors skills/utils.py PIPETTES — (min, max) draw volume in uL per pipette.
// Used only to warn client-side whether a group's combined (2x) aspirate fits in
// one draw; the authoritative limits still live in the skill layer.
const PIPETTE_LIMITS: Record<string, [number, number]> = {
  epipette_10ul: [0.5, 10.0],
  epipette_120ul: [10.0, 120.0],
};
const pipetteLimits = (name: string): [number, number] => {
  const key = Object.keys(PIPETTE_LIMITS).find((k) => name.toLowerCase().includes(k.replace("epipette_", "")));
  return PIPETTE_LIMITS[key || "epipette_10ul"] || PIPETTE_LIMITS.epipette_10ul;
};

const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const MONO = "ui-monospace, 'SF Mono', 'JetBrains Mono', Menlo, Consolas, monospace";
const INK = "#16231C", MUTE = "#5B6B62", FAINT = "#94A29A";
const LINE = "#E3E8E3", HAIR = "#EFF2EF", PAPER = "#FCFCFA";
const ACCENT = "#9D174D", ACCENT_SOFT = "#FBEAF1"; // same family accent as Part 3b (nitrocefin-red)
const GROUP_COLORS = ["#9D174D", "#B45309", "#3F6212", "#1D4ED8"]; // one per concentration group

const S: Record<string, React.CSSProperties> = {
  page: { fontFamily: SANS, color: INK, background: PAPER, padding: "34px 26px 46px", maxWidth: 780, margin: "0 auto", fontSize: 14, lineHeight: 1.55, WebkitFontSmoothing: "antialiased", height: "100vh", boxSizing: "border-box", overflowY: "auto" },
  eyebrow: { fontFamily: MONO, fontSize: 11, fontWeight: 600, letterSpacing: 1.6, textTransform: "uppercase", color: MUTE, margin: "0 0 12px", display: "flex", alignItems: "center", gap: 8 },
  h1: { fontFamily: SANS, fontSize: 27, fontWeight: 800, letterSpacing: -0.7, lineHeight: 1.05, margin: "0 0 10px", color: INK },
  sub: { fontSize: 13.5, color: MUTE, margin: "0 0 4px", lineHeight: 1.6, maxWidth: "70ch" },
  rule: { height: 1, background: LINE, border: 0, margin: "22px 0 2px" },
  h2: { fontFamily: MONO, fontSize: 11, fontWeight: 700, margin: "36px 0 12px", paddingTop: 18, color: INK, textTransform: "uppercase", letterSpacing: 1.3, borderTop: `1px solid ${LINE}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 },
  smallBtn: { fontFamily: MONO, fontSize: 10.5, fontWeight: 700, color: ACCENT, background: "#fff", border: `1px solid ${LINE}`, borderRadius: 5, padding: "4px 9px", cursor: "pointer", textTransform: "uppercase", letterSpacing: 0.4, whiteSpace: "nowrap" },
  staleBox: { background: "#FDF6E3", border: "1px solid #E5D5A8", borderRadius: 8, padding: "11px 13px", marginTop: 12, fontSize: 12.5, color: "#6B5518", lineHeight: 1.5 },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px" },
  label: { display: "block", fontFamily: MONO, fontSize: 10.5, fontWeight: 600, margin: "12px 0 5px", color: MUTE, textTransform: "uppercase", letterSpacing: 0.6 },
  field: { width: "100%", boxSizing: "border-box", padding: "9px 11px", fontFamily: SANS, fontSize: 13.5, border: `1px solid ${LINE}`, borderRadius: 7, background: "#fff", color: INK, outline: "none" },
  card: { border: `1px solid ${LINE}`, borderRadius: 8, padding: 14, marginTop: 12, background: "#fff" },
  plate: { display: "inline-grid", gridTemplateColumns: `20px repeat(12, 27px)`, gap: 4, userSelect: "none" },
  hdr: { fontFamily: MONO, fontSize: 9.5, color: FAINT, textAlign: "center", lineHeight: "27px" },
  cell: { width: 27, height: 27, borderRadius: 5, border: `1px solid ${LINE}`, fontFamily: MONO, fontSize: 9, cursor: "pointer", color: "#fff", fontWeight: 700, padding: 0 },
  table: { width: "100%", borderCollapse: "collapse", fontFamily: SANS, fontSize: 12.5, marginTop: 10 },
  th: { fontFamily: MONO, textAlign: "left", padding: "7px 8px", borderBottom: `1.5px solid ${INK}`, color: MUTE, fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 },
  td: { fontFamily: SANS, textAlign: "left", padding: "6px 8px", borderBottom: `1px solid ${HAIR}` },
  numInput: { width: 72, boxSizing: "border-box", padding: "5px 7px", fontFamily: MONO, fontSize: 12.5, border: `1px solid ${LINE}`, borderRadius: 5, background: "#fff", color: INK },
  textInput: { width: 68, boxSizing: "border-box", padding: "5px 7px", fontFamily: MONO, fontSize: 12.5, border: `1px solid ${LINE}`, borderRadius: 5, background: "#fff", color: INK },
  errorBox: { background: "#FBEEEB", border: "1px solid #E7C1B9", borderRadius: 8, padding: "11px 13px", marginTop: 14, fontSize: 13, color: "#8E2C1E", lineHeight: 1.5 },
  button: { width: "100%", marginTop: 24, padding: "14px 16px", fontFamily: SANS, fontSize: 14.5, fontWeight: 700, letterSpacing: 0.2, color: "#fff", background: ACCENT, border: "none", borderRadius: 8, cursor: "pointer" },
  removeBtn: { fontFamily: MONO, fontSize: 11, fontWeight: 700, color: MUTE, background: "#fff", border: `1px solid ${LINE}`, borderRadius: 5, padding: "3px 8px", cursor: "pointer" },
};

const objName = (o: { name?: string; displayName?: string; uuid: string }) => o.displayName || o.name || o.uuid;

const plannedValue = (k: string): unknown => zeon.schema?.find((s) => s.name === k)?.defaultValue;
const stagedValue = (k: string): unknown => zeon.defaults?.[k];
// Planned wins — see the note on `defaults` above.
const rawDefault = (k: string): unknown => {
  const p = plannedValue(k);
  if (p !== undefined && p !== null && p !== "") return p;
  return stagedValue(k);
};
type Source = "auto" | "planned" | "staged";
const pickBy = (source: Source) => {
  const get = source === "planned" ? plannedValue : source === "staged" ? stagedValue : rawDefault;
  return {
    s: (k: string, fb: string) => (typeof get(k) === "string" && get(k) !== "" ? (get(k) as string) : fb),
    n: (k: string, fb: number) => (typeof get(k) === "number" ? (get(k) as number) : fb),
  };
};
const strDefault = (k: string, fb: string) => pickBy("auto").s(k, fb);

// A concentration group doses a shared source well into a duplicate PAIR of
// destination wells, one tip and one aspirate covering both (see the workflow's
// dose{i}_* inputs: well_a/well_b share tip_index and total_vol_ul).
type GroupPos = { wellA: string; wellB: string; srcWell: string; volUl: number };

// A planned round declares dose_n groups; without this the table opened empty
// and every well, source, and volume had to be re-entered by hand.
const groupsFrom = (source: Source): GroupPos[] => {
  const { s, n } = pickBy(source);
  const count = Math.min(n("dose_n", 0), MAX_GROUPS);
  const out: GroupPos[] = [];
  for (let i = 1; i <= count; i++) {
    const wellA = s(`dose${i}_well_a`, "");
    const wellB = s(`dose${i}_well_b`, "");
    if (!wellA && !wellB) continue;
    out.push({
      wellA,
      wellB,
      srcWell: s(`dose${i}_src_well`, ""),
      volUl: n(`dose${i}_vol_ul`, 0),
    });
  }
  return out;
};

export default function CfpsInhibitorDoseScreen() {
  const pick = (match: (m: string) => boolean, dfltKey: string, fallback: string) => {
    const all = zeon.worldObjects;
    const hits = all.filter((o) => match((o.meshType || "").toLowerCase()));
    const list = hits.length ? hits : all;
    const d = strDefault(dfltKey, fallback);
    if (d && list.some((o) => objName(o) === d)) return { list, init: d };
    if (fallback && list.some((o) => objName(o) === fallback)) return { list, init: fallback };
    return { list, init: list[0] ? objName(list[0]) : "" };
  };
  const pipetteP = useMemo(() => pick((m) => (m.includes("epipette") || m.includes("pipette")) && !m.includes("stand") && !m.includes("holder"), "pipette", "epipette_10ul"), []);
  const tipboxP = useMemo(() => pick((m) => m.includes("tipbox") && !m.includes("holder"), "tipbox", "tipbox_10ul_1"), []);
  const plateP = useMemo(() => pick((m) => m.includes("wellplate") && !m.includes("coldblock") && !m.includes("holder") && !m.includes("shaker") && !m.includes("pcr"), "reaction_plate", "wellplate_96_flatbottom"), []);
  const libraryP = useMemo(() => pick((m) => m.includes("wellplate_pcr") || m.includes("pcr"), "compound_library", "wellplate_pcr_parts_2"), []);

  const [pipette, setPipette] = useState(pipetteP.init);
  const [tipbox, setTipbox] = useState(tipboxP.init);
  const [reactionPlate, setReactionPlate] = useState(plateP.init);
  const [compoundLibrary, setCompoundLibrary] = useState(libraryP.init);
  const [compoundId, setCompoundId] = useState(strDefault("compound_id", ""));
  const [runName, setRunName] = useState(strDefault("run_name", "cfps_inhibitor_dose_run"));

  const [pipetteMax] = useMemo(() => pipetteLimits(pipetteP.init), [pipetteP.init]);

  // Ordered list of concentration groups — seeded from the planned round if one
  // has been synced, otherwise empty for a human to build by clicking the plate map.
  const [groups, setGroups] = useState<GroupPos[]>(() => groupsFrom("auto"));

  const stagedDiffers = useMemo(() => {
    const planned = groupsFrom("planned");
    const staged = groupsFrom("staged");
    if (!staged.length) return false;
    return JSON.stringify(planned) !== JSON.stringify(staged);
  }, []);
  const loadFrom = (source: Source) => {
    const { s } = pickBy(source);
    setGroups(groupsFrom(source));
    setCompoundId(s("compound_id", ""));
    setRunName(s("run_name", "cfps_inhibitor_dose_run"));
  };

  // Clicking a well already in a group removes it from that slot; otherwise it
  // fills the first open slot (wellA before wellB) of an existing group, or opens
  // a new group if under MAX_GROUPS. A group with only wellA filled is a partial
  // pair — flagged at validate time, not blocked here, so the second click of a
  // duplicate is easy.
  const toggleWell = (w: string) =>
    setGroups((gs) => {
      const hitIdx = gs.findIndex((g) => g.wellA === w || g.wellB === w);
      if (hitIdx >= 0) {
        const g = gs[hitIdx];
        const cleared = { ...g, wellA: g.wellA === w ? "" : g.wellA, wellB: g.wellB === w ? "" : g.wellB };
        if (!cleared.wellA && !cleared.wellB) return gs.filter((_, i) => i !== hitIdx);
        return gs.map((x, i) => (i === hitIdx ? cleared : x));
      }
      const openIdx = gs.findIndex((g) => !g.wellA || !g.wellB);
      if (openIdx >= 0) {
        return gs.map((g, i) => (i === openIdx ? { ...g, ...(!g.wellA ? { wellA: w } : { wellB: w }) } : g));
      }
      if (gs.length >= MAX_GROUPS) return gs; // capped by the workflow's fixed 4-group graph
      return [...gs, { wellA: w, wellB: "", srcWell: "", volUl: 0 }];
    });
  const updateGroup = (i: number, patch: Partial<GroupPos>) =>
    setGroups((gs) => gs.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  const removeGroup = (i: number) => setGroups((gs) => gs.filter((_, j) => j !== i));

  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => {
    zeon.onValidationErrors((errs) => setErrors(errs.map((e) => e.message)));
  }, []);

  function validate(): string[] {
    const e: string[] = [];
    if (!pipette || !tipbox || !reactionPlate || !compoundLibrary) {
      e.push("Select the pipette, tip box, reaction plate, and compound library.");
    }
    if (groups.length === 0) e.push("Click both duplicate wells for at least one concentration group — they must already hold expressed TEM1 reaction mix from Part 1.");
    groups.forEach((g, i) => {
      const n = i + 1;
      if (!g.wellA || !g.wellB) e.push(`Group ${n}: pick both duplicate wells (currently ${[g.wellA, g.wellB].filter(Boolean).length}/2).`);
      if (!g.srcWell.trim()) e.push(`Group ${n} (${g.wellA || "?"}/${g.wellB || "?"}): set a compound source well.`);
      if (!(g.volUl > 0)) e.push(`Group ${n} (${g.wellA || "?"}/${g.wellB || "?"}): per-well compound volume must be positive.`);
      const total = g.volUl * 2;
      if (total > pipetteMax) {
        e.push(`Group ${n}: combined draw ${total.toFixed(2)} uL (2 x ${g.volUl} uL) exceeds ${pipette}'s ${pipetteMax} uL capacity — lower the volume or split the duplicates onto separate tips.`);
      }
    });
    return e;
  }

  function run() {
    const e = validate();
    setErrors(e);
    if (e.length) return;

    const values: Record<string, unknown> = {
      pipette, tipbox, reaction_plate: reactionPlate, compound_library: compoundLibrary,
      compound_id: compoundId.trim(),
      dose_n: groups.length,
      run_name: (runName || "").trim() || "cfps_inhibitor_dose_run",
    };
    groups.forEach((g, i) => {
      const n = i + 1;
      values[`dose${n}_well_a`] = g.wellA;
      values[`dose${n}_well_b`] = g.wellB;
      values[`dose${n}_src_well`] = g.srcWell.trim();
      values[`dose${n}_vol_ul`] = g.volUl;
      values[`dose${n}_total_vol_ul`] = g.volUl * 2;
      values[`dose${n}_tip_index`] = n;
    });
    // Unused group slots (up to MAX_GROUPS) stay at the workflow's zero-volume
    // defaults — the graph has all 4 positions but dose_n tells later analysis
    // how many are real.
    zeon.submit(values);
  }

  const objSelect = (val: string, set: (v: string) => void, list: typeof zeon.worldObjects) => (
    <select style={S.field} value={val} onChange={(ev) => set(ev.target.value)}>
      {list.length === 0 && <option value="">(none in world)</option>}
      {list.map((o) => { const n = objName(o); return <option key={o.uuid} value={n}>{n}</option>; })}
    </select>
  );

  return (
    <div style={S.page}>
      <div style={S.eyebrow}>
        <span style={{ width: 7, height: 7, borderRadius: 7, background: ACCENT, display: "inline-block" }} />
        TEM-1 inhibitor screen — Part 3a of 3
      </div>
      <h1 style={S.h1}>CFPS Inhibitor Dose</h1>
      <p style={S.sub}>
        Doses each concentration group you pick below into its duplicate pair of wells, drawing once from a
        shared compound library source well and splitting into two equal dispenses on the same tip. Pick wells
        that already hold expressed TEM1 reaction mix from Part 1 (<code>cfps_mastermix</code>), confirmed by
        Part 2 (<code>cfps_sfgfp_confirmation</code>). No nitrocefin and no reader in this run — after this
        completes, let the compound incubate with the enzyme off-robot, add nitrocefin to every well by hand,
        then run <code>cfps_inhibitor_kinetic_read</code> (Part 3b) to load the plate into the reader.
      </p>
      <hr style={S.rule} />

      <h2 style={S.h2}><span>Deck</span></h2>
      <div style={S.grid2}>
        <div><label style={S.label}>Reaction plate (Part-1 plate)</label>{objSelect(reactionPlate, setReactionPlate, plateP.list)}</div>
        <div><label style={S.label}>Compound library plate</label>{objSelect(compoundLibrary, setCompoundLibrary, libraryP.list)}</div>
        <div><label style={S.label}>Pipette</label>{objSelect(pipette, setPipette, pipetteP.list)}</div>
        <div><label style={S.label}>Tip box</label>{objSelect(tipbox, setTipbox, tipboxP.list)}</div>
      </div>

      <h2 style={S.h2}><span>Compound & run</span></h2>
      <div style={S.grid2}>
        <div>
          <label style={S.label}>Compound ID (logged only)</label>
          <input style={S.field} value={compoundId} onChange={(e) => setCompoundId(e.target.value)} placeholder="e.g. cmpd_017" />
        </div>
        <div>
          <label style={S.label}>Run name (output folder)</label>
          <input style={S.field} value={runName} onChange={(e) => setRunName(e.target.value)} placeholder="cfps_inhibitor_dose_run" />
        </div>
      </div>

      <h2 style={S.h2}>
        <span>Duplicate pairs — click 2 wells per group, up to {MAX_GROUPS} groups</span>
        <button type="button" style={S.smallBtn} onClick={() => loadFrom("planned")}>Load planned values</button>
      </h2>
      <p style={S.sub}>
        Only click wells that already hold expressed TEM1 reaction mix from Part 1. Each pair shares one source
        well, one tip, and one aspirate — click the first well of a group, then its duplicate.
      </p>
      {stagedDiffers && (
        <div style={S.staleBox}>
          <strong>Showing the planned round, not your staged draft.</strong> Staged values come from an
          autosaved draft or a still-live run and are replayed on every open, so the synced round takes
          precedence here.{" "}
          <button type="button" style={{ ...S.smallBtn, marginLeft: 4 }} onClick={() => loadFrom("staged")}>
            Restore staged values
          </button>
        </div>
      )}
      <div style={S.plate}>
        <div />
        {COLS.map((c) => <div key={c} style={S.hdr}>{c}</div>)}
        {ROWS.map((r) => (
          <React.Fragment key={r}>
            <div style={S.hdr}>{r}</div>
            {COLS.map((c) => {
              const w = `${r}${c}`;
              const idx = groups.findIndex((g) => g.wellA === w || g.wellB === w);
              const active = idx >= 0;
              const slot = active ? (groups[idx].wellA === w ? "A" : "B") : "";
              const color = active ? GROUP_COLORS[idx % GROUP_COLORS.length] : "#fff";
              return (
                <button key={w} type="button" title={w} onClick={() => toggleWell(w)}
                        style={{ ...S.cell, background: color, color: active ? "#fff" : FAINT }}>
                  {active ? `${idx + 1}${slot}` : ""}
                </button>
              );
            })}
          </React.Fragment>
        ))}
      </div>

      {groups.length === 0 ? (
        <p style={{ ...S.sub, marginTop: 12 }}>No groups picked yet.</p>
      ) : (
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>#</th><th style={S.th}>Well A</th><th style={S.th}>Well B (dup)</th>
              <th style={S.th}>Compound src well</th><th style={S.th}>µL / well</th>
              <th style={S.th}>Aspirate (2x)</th><th style={S.th}></th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g, i) => {
              const total = g.volUl * 2;
              const overCapacity = total > pipetteMax;
              return (
                <tr key={i}>
                  <td style={{ ...S.td, color: GROUP_COLORS[i % GROUP_COLORS.length], fontWeight: 700 }}>{i + 1}</td>
                  <td style={{ ...S.td, fontFamily: MONO, fontWeight: 700 }}>{g.wellA || "—"}</td>
                  <td style={{ ...S.td, fontFamily: MONO, fontWeight: 700 }}>{g.wellB || "—"}</td>
                  <td style={S.td}>
                    <input style={S.textInput} value={g.srcWell} placeholder="A1"
                           onChange={(e) => updateGroup(i, { srcWell: e.target.value.toUpperCase() })} />
                  </td>
                  <td style={S.td}>
                    <input type="number" min={0} step={0.1} style={S.numInput} value={g.volUl}
                           onChange={(e) => updateGroup(i, { volUl: parseFloat(e.target.value || "0") })} />
                  </td>
                  <td style={{ ...S.td, fontFamily: MONO, color: overCapacity ? "#8E2C1E" : MUTE, fontWeight: overCapacity ? 700 : 400 }}>
                    {total.toFixed(1)} uL{overCapacity ? " ⚠" : ""}
                  </td>
                  <td style={S.td}>
                    <button type="button" style={S.removeBtn} onClick={() => removeGroup(i)}>remove</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div style={{ ...S.card, background: ACCENT_SOFT, borderColor: "#F0C7D8" }}>
        <strong style={{ color: ACCENT }}>One tip per group, not per well</strong> — each duplicate pair shares a
        single tip index (1..{MAX_GROUPS}, in group order): attach once, aspirate the combined 2x volume once
        from the shared source well, then dispense the per-well volume into wells A and B before ejecting. Make
        sure the tip box has at least {MAX_GROUPS} fresh tips before running, and keep each group's combined
        draw within the selected pipette's capacity ({pipetteMax} uL for {pipette || "the selected pipette"}).
      </div>

      {errors.length > 0 && (
        <div style={S.errorBox}>{errors.map((m, i) => <div key={i}>• {m}</div>)}</div>
      )}

      <button type="button" style={S.button} onClick={run}>
        Confirm setup — {groups.length} group{groups.length !== 1 ? "s" : ""} ({groups.length * 2} wells)
      </button>
    </div>
  );
}
