"""Generate the learning-event parser's library config from the workbook.

Reads docs/process-mining/Process_Mining_Library_v2.xlsx (sheets: Action
Events, Mapping, Parameters) and writes
apps/api/src/learning-events/config/library.v2.json. The workbook is the
source of truth for names, rule wording and parameter defaults
(docs/process-mining/GALS_PromptingCourse_Integration_Plan_for_Claude_Code.md,
Phase 4 #1); the JSON is committed so the API never parses .xlsx at runtime.

Machine-readable parameter values are parsed from the Parameters sheet's
"Starting value" column. Two values are not plain numbers and are encoded
explicitly (and checked here so a workbook edit cannot drift silently):
  T_out  "max(5, words ÷ 4)" -> {"min": 5, "wordsPerSecond": 4}
  W_seq  "Same activity, ≤ 10 min" -> 10 (minutes, same activity)

    pip install openpyxl
    python analysis/process_mining/export_library.py
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[2]
WORKBOOK = ROOT / "docs/process-mining/Process_Mining_Library_v2.xlsx"
OUT = ROOT / "apps/api/src/learning-events/config/library.v2.json"

UNIT_MS = {"seconds": 1000, "seconds on slide": 1000, "minutes": 60_000}


def rows(ws):
    it = ws.iter_rows(values_only=True)
    header = [str(h).strip() if h is not None else "" for h in next(it)]
    for r in it:
        if any(c is not None for c in r):
            yield dict(zip(header, r))


def clean(v):
    return re.sub(r"\s+", " ", str(v)).strip() if v is not None else None


def parse_parameter(name: str, raw, unit: str):
    text = clean(raw) or ""
    if name == "T_out":
        m = re.match(r"max\((\d+),\s*words\s*÷\s*(\d+)\)", text)
        if not m:
            sys.exit(f"T_out starting value changed in the workbook: {text!r}")
        return {"kind": "t_out", "minSeconds": int(m.group(1)), "wordsPerSecond": int(m.group(2))}
    if name == "W_seq":
        m = re.search(r"(\d+)\s*min", text)
        if not m:
            sys.exit(f"W_seq starting value changed in the workbook: {text!r}")
        return {"kind": "ms", "value": int(m.group(1)) * 60_000, "scope": "same activity"}
    try:
        num = float(text)
    except ValueError:
        sys.exit(f"Parameter {name} has a non-numeric starting value: {text!r}")
    mult = UNIT_MS.get(unit.strip().lower()) if unit else None
    if mult:
        return {"kind": "ms", "value": int(num * mult)}
    return {"kind": "number", "value": int(num) if num.is_integer() else num}


def main():
    wb = load_workbook(WORKBOOK, data_only=True)

    actions = [
        {
            "no": r["No."],
            "action": clean(r["Action Event"]),
            "observable": clean(r["Directly observable event"]),
            "layer": clean(r["Layer"]),
            "group": clean(r["Group"]),
            "payload": clean(r["Required payload fields"]),
            "status": clean(r["Status"]),
        }
        for r in rows(wb["Action Events"])
        if r.get("Action Event")
    ]

    rules = [
        {
            "id": clean(r["ID"]),
            "inputs": clean(r["Action events / sequence"]),
            "family": clean(r["Event family or learning process"]),
            "rule": clean(r["Mapping rule"]),
            "parameters": [p.strip() for p in (clean(r["Parameters (see Parameters sheet)"]) or "").split(",") if p.strip() and p.strip() != "—"],
            "evidenceClass": clean(r["Evidence class"]),
        }
        for r in rows(wb["Mapping"])
        if r.get("ID")
    ]

    params = {}
    for r in rows(wb["Parameters"]):
        name = clean(r["Parameter"])
        if not name:
            continue
        params[name] = {
            **parse_parameter(name, r["Starting value"], clean(r["Unit"]) or ""),
            "unit": clean(r["Unit"]),
            "usedIn": clean(r["Used in"]),
            "rationale": clean(r["Rationale"]),
        }

    out = {
        "libraryVersion": "v2",
        "source": WORKBOOK.name,
        "actionCount": len(actions),
        "ruleCount": len(rules),
        "actions": actions,
        "rules": rules,
        "parameters": params,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(actions)} actions, {len(rules)} rules, {len(params)} parameters")


if __name__ == "__main__":
    main()
