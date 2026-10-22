#!/usr/bin/env python3
"""Build battery-extras.json: the EF battery v2.0 constants that are NOT in stimuli.json.

Everything is read from ../source/ef.py (imported, never retyped), except the Part A
background items, which ef.py only holds inside a LaTeX string. Those are structured
here, and every text/option is asserted to occur verbatim in ef.py's own
questionnaires() output, so a typo fails the build instead of reaching participants.

    python docs/EF_battery_v2/derived/build_extras.py   # writes battery-extras.json

The API seed (apps/api/prisma/scripts/seed-ef-battery.ts) loads the JSON and refuses a
file whose ef_sha256 differs from stimuli.json meta.code_sha256.
"""
import hashlib, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(HERE, "..", "source"))
sys.path.insert(0, SRC)
import ef  # noqa: E402

def sha256(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()

def tex_plain(s):
    """LaTeX source as displayed text: -- -> en dash, drop simple markup."""
    s = s.replace("---", "\u2014").replace("--", "\u2013")
    s = re.sub(r"\\(bx|quad|par)\b\\?\s*", " ", s)
    s = re.sub(r"\\blank\[[^\]]*\]", " ", s)
    s = re.sub(r"\\emph\{([^}]*)\}", r"\1", s)
    s = s.replace("\\&", "&")
    return re.sub(r"\s+", " ", s)

QTEX = tex_plain(ef.questionnaires())

def must(text):
    t = tex_plain(text)
    if t not in QTEX:
        raise SystemExit(f"not verbatim in ef.questionnaires(): {text!r}")
    return t

ENGLISH = ["Not well", "Fairly well", "Well", "Very well", "Native / as well as my first language"]

def choice(code, text, options, other=None, followup=None, flag=None):
    item = dict(code=code, text=must(text), type="choice", options=[must(o) for o in options])
    if other: item["otherOption"] = must(other)
    if followup: item["followup"] = dict(text=must(followup), when=[must(w) for w in options[1:]])
    if flag: item["flag"] = flag
    return item

BACKGROUND = [
    dict(code="A1", text=must("Age:"), type="number", unit="years", min=16, max=99),
    choice("A2", "Highest completed education:",
           ["Secondary", "Diploma / associate", "Bachelor's", "Master's", "Doctorate", "Other:"], other="Other:"),
    dict(code="A3", text=must("First language(s) you learned as a child:"), type="text"),
    dict(code="A4", text=must("Language you use most at home now:"), type="text"),
    dict(code="A5", text=must("Main language of teaching at your secondary school:"), type="text2",
         secondText=must("and at university/college:")),
    choice("A6", "How well do you understand spoken English?", ENGLISH),
    choice("A7", "How well do you speak English?", ENGLISH),
    choice("A8", "Have you done puzzles like these before (for example repeating numbers backwards, naming ink colours, joining numbered circles, saying words that start with a letter)?",
           ["No", "Yes, in a research study", "Yes, in a clinical or educational assessment", "Yes, elsewhere"],
           followup="If yes, roughly when?"),
    choice("A9", "Do you have any difficulty telling colours apart (for example red--green colour blindness)?",
           ["No", "Yes", "Not sure"]),
    choice("A10", "Do you need glasses or contact lenses for reading?",
           ["No", "Yes, and I am wearing them now", "Yes, but I am not wearing them now"]),
    choice("A11", "Do you have any difficulty hearing speech in a quiet room?", ["No", "Yes"]),
    choice("A12", "Which hand do you write with?", ["Right", "Left", "Either"]),
    choice("A13", "Have you ever been told by a professional that you have a condition that affects reading, attention or memory (for example dyslexia or ADHD)?",
           ["No", "Yes", "Prefer not to say"], flag="efShowDiagnosisItem"),
]

def state_item(code, q, spec):
    item = dict(code=code, text=q)
    if spec == "hours":
        item.update(type="number", unit="hours", min=0, max=24, step=0.5)
    elif isinstance(spec, str) and spec.startswith("0-10:"):
        lo, hi = spec[5:].split("|")
        item.update(type="scale", min=0, max=10, lowLabel=lo, highLabel=hi)
    else:
        item.update(type="choice", options=list(spec))
        if any("please describe" in o for o in spec):
            item["describeOption"] = next(o for o in spec if "please describe" in o)
    return item

n_before = len(ef.STATE_ITEMS_BEFORE)
extras = dict(
    batteryVersion=ef.VERSION,
    ef_sha256=sha256(os.path.join(SRC, "ef.py")),
    stimuli_sha256=sha256(os.path.join(SRC, "stimuli.json")),
    questionnaire=dict(
        title="About you and how you feel today",
        footer=must("These questions describe how you are today. They help us interpret the puzzles and are not a measure of ability."),
        partA=dict(heading="About you", items=BACKGROUND),
        partB=dict(heading="How you usually are",
                   instructions=tex_plain(ef.ADEXI_INSTRUCTIONS),
                   scale=[dict(value=i + 1, label=l) for i, l in enumerate(ef.ADEXI_SCALE)],
                   items=[dict(code=f"B{i + 1}", text=t) for i, t in enumerate(ef.ADEXI_ITEMS)],
                   key=dict(WM=ef.ADEXI_KEY["WM"], INH=ef.ADEXI_KEY["INH"]),
                   attribution="Items: Holst & Thorell (2018), reproduced unchanged."),
        partCBefore=[state_item(f"C{i + 1}", q, s) for i, (q, s) in enumerate(ef.STATE_ITEMS_BEFORE)],
        partCAfter=[state_item(f"C{n_before + i + 1}", q, s) for i, (q, s) in enumerate(ef.STATE_ITEMS_AFTER)],
    ),
    hayling=dict(
        practice={p: [dict(sentence=s, expected=e) for s, e in ef.HAYLING_PRACTICE[p]] for p in ("A", "B")},
        codingExamples={k: dict(a=v[0], b=v[1]) for k, v in ef.HAYLING_CODING_EXAMPLES.items()},
        promptAfterMs=15000,
    ),
    fluency=dict(exampleLetter=ef.FLUENCY_EXAMPLE_LETTER, exampleLetterWords=["nail", "night", "near"],
                 exampleNames=["Nancy", "Nepal"], exampleRoot=["eat", "eating"],
                 exampleSwitchPair=["colours", "body parts"], exampleSwitchWords=["red", "arm", "blue", "leg"],
                 secondsPerPrompt=60),
    stroop=dict(colours=list(ef.COLOURS), rows=ef.STROOP_ROWS, cols=ef.STROOP_COLS, secondsPerPage=45,
                rgb=dict(red=[200, 30, 30], green=[20, 140, 60], blue=[30, 70, 200])),
    tmt=dict(fieldMm=[ef.TMT_W, ef.TMT_H], sampleFieldMm=[120.0, 70.0], circleDiameterMm=8.5,
             beginEndOffsetMm=6.8, labelsA=ef.TMT_A_LABELS, labelsB=ef.TMT_B_LABELS,
             yAxisUp=True, discontinueSeconds=300),
    digitSpan=dict(onMs=800, offMs=200),
    plusMinus=dict(operand=3),
)

# ef.py defines the RGB inks in LaTeX; make sure the copy above still matches.
for name, rgb in extras["stroop"]["rgb"].items():
    tag = r"\definecolor{ink%s}{RGB}{%s}" % (name, ",".join(map(str, rgb)))
    if tag not in open(os.path.join(SRC, "ef.py"), encoding="utf-8").read():
        raise SystemExit(f"ink RGB drifted for {name}")

with open(os.path.join(SRC, "stimuli.json"), encoding="utf-8") as f:
    if json.load(f)["meta"]["code_sha256"] != extras["ef_sha256"]:
        raise SystemExit("ef.py does not match stimuli.json meta.code_sha256")

out = os.path.join(HERE, "battery-extras.json")
with open(out, "w", encoding="utf-8", newline="\n") as f:
    json.dump(extras, f, indent=1, ensure_ascii=False)
    f.write("\n")
print(f"wrote {out} ({sha256(out)})")
