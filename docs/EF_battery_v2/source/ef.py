#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
EF battery v2.0 -- "Attention and memory puzzles" (formerly "Cognitive warm-up"), Forms A-C.

Revised against:
  * Independent audit: Executive Function Battery (protocol audit), 20 Oct 2026
  * Independent Audit of Actual Executive-Function Forms A, B and C, 20 Oct 2026

What this script does
  1. Generates every stimulus under explicit parallel-form constraints (CONSTRAINTS below).
  2. Runs automated checks (run_checks) and refuses to build if any check fails.
  3. Writes SEPARATE artefacts so oral stimuli never reach participants:
       participant_booklet_<F>.tex   - only what the participant must see (W3, W6, W7)
       facilitator_record_<F>.tex    - oral stimuli, scripts, response capture (W1, W2, W4, W5) + timings
       scoring_key.tex               - answer keys for all forms + scoring rules / codebook
       questionnaires.tex            - background (T0), ADEXI (T0), state check (every occasion), admin log
       cloze_norming_form.tex        - independent norming of W5 sentences (separate sample)
       allocation.csv                - six-order counterbalancing, permuted blocks of 6
       stimuli.json                  - frozen stimuli + seeds + code hash (source of truth)
       form_diagnostics.md           - parallel-form statistics and check results
  4. Optionally compiles the PDFs (--pdf, needs pdflatex).

Usage
    python3 ef.py --out build --pdf
    python3 ef.py --reassign-hayling      # re-run sentence-to-form optimisation (needs `wordfreq`)

All randomness is seeded (SEEDS, POOL_SEED). stimuli.json is the frozen record actually printed.
"""
import argparse, csv, hashlib, json, math, os, random, re, statistics, subprocess, sys

VERSION = "2.0"
DATE = "20 October 2026"
FORMS = ("A", "B", "C")
SEEDS = {"A": 4101, "B": 4102, "C": 4103}   # per-form stimulus seeds
POOL_SEED = 4100                            # shared seed: TMT pools, LNS patterns, allocation

# ----------------------------------------------------------------------------------------
# W1  Digit span (forward / backward)       -- original sequences, NOT WAIS items
# ----------------------------------------------------------------------------------------
DS_FWD_LENGTHS = list(range(2, 10))   # 2-9, two trials each = 16 scored trials
DS_BWD_LENGTHS = list(range(2, 9))    # 2-8, two trials each = 14 scored trials


def digits_ok(s):
    """One rule for every length (audit 4.3): digits 1-9, no repeats within a trial,
    no adjacent pair differing by 1 (blocks runs such as 4-5 or 8-7)."""
    return len(set(s)) == len(s) and all(abs(a - b) != 1 for a, b in zip(s, s[1:]))


def _draw_digits(rng, L, used, extra=lambda s: True):
    for _ in range(200000):
        s = tuple(rng.sample(range(1, 10), L))
        if digits_ok(s) and s not in used and extra(s):
            used.add(s)
            return list(s)
    raise RuntimeError("digit span: no sequence found")


def digit_span(rng, forward, used):
    lengths = DS_FWD_LENGTHS if forward else DS_BWD_LENGTHS
    practice = [_draw_digits(rng, 2, used)]
    trials = []
    for L in lengths:
        t1 = _draw_digits(rng, L, used)
        t2 = _draw_digits(rng, L, used, lambda s, t1=t1: s[0] != t1[0] and s[-1] != t1[-1])
        trials += [t1, t2]
    return dict(practice=practice, trials=trials)


# ----------------------------------------------------------------------------------------
# W2  Letter-number sequencing
# ----------------------------------------------------------------------------------------
# Letters exclude vowels, the rhyming "-ee" set (B C D E G P T V Z), W (three syllables),
# N (confusable with M) and Q.
LNS_LETTERS = "FHJKLMRSXY"
# Scored slots: (length, (n_digits, n_letters), first item category). Identical in every form.
LNS_SLOTS = [(3, (2, 1), "d"), (3, (1, 2), "l"), (4, (2, 2), "d"), (4, (2, 2), "l"),
             (5, (3, 2), "d"), (5, (2, 3), "l"), (6, (3, 3), "d"), (6, (3, 3), "l"),
             (7, (4, 3), "d"), (7, (3, 4), "l"), (8, (4, 4), "d"), (8, (4, 4), "l")]
LNS_TRANSITIONS = {3: 2, 4: 2, 5: 3, 6: 3, 7: 4, 8: 4}   # digit<->letter changes per trial


def inversions(seq):
    return sum(1 for i in range(len(seq)) for j in range(i + 1, len(seq)) if seq[i] > seq[j])


def inv_target(n):
    return math.ceil(n * (n - 1) / 4)   # half the maximum, rounded up


def transitions(pattern):
    return sum(1 for a, b in zip(pattern, pattern[1:]) if a != b)


def lns_patterns(pool_rng):
    """Fix the digit/letter position pattern of every slot (same for all forms)."""
    pats = []
    for L, (nd, nl), first in LNS_SLOTS:
        cands = set()
        for _ in range(20000):
            p = ["d"] * nd + ["l"] * nl
            pool_rng.shuffle(p)
            if p[0] == first and transitions(p) == LNS_TRANSITIONS[L]:
                cands.add("".join(p))
        pats.append(pool_rng.choice(sorted(cands)))
    return pats


def lns_answer(items):
    d = sorted([x for x in items if x.isdigit()], key=int)
    l = sorted([x for x in items if x.isalpha()])
    return d + l


def lns(rng, patterns, used):
    def fill(pattern):
        nd, nl = pattern.count("d"), pattern.count("l")
        for _ in range(200000):
            d = [str(x) for x in rng.sample(range(1, 10), nd)]
            l = rng.sample(LNS_LETTERS, nl)
            if nd > 1 and inversions([int(x) for x in d]) != inv_target(nd):
                continue
            if nl > 1 and inversions(l) != inv_target(nl):
                continue
            di, li = iter(d), iter(l)
            items = [next(di) if c == "d" else next(li) for c in pattern]
            if tuple(items) not in used:
                used.add(tuple(items))
                return items
        raise RuntimeError("LNS fill failed")
    practice = [fill("dl"), fill("ld")]
    trials = [fill(p) for p in patterns]
    return dict(practice=practice, trials=trials)


# ----------------------------------------------------------------------------------------
# W3  Plus-minus (Jersild 1927; Miyake et al. 2000)
# ----------------------------------------------------------------------------------------
PM_MIN, PM_MAX = 13, 96   # no single-digit answers, no answers above 99
ONES30 = list(range(10)) * 3                       # each final digit exactly 3x  -> 9/30 crossings
TENS30 = list(range(1, 10)) * 3 + [4, 5, 6]
ONES15_PLUS = list(range(10)) + [3, 4, 5, 6, 8]    # crossings on +3 (ones 7-9): 4/15
ONES15_MINUS = list(range(10)) + [1, 3, 4, 5, 6]   # crossings on -3 (ones 0-2): 4/15
TENS15 = list(range(1, 10)) + [3, 4, 5, 6, 7, 8]
PM_SPEC = dict(list1_cross=9, list2_cross=9, list3_plus_cross=4, list3_minus_cross=4)


def crosses(n, op):
    return (n % 10 >= 7) if op == "+" else (n % 10 <= 2)


def _pm_pair(rng, ones, tens):
    for _ in range(200000):
        o, t = ones[:], tens[:]
        rng.shuffle(o)
        rng.shuffle(t)
        nums = [10 * a + b for a, b in zip(t, o)]
        if all(PM_MIN <= n <= PM_MAX for n in nums) and len(set(nums)) == len(nums):
            return nums
    raise RuntimeError("plus-minus pairing failed")


def _max_run(flags):
    best = run = 0
    for f in flags:
        run = run + 1 if f else 0
        best = max(best, run)
    return best


def _pm_order_ok(nums, ops):
    if _max_run([crosses(n, o) for n, o in zip(nums, ops)]) > 2:
        return False
    if any(a == b or abs(a - b) == 1 for a, b in zip(nums, nums[1:])):
        return False
    return len(set(nums)) == len(nums)


def plus_minus(rng):
    lists = []
    for op, ones in (("+", ONES30), ("-", ONES30)):
        nums = _pm_pair(rng, ones, TENS30)
        ops = [op] * 30
        for _ in range(200000):
            rng.shuffle(nums)
            if _pm_order_ok(nums, ops):
                break
        lists.append(dict(op=op, items=nums[:], ops=ops))
    for _ in range(200000):
        p = _pm_pair(rng, ONES15_PLUS, TENS15)
        m = _pm_pair(rng, ONES15_MINUS, TENS15)
        rng.shuffle(p)
        rng.shuffle(m)
        nums = [x for pair in zip(p, m) for x in pair]
        ops = ["+", "-"] * 15
        if _pm_order_ok(nums, ops):
            break
    lists.append(dict(op="+/-", items=nums, ops=ops))
    # Practice numbers lie below the test range (13-96), so they can never coincide with test items.
    practice = dict(plus=[5, 11, 8], minus=[10, 6, 12], alt=[9, 7, 11, 4])
    return dict(lists=lists, practice=practice)


def pm_answer(n, op):
    return n + 3 if op == "+" else n - 3


# ----------------------------------------------------------------------------------------
# W4  Verbal fluency
# ----------------------------------------------------------------------------------------
# Letter sets share no letter across forms (audit 5.1). FAS and BHR are the D-KEFS standard
# and alternate letter sets; PMT is study-chosen (no overlap; lexical-availability proxy
# between FAS and BHR). Equivalence in this cohort is unverified -> pilot equating.
# Semantic fluency uses ANIMALS at every occasion (identical item, practice modelled) because
# the previous categories (animals / vegetables / things in a kitchen) were not parallel.
# Alternating categories contain only common nouns (country names removed: they conflicted
# with the proper-noun rule).
FLUENCY = {
    "A": dict(letters=["F", "A", "S"], cat="animals", alt=("fruits", "pieces of furniture")),
    "B": dict(letters=["B", "H", "R"], cat="animals", alt=("vegetables", "items of clothing")),
    "C": dict(letters=["P", "M", "T"], cat="animals", alt=("jobs (occupations)", "vehicles")),
}
FLUENCY_EXAMPLE_LETTER = "N"   # used only in the instructions; never a test letter

# ----------------------------------------------------------------------------------------
# W5  Hayling-type sentence completion -- study-written sentences, all gaps sentence-final.
# Candidates for cloze norming (target: dominant completion produced by >= 80% of an
# independent norming sample). Assigned to form x part by balancing sentence length and
# target-word frequency (Zipf, `wordfreq`) with no within-form leakage (no stem containing
# another same-form item's expected word).
# ----------------------------------------------------------------------------------------
HAYLING_POOL = [
    ("Please knock before you open the ___.", "door"),
    ("In winter the lake turned into solid ___.", "ice"),
    ("He combed his hair in front of the ___.", "mirror"),
    ("The bride wore a long white ___.", "dress"),
    ("A spider caught the fly in its ___.", "web"),
    ("He sliced the bread with a sharp ___.", "knife"),
    ("Every morning at dawn the rooster begins to ___.", "crow"),
    ("The rain stopped and the sun began to ___.", "shine"),
    ("He paid for the meal with his credit ___.", "card"),
    ("The pirates dug up the buried ___.", "treasure"),
    ("Stop the car when the traffic light turns ___.", "red"),
    ("The bees flew back to their ___.", "hive"),
    ("He was so tired that he soon fell ___.", "asleep"),
    ("In the field the cows were eating ___.", "grass"),
    ("She looked up the meaning of the word in a ___.", "dictionary"),
    ("He wore a wedding ring on his left ___.", "hand"),
    ("The Earth travels once a year around the ___.", "sun"),
    ("She wrote the address on the front of the ___.", "envelope"),
    ("The football flew into the back of the ___.", "net"),
    ("Fish breathe through their ___.", "gills"),
    ("The birthday girl blew out all the ___.", "candles"),
    ("There are seven days in a ___.", "week"),
    ("At the end of the race the winner received a gold ___.", "medal"),
    ("The soldiers marched in a long straight ___.", "line"),
    ("The cat climbed to the top of the tall ___.", "tree"),
    ("She went to the front door and rang the ___.", "bell"),
    ("The lion is known as the king of the ___.", "jungle"),
    ("The thief ran away but was caught by the ___.", "police"),
    ("After her shower she dried herself with a ___.", "towel"),
    ("Hot air balloons float high up into the ___.", "sky"),
    ("At the beach, children built castles out of ___.", "sand"),
    ("After the long race the runner stopped to catch his ___.", "breath"),
    ("She sewed on the button with a needle and ___.", "thread"),
    ("The volcano poured out rivers of red-hot ___.", "lava"),
    ("He called the wrong person because he dialled the wrong ___.", "number"),
    ("She stirred the soup with a wooden ___.", "spoon"),
    ("He hit the nail with a ___.", "hammer"),
    ("The old film was shown in black and ___.", "white"),
    ("At the library you can borrow ___.", "books"),
    ("She glanced at her watch to check the ___.", "time"),
    ("The plants died because nobody gave them any ___.", "water"),
    ("Monkeys love to peel and eat ___.", "bananas"),
    ("The speaker greeted the audience: ladies and ___.", "gentlemen"),
    ("A triangle has three ___.", "sides"),
    ("After every meal he brushed his ___.", "teeth"),
    ("The singer walked out onto the ___.", "stage"),
    ("He tied up the parcel with a piece of ___.", "string"),
    ("The jury decided that the man was not ___.", "guilty"),
    ("Owls sleep in the day and hunt at ___.", "night"),
    ("The wedding guests threw rice at the bride and ___.", "groom"),
    ("The teacher wrote the date on the ___.", "board"),
    ("Elephants are famous for their long ___.", "trunks"),
    ("The old empty house was full of dust and ___.", "cobwebs"),
    ("To unlock the door he needed the right ___.", "key"),
    ("He wrapped the present in colourful ___.", "paper"),
    ("The tired baby fell asleep in its mother's ___.", "arms"),
    ("The snake slowly shed its old ___.", "skin"),
    ("To find north, the hikers used a ___.", "compass"),
    ("The kitten drank a saucer of ___.", "milk"),
    ("Before the drawing lesson he sharpened his ___.", "pencil"),
    ("During the storm there was thunder and ___.", "lightning"),
    ("The cowboy jumped onto his ___.", "horse"),
    ("The mouse was caught in a ___.", "trap"),
    ("The doctor rolled up his sleeve and gave him an ___.", "injection"),
    ("The bread was baked in a hot ___.", "oven"),
    ("The firefighters rushed to put out the ___.", "fire"),
    ("The children built a snowman out of fresh ___.", "snow"),
    ("She cut the paper with a pair of ___.", "scissors"),
    ("He took off his shoes and ___.", "socks"),
    ("The orchestra was led by the ___.", "conductor"),
    ("The sun rises in the east and sets in the ___.", "west"),
    ("He wore a helmet to protect his ___.", "head"),
    ("For the party he blew up lots of ___.", "balloons"),
    ("The fisherman hoped to catch a big ___.", "fish"),
    ("The ice cream melted because the day was so ___.", "hot"),
    ("Bees make sweet ___.", "honey"),
    ("The baby could not walk yet, so it began to ___.", "crawl"),
    ("She put on her coat because it was very ___.", "cold"),
    ("He opened his umbrella because it started to ___.", "rain"),
    ("The prisoner was locked in a small ___.", "cell"),
    ("A rainbow has seven ___.", "colours"),
    ("To hide his face, the robber wore a ___.", "mask"),
    ("On her head the queen wore a golden ___.", "crown"),
    ("Babies often drink milk from a ___.", "bottle"),
    ("The tennis player hit the ball with her ___.", "racket"),
    ("The carpenter cut the wood with a ___.", "saw"),
    ("The happy dog wagged its ___.", "tail"),
    ("At night we turn off the lights and go to ___.", "bed"),
    ("Planes take off and land at the ___.", "airport"),
    ("A comb is used to tidy your ___.", "hair"),
]
HAYLING_PRACTICE = dict(A=[("Please pass me the salt and ___.", "pepper"), ("A spider has eight ___.", "legs")],
                        B=[("Every morning the hens lay fresh ___.", "eggs"), ("The bird flapped its ___.", "wings")])
# Replacement items for any sentence that fails cloze norming (also normed).
HAYLING_RESERVE = [
    ("Before posting the letter, she stuck on a ___.", "stamp"),
    ("The dentist asked him to open his ___.", "mouth"),
    ("The detective searched the room for ___.", "clues"),
    ("Water freezes at zero ___.", "degrees"),
    ("She paid the taxi driver and waited for her ___.", "change"),
    ("He scored a goal and the crowd began to ___.", "cheer"),
    ("Rain falls from the dark grey ___.", "clouds"),
    ("In football, the players try to kick the ___.", "ball"),
]
# Coding anchors for Part B (illustrative, not exhaustive): (another sensible completion -> code A, related word -> code B).
# The expected word itself is always code A. Unconnected words (e.g. 'banana' for most items) -> 0.
HAYLING_CODING_EXAMPLES = {
    'door': ('window', 'key'), 'ice': ('stone', 'skate'), 'mirror': ('window', 'brush'), 'dress': ('gown', 'wedding'),
    'web': ('mouth', 'silk'), 'knife': ('blade', 'butter'), 'crow': ('sing', 'egg'), 'shine': ('rise', 'moon'),
    'card': ('', 'bank'), 'treasure': ('gold', 'ship'), 'red': ('green', 'stop'), 'hive': ('nest', 'honey'),
    'asleep': ('', 'pillow'), 'grass': ('hay', 'milk'), 'dictionary': ('book', 'spelling'), 'hand': ('finger', 'glove'),
    'sun': ('', 'moon'), 'envelope': ('letter', 'stamp'), 'net': ('goal', 'player'), 'gills': ('', 'water'),
    'candles': ('', 'cake'), 'week': ('', 'calendar'), 'medal': ('cup', 'podium'), 'line': ('row', 'army'),
    'tree': ('wall', 'branch'), 'bell': ('doorbell', 'knock'), 'jungle': ('', 'zoo'), 'police': ('guard', 'prison'),
    'towel': ('', 'soap'), 'sky': ('clouds', 'wind'), 'sand': ('', 'sea'), 'breath': ('', 'sweat'),
    'thread': ('cotton', 'sewing'), 'lava': ('rock', 'mountain'), 'number': ('', 'phone'), 'spoon': ('stick', 'bowl'),
    'hammer': ('rock', 'wood'), 'white': ('', 'colour'), 'books': ('films', 'librarian'), 'time': ('', 'clock'),
    'water': ('sunlight', 'garden'), 'bananas': ('fruit', 'tree'), 'gentlemen': ('', 'microphone'), 'sides': ('corners', 'square'),
    'teeth': ('', 'dentist'), 'stage': ('', 'song'), 'string': ('rope', 'post'), 'guilty': ('innocent', 'judge'),
    'night': ('', 'moon'), 'groom': ('', 'cake'), 'board': ('whiteboard', 'chalk'), 'trunks': ('tusks', 'zoo'),
    'cobwebs': ('dirt', 'spider'), 'key': ('code', 'lock'), 'paper': ('', 'ribbon'), 'arms': ('lap', 'milk'),
    'skin': ('', 'poison'), 'compass': ('map', 'mountain'), 'milk': ('water', 'cat'), 'pencil': ('', 'eraser'),
    'lightning': ('rain', 'cloud'), 'horse': ('', 'cow'), 'trap': ('cage', 'cheese'), 'injection': ('', 'nurse'),
    'oven': ('', 'flour'), 'fire': ('flames', 'smoke'), 'snow': ('', 'winter'), 'scissors': ('', 'glue'),
    'socks': ('', 'feet'), 'conductor': ('', 'violin'), 'west': ('', 'sunset'), 'head': ('', 'bicycle'),
    'balloons': ('', 'birthday'), 'fish': ('', 'boat'), 'hot': ('warm', 'summer'), 'honey': ('', 'flowers'),
    'crawl': ('', 'nappy'), 'cold': ('windy', 'winter'), 'rain': ('snow', 'cloud'), 'cell': ('room', 'police'),
    'colours': ('', 'sky'), 'mask': ('scarf', 'bank'), 'crown': ('hat', 'king'), 'bottle': ('cup', 'cow'),
    'racket': ('bat', 'net'), 'saw': ('axe', 'tree'), 'tail': ('', 'bone'), 'bed': ('sleep', 'pillow'),
    'airport': ('', 'pilot'), 'hair': ('', 'brush'), 'eggs': ('', 'chicken'), 'wings': ('', 'feather'),
    'pepper': ('', 'pasta'), 'legs': ('', 'insect'), 'stamp': ('', 'post'), 'mouth': ('', 'tooth'),
    'clues': ('evidence', 'police'), 'degrees': ('Celsius', 'cold'), 'change': ('receipt', 'money'), 'cheer': ('shout', 'football'),
    'clouds': ('sky', 'umbrella'), 'ball': ('', 'goal'),
}

# Frozen output of assign_hayling() (indices into HAYLING_POOL). Regenerate with --reassign-hayling.
HAYLING_ASSIGNMENT = {"A": {"A": [5, 16, 25, 26, 27, 29, 40, 53, 55, 56, 67, 68, 80, 83, 84],
                            "B": [1, 4, 6, 10, 14, 20, 31, 43, 45, 50, 51, 63, 64, 85, 89]},
                      "B": {"A": [7, 9, 11, 22, 35, 37, 38, 39, 44, 52, 73, 74, 79, 82, 86],
                            "B": [0, 8, 17, 34, 36, 41, 46, 48, 54, 59, 60, 62, 69, 77, 81]},
                      "C": {"A": [3, 13, 19, 21, 28, 32, 42, 49, 57, 58, 65, 70, 71, 78, 87],
                            "B": [2, 12, 15, 18, 23, 24, 30, 33, 47, 61, 66, 72, 75, 76, 88]}}


def _stem_tokens(s):
    return set(re.findall(r"[a-z]+", s.lower().replace("___", " ")))


def n_words(s):
    return len(s.replace("___", " ").split())


def hayling_leaks(items):
    """Pairs (i, j) where the stem of i contains the expected word of j (same form)."""
    out = []
    for i, (s, _) in enumerate(items):
        toks = _stem_tokens(s)
        for j, (_, t) in enumerate(items):
            if i != j and t.lower() in toks:
                out.append((i, j))
    return out


def assign_hayling(seed=POOL_SEED, iters=60000):
    from wordfreq import zipf_frequency
    rng = random.Random(seed)
    z = [zipf_frequency(t, "en") for _, t in HAYLING_POOL]
    w = [n_words(s) for s, _ in HAYLING_POOL]
    idx = list(range(len(HAYLING_POOL)))
    rng.shuffle(idx)
    cells = [idx[k * 15:(k + 1) * 15] for k in range(6)]   # A-A, A-B, B-A, B-B, C-A, C-B

    def cost(cells):
        mw = [statistics.mean(w[i] for i in c) for c in cells]
        mz = [statistics.mean(z[i] for i in c) for c in cells]
        sw = [statistics.pstdev(w[i] for i in c) for c in cells]
        leak = 0
        for f in range(3):
            items = [HAYLING_POOL[i] for i in cells[2 * f] + cells[2 * f + 1]]
            leak += len(hayling_leaks(items))
        return (max(mw) - min(mw)) * 4 + (max(mz) - min(mz)) * 4 + (max(sw) - min(sw)) + leak * 100

    best = cost(cells)
    for _ in range(iters):
        a, b = rng.sample(range(6), 2)
        i, j = rng.randrange(15), rng.randrange(15)
        cells[a][i], cells[b][j] = cells[b][j], cells[a][i]
        c = cost(cells)
        if c <= best:
            best = c
        else:
            cells[a][i], cells[b][j] = cells[b][j], cells[a][i]
    out = {}
    for f, F in enumerate(FORMS):
        out[F] = dict(A=sorted(cells[2 * f]), B=sorted(cells[2 * f + 1]))
    return out, best


# ----------------------------------------------------------------------------------------
# W6  Stroop (Golden 1978 format: W, C, CW pages; 100 items; 45 s each)
# ----------------------------------------------------------------------------------------
COLOURS = ("red", "green", "blue")
STROOP_ROWS, STROOP_COLS = 20, 5


def _constrained_sequence(rng, counts, allowed):
    total = sum(counts.values())
    for _ in range(20000):
        rem, out = dict(counts), []
        for i in range(total):
            opts = [c for c in COLOURS if rem[c] > 0 and allowed(i, c, out)]
            if not opts:
                break
            c = rng.choices(opts, weights=[rem[o] for o in opts])[0]
            out.append(c)
            rem[c] -= 1
        if len(out) == total:
            return out
    raise RuntimeError("Stroop sequence failed")


def _counts(extra):
    return {c: (34 if c == extra else 33) for c in COLOURS}


def stroop(rng, form_index):
    """Reading order is down each column (index = col*20 + row). Constraints: exact
    34/33/33 colour counts (the colour with 34 rotates over pages and forms); no immediate
    repetition of a word or ink; CW ink never matches the word; CW uses the W-page word
    sequence (Golden's construction)."""
    def page_ok(i, c, out):
        if out and out[-1] == c:                       # no repeat in reading order (down columns)
            return False
        if i >= 3 * STROOP_ROWS and out[i - STROOP_ROWS] == out[i - 2 * STROOP_ROWS] == out[i - 3 * STROOP_ROWS] == c:
            return False                               # max 3 identical in a row read across
        if i == STROOP_ROWS * STROOP_COLS - 1 and c == out[0]:
            return False                               # restart-from-top: last item != first item
        return True
    words = _constrained_sequence(rng, _counts(COLOURS[form_index % 3]), page_ok)
    colours = _constrained_sequence(rng, _counts(COLOURS[(form_index + 1) % 3]), page_ok)
    cw_ink = _constrained_sequence(rng, _counts(COLOURS[(form_index + 2) % 3]),
                                   lambda i, c, out: c != words[i] and page_ok(i, c, out))
    no_rep = lambda i, c, out: not out or out[-1] != c
    pw = _constrained_sequence(rng, {"red": 2, "green": 2, "blue": 1}, no_rep)
    pc = _constrained_sequence(rng, {"red": 1, "green": 2, "blue": 2}, no_rep)
    pcw_w = _constrained_sequence(rng, {"red": 2, "green": 1, "blue": 2}, no_rep)
    pcw_i = _constrained_sequence(rng, {"red": 1, "green": 2, "blue": 2},
                                  lambda i, c, out: c != pcw_w[i] and (not out or out[-1] != c))
    return dict(words=words, colours=colours, cw_words=words[:], cw_ink=cw_ink,
                practice=dict(words=pw, colours=pc, cw_words=pcw_w, cw_ink=pcw_i))


# ----------------------------------------------------------------------------------------
# W7  Trail making (study-generated layouts; geometry matched across forms)
# ----------------------------------------------------------------------------------------
TMT_W, TMT_H = 150.0, 185.0      # circle-centre field in mm (page text sits above it)
TMT_MIND = 20.0                  # min centre-to-centre distance (mm)
TMT_CLEAR = 8.0                  # min distance from any path segment to a non-endpoint circle centre
TMT_LEN_TOL = 0.02               # all six test layouts within +/-2% of their mean path length
TMT_A_LABELS = [str(i) for i in range(1, 26)]
TMT_B_LABELS = [x for i in range(1, 13) for x in (str(i), "ABCDEFGHIJKL"[i - 1])] + ["13"]


def _seg_cross(p1, p2, p3, p4):
    def ccw(a, b, c):
        return (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0])
    return ccw(p1, p3, p4) != ccw(p2, p3, p4) and ccw(p1, p2, p3) != ccw(p1, p2, p4)


def _pt_seg_dist(q, a, b):
    ax, ay = a
    bx, by = b
    qx, qy = q
    dx, dy = bx - ax, by - ay
    if dx == dy == 0:
        return math.hypot(qx - ax, qy - ay)
    t = max(0, min(1, ((qx - ax) * dx + (qy - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(qx - (ax + t * dx), qy - (ay + t * dy))


def tmt_layout(rng, n=25, W=TMT_W, H=TMT_H, mind=TMT_MIND, margin=8.0):
    for _ in range(5000):
        pts, ok = [], True
        for _i in range(n):
            placed = False
            for _ in range(2000):
                p = (rng.uniform(margin, W - margin), rng.uniform(margin, H - margin))
                if any(math.hypot(p[0] - q[0], p[1] - q[1]) < mind for q in pts):
                    continue
                if pts:
                    a = pts[-1]
                    if any(_seg_cross(a, p, pts[j], pts[j + 1]) for j in range(len(pts) - 2)):
                        continue
                    if any(_pt_seg_dist(q, a, p) < TMT_CLEAR for q in pts[:-1]):
                        continue
                    # earlier segments must also keep clear of the new circle
                    if any(_pt_seg_dist(p, pts[j], pts[j + 1]) < TMT_CLEAR for j in range(len(pts) - 1)):
                        continue
                pts.append((round(p[0], 1), round(p[1], 1)))
                placed = True
                break
            if not placed:
                ok = False
                break
        if ok:
            return pts
    raise RuntimeError("TMT layout failed")


def tmt_metrics(pts):
    segs = list(zip(pts, pts[1:]))
    length = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in segs)
    turn = 0.0
    for (a, b), (_, c) in zip(segs, segs[1:]):
        h1 = math.atan2(b[1] - a[1], b[0] - a[0])
        h2 = math.atan2(c[1] - b[1], c[0] - b[0])
        d = abs((h2 - h1 + math.pi) % (2 * math.pi) - math.pi)
        turn += math.degrees(d)
    prox, near = [], 0
    for i, (a, b) in enumerate(segs):
        ds = [_pt_seg_dist(q, a, b) for k, q in enumerate(pts) if k not in (i, i + 1)]
        prox.append(min(ds))
        near += sum(1 for d in ds if d < 15.0)
    crossings = sum(1 for i in range(len(segs)) for j in range(i + 2, len(segs))
                    if _seg_cross(segs[i][0], segs[i][1], segs[j][0], segs[j][1]))
    return dict(path_mm=round(length, 1), turning_deg=round(turn, 1),
                mean_nearest_distractor_mm=round(statistics.mean(prox), 2),
                near_distractors_15mm=near, crossings=crossings)


def tmt_select(pool_size=240):
    """Generate a pool of candidate layouts and pick 3 (part A) + 3 (part B) that are
    closest to the pooled median on path length (weighted x4), turning, distractor
    proximity and near-distractor count. Same target for A and B, so B-A carries no
    systematic travel-distance difference."""
    rng = random.Random(POOL_SEED + 7)
    pool = [tmt_layout(rng) for _ in range(pool_size)]
    mets = [tmt_metrics(p) for p in pool]
    keys = ["path_mm", "turning_deg", "mean_nearest_distractor_mm", "near_distractors_15mm"]
    wts = dict(path_mm=4.0, turning_deg=1.0, mean_nearest_distractor_mm=1.0, near_distractors_15mm=1.0)
    med = {k: statistics.median(m[k] for m in mets) for k in keys}
    sd = {k: statistics.pstdev(m[k] for m in mets) or 1 for k in keys}
    score = [sum(wts[k] * ((m[k] - med[k]) / sd[k]) ** 2 for k in keys) for m in mets]
    order = sorted(range(pool_size), key=lambda i: score[i])[:6]
    pick = [pool[i] for i in order]
    # alternate assignment so A and B parts get equally good candidates
    return dict(A=[pick[0], pick[3], pick[4]], B=[pick[1], pick[2], pick[5]],
                target={k: round(v, 2) for k, v in med.items()})


def tmt_samples():
    rng = random.Random(POOL_SEED + 11)
    a = tmt_layout(rng, n=8, W=120, H=70, mind=18)
    b = tmt_layout(rng, n=8, W=120, H=70, mind=18)
    return dict(A=a, B=b, A_labels=[str(i) for i in range(1, 9)],
                B_labels=["1", "A", "2", "B", "3", "C", "4", "D"])


# ----------------------------------------------------------------------------------------
# W8  ADEXI self-report (Holst & Thorell, 2018) -- official items, unchanged.
# Free for research/clinical use (chexi.se). Verify wording against the current official PDF.
# Administered at T0 (optional T2), NOT at every occasion; scored with the official key.
# ----------------------------------------------------------------------------------------
ADEXI_INSTRUCTIONS = ("Below you will find a number of statements. Please circle a number to the right of each "
                      "statement to indicate how well that statement describes how you are as a person. People that "
                      "you know might feel differently about you -- we want to know what you think about yourself. "
                      "Try to respond as honestly as possible.")
ADEXI_SCALE = ["Definitely not true", "Not true", "Partially true", "True", "Definitely true"]
ADEXI_ITEMS = [
    "I have difficulty remembering lengthy instructions.",
    "I sometimes have difficulty remembering what I am doing in the middle of an activity.",
    "I have a tendency to do things without first thinking about what could happen.",
    "I sometimes have difficulty stopping myself from doing something that I like even though someone tells me that it is not allowed.",
    "When someone asks me to do several things, I sometimes remember only the first or last.",
    "I sometimes have difficulty refraining from smiling or laughing in situations where it is inappropriate.",
    "I have difficulty coming up with a different way of solving a problem when I get stuck.",
    "When someone asks me to fetch something, I sometimes forget what I am supposed to fetch.",
    "I have difficulty planning for an activity (e.g., remembering to bring everything necessary when going on a trip/to work/to school).",
    "I sometimes have difficulty stopping an activity that I like (e.g., I watch TV or sit in front of the computer in the evening even though it is time to go to bed).",
    "I sometimes have difficulty understanding verbal instructions unless I am also shown how to do something.",
    "I have difficulties with tasks or activities that involve several steps.",
    "I have difficulty thinking ahead or learning from experience.",
    "People that I meet sometimes seem to think that I am more lively/wilder compared to other people my age.",
]
ADEXI_KEY = dict(WM=[1, 2, 5, 7, 8, 9, 11, 12, 13], INH=[3, 4, 6, 10, 14])

# ----------------------------------------------------------------------------------------
# State check (every occasion) and background (T0)  -- covariates, NOT EF measures
# ----------------------------------------------------------------------------------------
STATE_ITEMS_BEFORE = [
    ("How many hours did you sleep last night?", "hours"),
    ("Compared with a usual night, last night's sleep was ...", ["Much worse", "A bit worse", "About usual", "A bit better", "Much better"]),
    ("Right now, how tired do you feel?", "0-10:Not at all tired|Extremely tired"),
    ("Right now, how well do you feel able to concentrate?", "0-10:Not at all|Extremely well"),
    ("Right now, how stressed or anxious do you feel?", "0-10:Not at all|Extremely"),
    ("Have you had coffee, tea, an energy drink or other caffeine in the last 3 hours?", ["Yes", "No"]),
    ("Have you taken any medicine today that can make you drowsy or affect concentration?", ["Yes", "No", "Prefer not to say"]),
]
STATE_ITEMS_AFTER = [
    ("How much effort did you put into the puzzles?", "0-10:No effort|Maximum effort"),
    ("Was anything distracting or disrupting you during the puzzles?", ["No", "Yes (please describe)"]),
]

CONSTRAINTS = [
    ("W1", "Digits 1-9, no repeated digit within a trial at ANY length (length 9 = a permutation of 1-9), no adjacent pair differing by 1, two trials per length with different first and last digits, no sequence reused across forms or between forward/backward; one unscored practice trial each."),
    ("W2", "Length 2 used only for 2 practice trials; scored lengths 3-8 x 2 trials. Digit/letter composition, first-item category and position pattern are identical by slot in all forms; within-category inversions fixed at ceil(n(n-1)/4); letters from FHJKLMRSXY; no trial reused across forms."),
    ("W3", "Numbers 13-96. Lists 1 and 2: each final digit exactly 3 times (9/30 tens-crossings each); List 3: 15 '+' items with 4 crossings and 15 '-' items with 4 crossings. Identical tens/units multisets in every form, so list means are identical. No duplicates within a list, no adjacent equal or consecutive numbers, no more than 2 crossing items in a row. Each list on its own page with practice items."),
    ("W4", "No letter shared across forms (FAS / BHR / PMT); 'animals' at every occasion; alternating pairs contain common nouns only; fixed English response language."),
    ("W5", "90 study-written sentences + 4 shared practice items; all gaps sentence-final; one expected word per sentence; no expected word repeated in the battery; no stem contains another same-form item's expected word; length and target frequency balanced across the six form x part cells. Pending cloze norming."),
    ("W6", "100 items per page in 5 x 20 columns; exact 34/33/33 colour counts; no immediate word or ink repetition in reading order; CW ink never equals word (0% congruent); CW words follow the W-page word order; 5-item practice row per page; colour-naming check before the task; restart-from-top rule removes the ceiling."),
    ("W7", "Part A 1-25, Part B 1-A-...-L-13 (no 'End' target; 'Begin'/'End' printed as small labels under the first and last circles). No path crossings, circle centres >= 20 mm apart, every path segment >= 8 mm from other circle centres; six test layouts selected from a seeded pool to match path length (+/-2%), turning, distractor proximity; sample trails for A and B."),
    ("W8", "Official 14-item ADEXI, unchanged wording, official 1-5 scale and scoring (WM 9 items, Inhibition 5 items); administered at T0 (optional T2), not at every occasion."),
]


# ========================================================================================
# Build all forms
# ========================================================================================
def build_all():
    pool_rng = random.Random(POOL_SEED)
    patterns = lns_patterns(pool_rng)
    used_digits, used_lns = set(), set()
    cache = os.environ.get("EF_TMT_CACHE")   # optional: reuse trail layouts (they depend only on POOL_SEED)
    if cache and os.path.exists(cache):
        with open(cache) as fh:
            tmt, samples = json.load(fh)
    else:
        tmt, samples = tmt_select(), tmt_samples()
        if cache:
            with open(cache, "w") as fh:
                json.dump([tmt, samples], fh)
    forms = {}
    for k, F in enumerate(FORMS):
        rng = random.Random(SEEDS[F])
        f = dict(form=F, seed=SEEDS[F])
        f["dsf"] = digit_span(rng, True, used_digits)
        f["dsb"] = digit_span(rng, False, used_digits)
        f["lns"] = lns(rng, patterns, used_lns)
        f["pm"] = plus_minus(rng)
        f["flu"] = FLUENCY[F]
        f["hay"] = dict(A=[HAYLING_POOL[i] for i in HAYLING_ASSIGNMENT[F]["A"]],
                        B=[HAYLING_POOL[i] for i in HAYLING_ASSIGNMENT[F]["B"]])
        rng.shuffle(f["hay"]["A"])
        rng.shuffle(f["hay"]["B"])
        f["stroop"] = stroop(rng, k)
        f["tmtA"] = tmt["A"][k]
        f["tmtB"] = tmt["B"][k]
        forms[F] = f
    meta = dict(version=VERSION, date=DATE, seeds=SEEDS, pool_seed=POOL_SEED, lns_patterns=patterns,
                tmt_target=tmt["target"], tmt_samples=samples)
    return forms, meta


# ========================================================================================
# Checks
# ========================================================================================
def run_checks(forms, meta):
    R = []

    def chk(name, ok, detail=""):
        R.append((name, bool(ok), detail))

    # W1
    allseq = []
    for F, f in forms.items():
        for part, lens in (("dsf", DS_FWD_LENGTHS), ("dsb", DS_BWD_LENGTHS)):
            tr = f[part]["trials"]
            chk(f"{F} {part}: trial count", len(tr) == 2 * len(lens), str(len(tr)))
            chk(f"{F} {part}: lengths", [len(t) for t in tr] == [L for L in lens for _ in (0, 1)])
            chk(f"{F} {part}: digit rule (unique, no +/-1 neighbours) at every length",
                all(digits_ok(t) for t in tr + f[part]["practice"]))
            allseq += [tuple(t) for t in tr + f[part]["practice"]]
    chk("W1: no sequence reused anywhere in the battery", len(allseq) == len(set(allseq)))
    # W2
    lns_all = []
    for F, f in forms.items():
        tr = f["lns"]["trials"]
        pats = ["".join("d" if x.isdigit() else "l" for x in t) for t in tr]
        chk(f"{F} W2: slot patterns identical to master", pats == meta["lns_patterns"])
        ok = True
        for t in tr:
            d = [int(x) for x in t if x.isdigit()]
            l = [x for x in t if x.isalpha()]
            ok &= (len(d) < 2 or inversions(d) == inv_target(len(d))) and (len(l) < 2 or inversions(l) == inv_target(len(l)))
            ok &= len(set(t)) == len(t) and all(x in LNS_LETTERS for x in l)
        chk(f"{F} W2: within-category inversions fixed; letters from set; no repeats", ok)
        lns_all += [tuple(t) for t in tr + f["lns"]["practice"]]
    chk("W2: no trial reused across forms", len(lns_all) == len(set(lns_all)))
    # W3
    for F, f in forms.items():
        L1, L2, L3 = f["pm"]["lists"]
        c1 = sum(crosses(n, "+") for n in L1["items"])
        c2 = sum(crosses(n, "-") for n in L2["items"])
        c3p = sum(crosses(n, o) for n, o in zip(L3["items"], L3["ops"]) if o == "+")
        c3m = sum(crosses(n, o) for n, o in zip(L3["items"], L3["ops"]) if o == "-")
        chk(f"{F} W3: tens-crossings L1/L2/L3+/L3- = 9/9/4/4", (c1, c2, c3p, c3m) == (9, 9, 4, 4), f"{c1}/{c2}/{c3p}/{c3m}")
        chk(f"{F} W3: all items 13-96, no within-list duplicates, order rules",
            all(_pm_order_ok(L["items"], L["ops"]) and all(PM_MIN <= n <= PM_MAX for n in L["items"]) for L in (L1, L2, L3)))
        chk(f"{F} W3: List 3 strictly alternates starting with +", L3["ops"] == ["+", "-"] * 15)
        pr = {n for v in f["pm"]["practice"].values() for n in v}
        chk(f"{F} W3: practice numbers never appear as test items", not pr & {n for L in (L1, L2, L3) for n in L["items"]})
    means = {F: tuple(round(statistics.mean(L["items"]), 3) for L in f["pm"]["lists"]) for F, f in forms.items()}
    chk("W3: list means identical across forms", len(set(means.values())) == 1, str(means))
    # W4
    letters = [x for f in forms.values() for x in f["flu"]["letters"]]
    chk("W4: no letter shared across forms", len(letters) == len(set(letters)), "".join(letters))
    chk("W4: example letter not a test letter", FLUENCY_EXAMPLE_LETTER not in letters)
    chk("W4: no proper-noun category in alternating prompts",
        all(not re.search(r"countr|cit|name|brand|place", " ".join(f["flu"]["alt"])) for f in forms.values()))
    # W5
    targets = [t for f in forms.values() for p in ("A", "B") for _, t in f["hay"][p]]
    targets += [t for p in ("A", "B") for _, t in HAYLING_PRACTICE[p]]
    chk("W5: every expected word unique across battery (incl. practice)", len(targets) == len(set(targets)))
    chk("W5: every item has Part B coding anchors", all(t in HAYLING_CODING_EXAMPLES for t in targets + [t for _, t in HAYLING_RESERVE]))
    for F, f in forms.items():
        items = f["hay"]["A"] + f["hay"]["B"]
        chk(f"{F} W5: 15 + 15 items", len(f["hay"]["A"]) == 15 and len(f["hay"]["B"]) == 15)
        chk(f"{F} W5: all gaps sentence-final", all(s.rstrip().endswith("___.") and s.count("___") == 1 for s, _ in items))
        chk(f"{F} W5: no within-form leakage (stem contains another item's expected word)",
            not hayling_leaks(items + HAYLING_PRACTICE["A"] + HAYLING_PRACTICE["B"]),
            str(hayling_leaks(items + HAYLING_PRACTICE["A"] + HAYLING_PRACTICE["B"])))
    allitems = [it for f in forms.values() for p in ("A", "B") for it in f["hay"][p]]
    cross = len(hayling_leaks(allitems))
    R.append(("W5: cross-form overlaps (a stem contains another form's expected word) -- documented, not enforced", True, f"{cross} pairs"))
    # W6
    for F, f in forms.items():
        s = f["stroop"]
        for key in ("words", "colours", "cw_ink"):
            seq = s[key]
            cnt = sorted(seq.count(c) for c in COLOURS)
            chk(f"{F} W6 {key}: 100 items, counts 33/33/34, no immediate repeats",
                len(seq) == 100 and cnt == [33, 33, 34] and all(a != b for a, b in zip(seq, seq[1:])), str(cnt))
        rows_ok = all(not (s[key][i] == s[key][i - 20] == s[key][i - 40] == s[key][i - 60])
                      for key in ("words", "colours", "cw_ink") for i in range(60, 100))
        chk(f"{F} W6: no run of 4 identical across a row; last item != first item (restart rule)",
            rows_ok and all(s[key][0] != s[key][-1] for key in ("words", "colours", "cw_ink")))
        chk(f"{F} W6: CW congruent items = 0", sum(w == c for w, c in zip(s["cw_words"], s["cw_ink"])) == 0)
        chk(f"{F} W6: CW words follow W-page order", s["cw_words"] == s["words"])
    # W7
    lens = []
    for F, f in forms.items():
        for part in ("tmtA", "tmtB"):
            pts = f[part]
            m = tmt_metrics(pts)
            lens.append(m["path_mm"])
            chk(f"{F} {part}: 25 circles, no crossings, inside field", len(pts) == 25 and m["crossings"] == 0 and
                all(0 < x < TMT_W and 0 < y < TMT_H for x, y in pts))
            mind = min(math.hypot(a[0] - b[0], a[1] - b[1]) for i, a in enumerate(pts) for b in pts[i + 1:])
            chk(f"{F} {part}: min centre distance >= {TMT_MIND} mm", mind >= TMT_MIND - 0.1, f"{mind:.1f}")
    mean_len = statistics.mean(lens)
    chk(f"W7: all six path lengths within +/-{int(TMT_LEN_TOL*100)}% of mean",
        all(abs(x - mean_len) / mean_len <= TMT_LEN_TOL for x in lens), f"{min(lens):.1f}-{max(lens):.1f} mm")
    chk("W7: labels end at 25 (A) and 13 (B)", TMT_A_LABELS[-1] == "25" and TMT_B_LABELS[-1] == "13" and len(TMT_B_LABELS) == 25)
    # W8
    chk("W8: ADEXI 14 items, scoring key covers each item exactly once",
        len(ADEXI_ITEMS) == 14 and sorted(ADEXI_KEY["WM"] + ADEXI_KEY["INH"]) == list(range(1, 15)))
    return R


# ========================================================================================
# LaTeX helpers
# ========================================================================================
def tex(s):
    rep = {"\\": r"\textbackslash{}", "&": r"\&", "%": r"\%", "$": r"\$", "#": r"\#", "_": r"\_",
           "{": r"\{", "}": r"\}", "~": r"\textasciitilde{}", "^": r"\^{}"}
    s = "".join(rep.get(ch, ch) for ch in s)
    return s.replace("--", "--").replace("'", "'")


def gap(s):
    return tex(s.replace("___", "\x00")).replace("\x00", r"\rule{1.1cm}{0.4pt}")


def dash(seq):
    return "--".join(str(x) for x in seq)


PREAMBLE = r"""\documentclass[%(size)s,a4paper]{article}
\usepackage[margin=%(margin)s]{geometry}
\usepackage[T1]{fontenc}\usepackage[utf8]{inputenc}\usepackage{lmodern}
\usepackage{amsmath,amssymb,array,booktabs,longtable,enumitem,xcolor,tikz,fancyhdr,multicol,needspace}
\definecolor{inkred}{RGB}{200,30,30}\definecolor{inkgreen}{RGB}{20,140,60}\definecolor{inkblue}{RGB}{30,70,200}
\setlength{\parindent}{0pt}\setlength{\parskip}{4pt}
\renewcommand{\arraystretch}{1.15}
\newcommand{\blank}[1][1.2cm]{\rule{#1}{0.4pt}}
\newcommand{\bx}{$\square$}
\pagestyle{fancy}\fancyhf{}\renewcommand{\headrulewidth}{0.3pt}
"""


def doc(body, head_l, head_r, size="11pt", margin="2cm", sans=False):
    p = PREAMBLE % dict(size=size, margin=margin)
    if sans:
        p += r"\renewcommand{\familydefault}{\sfdefault}" + "\n"
    p += r"\lhead{\small\sffamily %s}\rhead{\small\sffamily %s}\cfoot{\small\sffamily\thepage}" % (head_l, head_r) + "\n"
    return p + "\\begin{document}\n" + body + "\n\\end{document}\n"


INK = dict(red="inkred", green="inkgreen", blue="inkblue")


def tmt_tikz(pts, labels, W=TMT_W, H=TMT_H, circle="8.5mm"):
    s = "\\begin{tikzpicture}[x=1mm,y=1mm]\n\\path (0,0) rectangle (%.0f,%.0f);\n" % (W, H)
    for (x, y), lab in zip(pts, labels):
        s += "\\node[draw,thick,circle,minimum size=%s,inner sep=0pt,font=\\sffamily\\bfseries] at (%.1f,%.1f) {%s};\n" % (circle, x, y, lab)
    (x1, y1), (xn, yn) = pts[0], pts[-1]
    s += "\\node[font=\\sffamily\\scriptsize\\bfseries] at (%.1f,%.1f) {Begin};\n" % (x1, y1 - 6.8)
    s += "\\node[font=\\sffamily\\scriptsize\\bfseries] at (%.1f,%.1f) {End};\n" % (xn, yn - 6.8)
    return s + "\\end{tikzpicture}"


def stroop_grid(seq_text, seq_ink, rows=STROOP_ROWS, cols=STROOP_COLS):
    """seq_text: list of strings (WORD or XXXX); seq_ink: list of ink keys or None (black)."""
    lines = []
    for r in range(rows):
        cells = []
        for c in range(cols):
            i = c * rows + r
            t = seq_text[i]
            cells.append(r"\textcolor{%s}{%s}" % (INK[seq_ink[i]], t) if seq_ink and seq_ink[i] else t)
        lines.append(" & ".join(cells) + r"\\[3pt]")
    return ("\\begin{center}\\sffamily\\Large\\bfseries\\begin{tabular}{@{}*{%d}{p{2.6cm}<{\\centering}}@{}}\n" % cols
            + "\n".join(lines) + "\n\\end{tabular}\\end{center}")


def stroop_row(text, ink):
    cells = [r"\textcolor{%s}{%s}" % (INK[i], t) if i else t for t, i in zip(text, ink or [None] * len(text))]
    return "\\begin{center}\\sffamily\\Large\\bfseries " + r"\qquad ".join(cells) + "\\end{center}"


# ========================================================================================
# Participant booklet  (W3, W6, W7 only -- no oral stimuli, no keys, no scoring fields)
# ========================================================================================
def participant_booklet(f, meta):
    F = f["form"]
    b = []
    b.append(r"""\thispagestyle{empty}
\begin{center}{\Huge\bfseries Attention and memory puzzles}\\[6pt]{\Large Booklet %s}\end{center}
\vspace{1cm}
Participant ID: \blank[4cm] \qquad Date: \blank[4cm]

\vspace{0.8cm}
{\large
This booklet holds the puzzles you do on paper. Other puzzles are done out loud with the facilitator.

\begin{itemize}[itemsep=6pt]
\item Please \textbf{do not turn a page until the facilitator asks you to}.
\item Each puzzle starts with a short practice. The facilitator will say when to start and stop.
\item The puzzles take about 30 minutes in total. They are \textbf{not} part of the course assessment and there is no pass mark.
\item Work as quickly and as accurately as you can. If you make a mistake, just carry on.
\end{itemize}}
\clearpage""" % F)
    # W3
    pm = f["pm"]
    b.append(r"\section*{Adding and subtracting --- practice}")
    box = lambda n, lab="": r"%d%s \framebox[1.3cm]{\strut}" % (n, lab)
    b.append(r"\begin{tabular}{@{}>{\raggedright\arraybackslash}p{4.3cm}llll@{}}")
    b.append(r"\textbf{Add 3 to each number} & " + " & ".join(box(n) for n in pm["practice"]["plus"]) + r" & \\[10pt]")
    b.append(r"\textbf{Subtract 3 from each number} & " + " & ".join(box(n) for n in pm["practice"]["minus"]) + r" & \\[10pt]")
    b.append(r"\textbf{Add 3, then subtract 3, in turn} & " + " & ".join(
        box(n, r"\,{\scriptsize(%s)}" % ("+3" if k % 2 == 0 else r"$-$3")) for k, n in enumerate(pm["practice"]["alt"])) + r"\\")
    b.append(r"\end{tabular}")
    b.append(r"\vspace{1cm}\begin{center}\itshape Wait for the facilitator before turning the page.\end{center}\clearpage")
    heads = [("List 1", "Add 3 to each number."), ("List 2", "Subtract 3 from each number."),
             ("List 3", "Add 3 to the first number, subtract 3 from the second, add 3 to the third, and so on.")]
    for (h, instr), L in zip(heads, pm["lists"]):
        b.append(r"\section*{Adding and subtracting --- %s}" % h)
        b.append(r"{\large %s Work down each column, starting with the column on the left. Write each answer in the box.}" % instr)
        b.append(r"\vspace{8pt}\begin{center}\Large\begin{tabular}{@{}lp{1cm}lp{1cm}l@{}}")
        rows = []
        for r in range(10):
            cells = []
            for c in range(3):
                n = L["items"][c * 10 + r]
                cells.append(r"%d \framebox[1.6cm]{\strut}" % n)
            rows.append(" && ".join(cells) + r"\\[7pt]")
        b.append("\n".join(rows) + r"\end{tabular}\end{center}\clearpage")
    # W6
    s = f["stroop"]
    b.append(r"""\section*{Colours --- colour check}
{\large Please say the colour of each patch.}
\begin{center}\begin{tikzpicture}
\fill[inkred] (0,0) rectangle (2.2,1.4); \fill[inkgreen] (3.2,0) rectangle (5.4,1.4); \fill[inkblue] (6.4,0) rectangle (8.6,1.4);
\end{tikzpicture}\end{center}
\vspace{1cm}\begin{center}\itshape Wait for the facilitator before turning the page.\end{center}\clearpage""")
    up = lambda seq: [x.upper() for x in seq]
    pages = [("Colours --- words", "Read the words aloud, going down each column.", up(s["practice"]["words"]), None, up(s["words"]), None),
             ("Colours --- ink", "Say the colour of the ink of each item, going down each column.", ["XXXX"] * 5, s["practice"]["colours"], ["XXXX"] * 100, s["colours"]),
             ("Colours --- ink, not the word", "Say the colour of the INK, not the word, going down each column.", up(s["practice"]["cw_words"]), s["practice"]["cw_ink"], up(s["cw_words"]), s["cw_ink"])]
    for title, instr, pt, pi, tt, ti in pages:
        b.append(r"\section*{%s}{\large %s}" % (title, instr))
        b.append(r"\par\medskip\textbf{Practice} (read across)" + stroop_row(pt, pi) + r"\vspace{-4pt}\hrule\vspace{4pt}")
        b.append(stroop_grid(tt, ti) + r"\clearpage")
    # W7
    sm = meta["tmt_samples"]
    b.append(r"\section*{Joining circles --- practice 1}{\large Draw a line from 1 to 2, 2 to 3, and so on, in order, without lifting your pen.}\begin{center}"
             + tmt_tikz(sm["A"], sm["A_labels"], 120, 70) + r"\end{center}\vspace{1cm}\begin{center}\itshape Wait for the facilitator before turning the page.\end{center}\clearpage")
    b.append(r"\section*{Joining circles --- 1}{\large Join the numbers in order: 1, 2, 3, \dots\ up to 25. Do not lift your pen.}\par\vspace{-6pt}\begin{center}"
             + tmt_tikz(f["tmtA"], TMT_A_LABELS) + r"\end{center}\clearpage")
    b.append(r"\section*{Joining circles --- practice 2}{\large Join the circles in order, switching between numbers and letters: 1, A, 2, B, 3, C, \dots\ without lifting your pen.}\begin{center}"
             + tmt_tikz(sm["B"], sm["B_labels"], 120, 70) + r"\end{center}\vspace{1cm}\begin{center}\itshape Wait for the facilitator before turning the page.\end{center}\clearpage")
    b.append(r"\section*{Joining circles --- 2}{\large Switch between numbers and letters in order: 1, A, 2, B, 3, C, \dots\ up to 13. Do not lift your pen.}\par\vspace{-6pt}\begin{center}"
             + tmt_tikz(f["tmtB"], TMT_B_LABELS) + r"\end{center}")
    b.append(r"\clearpage\thispagestyle{empty}\vspace*{6cm}\begin{center}{\Large Thank you. Please give this booklet to the facilitator.}\end{center}")
    return doc("\n".join(b), "Attention and memory puzzles", "Booklet %s \\quad ID \\blank[2.2cm]" % F, size="12pt", margin="1.6cm", sans=True)


# ========================================================================================
# Facilitator record sheet
# ========================================================================================
def facilitator_record(f, meta):
    F = f["form"]
    b = []
    b.append(r"""\begin{center}{\LARGE\bfseries Facilitator record sheet --- Form %s}\\[3pt]
{\small EF battery v%s (%s). \textbf{Never show this sheet to the participant}; it contains the spoken stimuli and expected answers.}\end{center}
\begin{tabular}{@{}p{8cm}p{8cm}@{}}
Participant ID: \blank[4cm] & Occasion: \bx\ T0 \quad \bx\ T1 \quad \bx\ T2\\
Date: \blank[4cm] \quad Start time: \blank[2cm] & Order code: \blank[2cm] (e.g.\ BCA)\\
Facilitator: \blank[4cm] & Audio recording: \bx\ yes \quad \bx\ no \quad Timing: \bx\ audio \bx\ stopwatch\\
\end{tabular}

\textbf{Before starting:} the participant completes the \emph{before the puzzles} questions (C1--C7) of the participant questionnaire; you start the administration log. At T0 Background (Part A) and the habits questionnaire (Part B, ADEXI) are given \emph{after} the puzzles.
\textbf{Fixed task order:} W1 $\rightarrow$ W2 $\rightarrow$ W3 $\rightarrow$ W4 $\rightarrow$ W5 $\rightarrow$ W6 $\rightarrow$ W7. Read scripts (in \textit{italics}) word for word. Give practice items with feedback; never give feedback on scored items.
""" % (F, VERSION, DATE))

    # W1
    def ds_table(part, title, backward):
        d = f[part]
        rows = []
        p = d["practice"][0]
        rows.append(r"Practice & -- & %s & %s & \blank[3.2cm] & --\\ \midrule" % (dash(p), dash(p[::-1] if backward else p)))
        for k, t in enumerate(d["trials"]):
            L = len(t)
            rows.append(r"%d & %d & %s & %s & \blank[3.2cm] & \bx\\%s" % (L, k % 2 + 1, dash(t), dash(t[::-1] if backward else t),
                                                                       r"\midrule" if k % 2 else ""))
        return (r"\par\needspace{8\baselineskip}\medskip\textbf{%s}\par\begin{longtable}{@{}llp{4.2cm}p{4.2cm}p{3.4cm}l@{}}\toprule Length & Trial & Say (1 per second) & Correct response & Response given & 1 if correct\\ \midrule\endhead" % title
                + "\n" + "\n".join(rows) + "\n" + r"\bottomrule\end{longtable}")
    b.append(r"\section*{W1. Number repetition}")
    b.append(r"""\textit{Forward: ``I am going to say some numbers. Listen carefully, and when I have finished, say them back to me in the same order.''}
\textit{Backward: ``Now I am going to say some more numbers, but this time when I stop, I want you to say them backwards. For example, if I say 7--1, you would say 1--7.''}

Say one digit per second in an even voice; do not group digits. Give both trials of every length. \textbf{Discontinue} a part when \textbf{both} trials of one length are failed. Practice: if wrong, give the correct answer and repeat once.""")
    b.append(ds_table("dsf", "Forward", False))
    b.append(ds_table("dsb", "Backward", True))
    b.append(r"Forward total (0--16): \blank \quad Longest forward span: \blank \qquad Backward total (0--14): \blank \quad Longest backward span: \blank")

    # W2
    d = f["lns"]
    b.append(r"\section*{W2. Sorting numbers and letters}")
    b.append(r"""\textit{``I will say a mix of numbers and letters. When I have finished, say the numbers first, from smallest to largest, and then the letters in alphabetical order. For example, if I say 9--C--3, you say 3--9--C.''}

One item per second. Practice items: give feedback and the correct answer. A response is correct only if the whole sequence is correct with all numbers before letters. \textbf{Discontinue} when both trials of one length are failed.""")
    rows = []
    for t in d["practice"]:
        rows.append(r"Practice & -- & %s & %s & \blank[3.2cm] & --\\" % (dash(t), dash(lns_answer(t))))
    rows.append(r"\midrule")
    for k, t in enumerate(d["trials"]):
        rows.append(r"%d & %d & %s & %s & \blank[3.2cm] & \bx\\%s" % (len(t), k % 2 + 1, dash(t), dash(lns_answer(t)), r"\midrule" if k % 2 else ""))
    b.append(r"\begin{longtable}{@{}llp{4.2cm}p{4.2cm}p{3.4cm}l@{}}\toprule Length & Trial & Say (1 per second) & Correct response & Response given & 1 if correct\\ \midrule\endhead"
             + "\n" + "\n".join(rows) + "\n" + r"\bottomrule\end{longtable}")
    b.append(r"Total correct (0--12): \blank \quad Longest length passed: \blank")

    # W3
    b.append(r"\section*{W3. Adding and subtracting (booklet)}")
    b.append(r"""Practice page first; check the answers with the participant. Then for each list: \textit{``Turn the page. [Read the instruction on the page.] Work down each column, as quickly as you can without making mistakes. Ready? Begin.''} Time from ``Begin'' to the last answer written. Do not correct during a list. Score errors afterwards with the scoring key (wrong, skipped or illegible answers).

\begin{tabular}{@{}lccc@{}}\toprule & List 1 (+3) & List 2 ($-$3) & List 3 (alternate)\\ \midrule
Time (s) & \blank & \blank & \blank \\ Errors (0--30) & \blank & \blank & \blank \\ \bottomrule\end{tabular}

Flag any list with more than 3 errors (sensitivity analysis).""")

    # W4
    fl = f["flu"]
    ex = FLUENCY_EXAMPLE_LETTER
    b.append(r"\section*{W4. Word lists (spoken)}")
    b.append(r"""\textit{Letters: ``I will say a letter of the alphabet. Then I want you to tell me as many words as you can that begin with that letter, as quickly as you can. For example, if I say %s, you might say nail, night, near. Do not use names of people or places, like Nancy or Nepal, and do not use numbers. Also, do not say the same word again with a different ending, like eat and eating. You will have one minute. The first letter is \ldots''}

\textit{Animals: ``Now tell me as many different animals as you can. You have one minute. Go ahead.''}

\textit{Switching: ``Now I will give you two kinds of things, and I want you to switch back and forth between them: one of the first kind, then one of the second kind, and so on. For example, if the kinds were colours and body parts, you would say red, arm, blue, leg. You have one minute.''}

Responses in English. Write every word in order (audio-record if possible). 60 s each, timed from the end of the instruction. If the participant stops before 30 s, say once: \textit{``Keep going --- any other words?''} Score later with the rules in the scoring key.""" % ex)
    prompts = [("(a) Letter %s" % fl["letters"][0]), ("(b) Letter %s" % fl["letters"][1]), ("(c) Letter %s" % fl["letters"][2]),
               "(d) Animals", "(e) Switch: %s $\\leftrightarrow$ %s" % (tex(fl["alt"][0]), tex(fl["alt"][1]))]
    for p in prompts:
        b.append(r"\par\needspace{7\baselineskip}\medskip\textbf{%s}\par\vspace{2pt}" % p + (r"\blank[\linewidth]\par\vspace{9pt}" * 4))
        if p.startswith("(e)"):
            b.append(r"Valid words \blank\quad Correct switches \blank\quad Repeats \blank\quad Same-category in a row \blank\quad Intrusions \blank\par")
        else:
            b.append(r"Valid words \blank\quad Repeats \blank\quad Rule breaks (names, numbers, same root) \blank\par")

    # W5
    b.append(r"\section*{W5. Finishing sentences (spoken)}")
    b.append(r"""\textit{Part A: ``I am going to read you some sentences. Each one has its last word missing. As soon as I finish, say one word that completes the sentence so that it makes good sense. Be as quick as you can.''}

\textit{Part B: ``Now I will read some more sentences with the last word missing. This time, say a word that does NOT fit the sentence in any way --- a word that has nothing to do with the sentence and makes it nonsense. For example, for `The rabbit hopped across the \ldots', you might say `umbrella'. Be as quick as you can.''}

Read at a natural pace; do not stress the final word. \textbf{RT} = time from the end of your last word to the start of the participant's response, in seconds (preferably measured from the audio recording). If no response in 15~s, say once \textit{``Any word''} and tick ``P'' (prompted). Give the two practice items for each part with feedback; then no feedback.

\textbf{Part B codes} (scored A = 3, B = 1, 0 = correct):
\textbf{A} = a word that sensibly completes the sentence (including the expected word);
\textbf{B} = a word somewhat connected to the sentence: semantically related to the sentence or to the expected word, its opposite, or a jokey/ironic completion;
\textbf{0} = unconnected. If unsure, write the response and leave the code for blind second scoring.""")
    for part in ("A", "B"):
        rows = []
        for s_, t in HAYLING_PRACTICE[part]:
            rows.append(r"P & %s & %s & \blank[2.2cm] & \blank[0.9cm] & %s\\" % (gap(s_), t, "--" if part == "A" else ""))
        rows.append(r"\midrule")
        for k, (s_, t) in enumerate(f["hay"][part], 1):
            if part == "B":
                a_, b_ = HAYLING_CODING_EXAMPLES[t]
                tcell = r"%s\newline{\scriptsize A: %s\newline B: %s}" % (t, ", ".join(x for x in (t, a_) if x), b_)
            else:
                tcell = t
            rows.append(r"%d & %s & %s & \blank[2.2cm] & \blank[0.9cm] & %s\\" % (k, gap(s_), tcell, r"\bx P" if part == "A" else r"A\,B\,0 \bx P"))
        head = "Expected word" if part == "A" else "Word to avoid"
        b.append((r"\par\needspace{10\baselineskip}\medskip\textbf{Part %s}\par{\small\begin{longtable}{@{}r>{\raggedright\arraybackslash}p{7.2cm}>{\raggedright\arraybackslash}p{1.9cm}p{2.4cm}p{1.1cm}l@{}}\toprule \# & Sentence (read aloud) & %s & Response & RT (s) & %s\\ \midrule\endhead" % (part, head, "Prompt" if part == "A" else "Code / prompt"))
                 + "\n" + "\n".join(rows) + "\n" + r"\bottomrule\end{longtable}}")

    # W6
    b.append(r"\section*{W6. Colours (booklet)}")
    b.append(r"""\textbf{Colour check page:} participant names the three patches. If any is misnamed, \textbf{skip W6} (continue the battery) and record ``colour check failed''.

For each page: do the practice row, then \textit{``When I say begin, [read the words / say the ink colours / say the colour of the ink, not the word] going down each column, starting at the top left, as fast as you can. If you finish, go back to the top and start again. If you make a mistake I will say `No'; then correct it and go on.''} Time 45~s exactly, then say ``Stop'' and mark the last item reached.
Score = \textbf{items completed} in 45 s (corrected errors are not subtracted; they cost time). Record corrected and uncorrected errors separately.

\begin{tabular}{@{}lccc@{}}\toprule & Words (W) & Ink (C) & Ink, not word (CW)\\ \midrule
Items completed in 45 s & \blank & \blank & \blank\\ Corrected errors & \blank & \blank & \blank\\ Uncorrected errors & \blank & \blank & \blank\\ Restarted from top? & \bx & \bx & \bx\\ \bottomrule\end{tabular}

Colour check: \bx\ passed \quad \bx\ failed (W6 skipped)""")

    # W7
    b.append(r"\section*{W7. Joining circles (booklet)}")
    b.append(r"""Do each practice page first; if the participant makes an error on practice, point it out and let them correct it. For the test pages: \textit{``Join the circles in order as quickly as you can, without lifting the pen. Ready? Begin.''} Start timing on ``Begin''; stop when the line reaches the circle marked End. If an error is made, point to it immediately, return the pen to the last correct circle and let the participant continue; \textbf{the clock keeps running}. Discontinue at 300 s (record 300 and the number of circles reached).

\begin{tabular}{@{}lcc@{}}\toprule & Part 1 (numbers) & Part 2 (numbers--letters)\\ \midrule
Time (s) & \blank & \blank\\ Errors & \blank & \blank\\ Discontinued at 300 s? & \bx & \bx\\ \bottomrule\end{tabular}

\vspace{6pt}End time: \blank[2cm] \qquad Notes / deviations: \blank[9cm]

\textbf{After W7:} ask the two \emph{after the puzzles} questions (state check C8--C9). At T0, then give Background (Part A) and the habits questionnaire (Part B).""")
    return doc("\n".join(b), "EF battery --- facilitator record --- CONFIDENTIAL", "Form %s" % F, size="10pt", margin="1.6cm")


# ========================================================================================
# Scoring key + rules
# ========================================================================================
def scoring_key(forms, meta):
    b = [r"""\begin{center}{\LARGE\bfseries Scoring key and scoring rules}\\[3pt]{\small EF battery v%s --- Forms A, B, C --- researcher/scorer use only}\end{center}""" % VERSION]
    b.append(r"""\section*{1. Scoring rules}
\begin{description}[style=nextline,leftmargin=0.6cm,itemsep=3pt]
\item[W1 Number repetition] 1 point per correct trial (all digits, correct order). Forward total 0--16, backward total 0--14; longest span = longest length with at least one correct trial. Forward and backward are scored and analysed separately; forward span is a short-term storage/attention covariate, \emph{not} a working-memory updating indicator.
\item[W2 Sorting numbers and letters] 1 point per correct scored trial (0--12); practice not scored. A trial is correct only if all digits come first in ascending order, then all letters in alphabetical order.
\item[W3 Adding and subtracting] Per list: time (s) and errors (wrong, skipped or illegible). Primary: switch cost $= T_3 - \tfrac12(T_1+T_2)$ (s); sensitivity: ratio $T_3/\tfrac12(T_1+T_2)$ and a residual of $T_3$ on $T_1,T_2$. Report all three list times and errors. Lists with $>3$ errors flagged.
\item[W4 Word lists] Score from the transcript (or audio) by two raters blind to occasion. \emph{Letters}: valid = an English word beginning with the letter; not valid = names of people, places, brands; numbers; repeats; the same word with a different ending (eat/eating/eaten; plurals) --- count the first instance only; words in another language. Compound words count if they are not a variant of an earlier word. \emph{Animals}: any real animal (incl.\ birds, fish, insects, extinct animals); a general term and a specific kind both count (dog, poodle); male/female/young forms count separately unless they share the word root (lion/lioness = one). \emph{Switching}: valid word = belongs to one of the two categories, common noun, not a repeat. Correct switch = a valid word from the other category immediately following a valid word. Primary: correct switches; also total valid words, switch ratio $=$ correct switches / (total responses $-1$), repeats, same-category-in-a-row errors, intrusions.
\item[W5 Finishing sentences] Part B coding anchors for every item are printed on the record sheets (A = expected word or another sensible completion; B = related word; illustrative, not exhaustive). Part A: mean RT (s) of the 15 items; Part A errors (no sensible completion) recorded. Part B: mean RT; error score $= 3\times(\text{A codes}) + 1\times(\text{B codes})$ (0--45). Primary inhibition index for W5 is a single within-task score formed first (mean of $z$[B$-$A RT] and $z$[B error score], each reversed) and then \emph{re-standardised} to SD 1 in the T0 sample, so W5 is neither double-weighted nor under-weighted against Stroop. Prompted items are kept and flagged. Two blind raters code Part B; report Cohen's $\kappa$ (target $\ge .80$); disagreements resolved by discussion.
\item[W6 Colours] $W$, $C$, $CW$ = items completed in 45 s. Golden interference $IG = CW - \frac{W\times C}{W+C}$; \textbf{higher $IG$ = better interference control} (enter as $+z$). Also report raw $CW$, $CW/C$, and errors.
\item[W7 Joining circles] Time (s) for parts 1 and 2; errors. Primary shifting index: residual of part-2 time regressed on part-1 time (baseline sample), higher = slower = worse (enter as $-z$). $B-A$ and $B/A$ are sensitivity analyses only.
\item[W8 ADEXI] Official scoring: Working memory = sum of items 1, 2, 5, 7, 8, 9, 11, 12, 13 (9--45); Inhibition = sum of items 3, 4, 6, 10, 14 (5--25); higher = more reported difficulty. Report separately from the task scores; never combine into a single EF total.
\end{description}""")
    b.append(r"""\textbf{Direction and standardisation.} All $z$ scores use the \emph{T0 sample} mean and SD (fixed reference) so later occasions stay on the same scale; where pilot equating constants exist, subtract the form-specific pilot mean difference first (linear equating). Higher domain score = better: WM $=$ mean($z$ backward total, $z$ W2 total); Inhibition $=$ mean($+z\,IG$, $z$ W5 index); Shifting $=$ mean($-z$ W3 switch cost, $-z$ W7 residual) with $+z$ W4 correct switches as a sensitivity indicator. Forward span, Part 1 time and letter/animal fluency are covariates.""")
    for F in FORMS:
        f = forms[F]
        b.append(r"\clearpage\section*{2.%d Form %s answer key}" % (FORMS.index(F) + 1, F))
        # W3
        b.append(r"\textbf{W3 answers} (practice: +3: %s; $-$3: %s; alternate: %s)\par" % (
            ", ".join(str(n + 3) for n in f["pm"]["practice"]["plus"]),
            ", ".join(str(n - 3) for n in f["pm"]["practice"]["minus"]),
            ", ".join(str(pm_answer(n, "+" if k % 2 == 0 else "-")) for k, n in enumerate(f["pm"]["practice"]["alt"]))))
        rows = []
        Ls = f["pm"]["lists"]
        for i in range(30):
            cells = []
            for L in Ls:
                n, o = L["items"][i], L["ops"][i]
                cells.append(r"%d$\to$\textbf{%d}" % (n, pm_answer(n, o)))
            rows.append("%d & " % (i + 1) + " & ".join(cells) + r"\\")
        b.append(r"{\small\begin{tabular}{@{}rlll@{\hspace{1.2cm}}rlll@{}}\toprule \# & L1 (+3) & L2 ($-$3) & L3 (alt.) & \# & L1 (+3) & L2 ($-$3) & L3 (alt.)\\ \midrule"
                 + "\n" + "\n".join(rows[i][:-2] + " & " + rows[i + 15] for i in range(15)) + "\n" + r"\bottomrule\end{tabular}}\par\medskip")
        # W6 keys
        s = f["stroop"]
        ab = lambda seq: [x[0].upper() for x in seq]

        def grid(seq, title):
            rows_ = [" & ".join(seq[c * 20 + r] for c in range(STROOP_COLS)) + r"\\" for r in range(20)]
            return (r"\begin{minipage}[t]{0.3\linewidth}\centering\textbf{%s}\\[2pt]\ttfamily\footnotesize\begin{tabular}{ccccc}" % title
                    + "\n".join(rows_) + r"\end{tabular}\end{minipage}")
        b.append(r"\textbf{W6 keys} (R/G/B, laid out exactly as on the page; read down each column)\par\medskip"
                 + grid(ab(s["words"]), "Words (W)") + r"\hfill" + grid(ab(s["colours"]), "Ink (C)") + r"\hfill"
                 + grid(ab(s["cw_ink"]), "Ink, not word (CW)") + r"\par\medskip")
        b.append(r"\textbf{W1, W2, W5:} correct responses / expected words are printed on the Form %s facilitator record sheet." % F)
    return doc("\n".join(b), "EF battery --- scoring key --- CONFIDENTIAL", "v%s" % VERSION, size="10pt", margin="1.7cm")


# ========================================================================================
# Questionnaires (background, ADEXI, state check, administration log)
# ========================================================================================
def _scale_row(q, spec, num):
    if spec == "hours":
        return r"%s. %s \hfill \blank[1.5cm] hours\par\vspace{6pt}" % (num, tex(q))
    if isinstance(spec, list):
        return r"%s. %s\par\hspace*{1em}" % (num, tex(q)) + r"\quad ".join(r"\bx\ %s" % tex(o) for o in spec) + r"\par\vspace{6pt}"
    lo, hi = spec.split(":")[1].split("|")
    return (r"%s. %s\par\hspace*{1em}{\small %s}\ " % (num, tex(q), tex(lo)) + r" ".join(r"\bx\,%d" % i for i in range(11))
            + r"\ {\small %s}\par\vspace{6pt}" % tex(hi))


def questionnaires():
    b = []
    b.append(r"""\begin{center}{\LARGE\bfseries About you and how you feel today}\end{center}
{\footnotesize\itshape [Facilitator: Parts A and B at the first session only (Part B optionally again at the last session); Part C at every session. Print only the parts needed.]}

Participant ID: \blank[4cm]\qquad Date: \blank[3cm]""")
    # Part A
    b.append(r"""\section*{Part A. About you (first session only)}
\begin{enumerate}[itemsep=5pt]
\item Age: \blank[1.5cm] years
\item Highest completed education: \bx\ Secondary \quad \bx\ Diploma / associate \quad \bx\ Bachelor's \quad \bx\ Master's \quad \bx\ Doctorate \quad \bx\ Other: \blank[2.5cm]
\item First language(s) you learned as a child: \blank[6cm]
\item Language you use most at home now: \blank[5cm]
\item Main language of teaching at your secondary school: \blank[4cm] \quad and at university/college: \blank[3.5cm]
\item How well do you understand spoken English? \bx\ Not well \quad \bx\ Fairly well \quad \bx\ Well \quad \bx\ Very well \quad \bx\ Native / as well as my first language
\item How well do you speak English? \bx\ Not well \quad \bx\ Fairly well \quad \bx\ Well \quad \bx\ Very well \quad \bx\ Native / as well as my first language
\item Have you done puzzles like these before (for example repeating numbers backwards, naming ink colours, joining numbered circles, saying words that start with a letter)?\par
\bx\ No \quad \bx\ Yes, in a research study \quad \bx\ Yes, in a clinical or educational assessment \quad \bx\ Yes, elsewhere \quad If yes, roughly when? \blank[2.5cm]
\item Do you have any difficulty telling colours apart (for example red--green colour blindness)? \bx\ No \quad \bx\ Yes \quad \bx\ Not sure
\item Do you need glasses or contact lenses for reading? \bx\ No \quad \bx\ Yes, and I am wearing them now \quad \bx\ Yes, but I am not wearing them now
\item Do you have any difficulty hearing speech in a quiet room? \bx\ No \quad \bx\ Yes
\item Which hand do you write with? \bx\ Right \quad \bx\ Left \quad \bx\ Either
\item \emph{(Include only if approved by the ethics committee.)} Have you ever been told by a professional that you have a condition that affects reading, attention or memory (for example dyslexia or ADHD)? \bx\ No \quad \bx\ Yes \quad \bx\ Prefer not to say
\end{enumerate}""")
    # Part B ADEXI
    rows = []
    for i, it in enumerate(ADEXI_ITEMS, 1):
        rows.append(r"%d. %s & 1 & 2 & 3 & 4 & 5\\[3pt]" % (i, tex(it)))
    b.append(r"""\clearpage\section*{Part B. How you usually are (first session)}

%s

\begin{longtable}{@{}p{9.4cm}*{5}{>{\centering\arraybackslash}p{1.2cm}}@{}}\toprule
 & \scriptsize %s & \scriptsize %s & \scriptsize %s & \scriptsize %s & \scriptsize %s\\ \midrule
%s
\bottomrule\end{longtable}
{\tiny Items: Holst \& Thorell (2018), reproduced unchanged.}""" % (tex(ADEXI_INSTRUCTIONS), *[tex(x) for x in ADEXI_SCALE], "\n".join(rows)))
    # Part C state check
    b.append(r"\clearpage\section*{Part C. How you are feeling today (every session)}")
    b.append(r"\textbf{Before the puzzles}\par")
    for i, (q, spec) in enumerate(STATE_ITEMS_BEFORE, 1):
        b.append(_scale_row(q, spec, "C%d" % i))
    b.append(r"\vspace{4pt}\textbf{After the puzzles}\par")
    for i, (q, spec) in enumerate(STATE_ITEMS_AFTER, len(STATE_ITEMS_BEFORE) + 1):
        b.append(_scale_row(q, spec, "C%d" % i))
    b.append(r"\blank[\linewidth]")
    b.append(r"{\small These questions describe how you are today. They help us interpret the puzzles and are not a measure of ability.}")
    return doc("\n".join(b), "Attention and memory puzzles", "", size="10pt", margin="1.7cm")


def admin_log():
    b = [r"Participant ID: \blank[4cm]"]
    # Part D log
    b.append(r"""\section*{Administration log (facilitator, every occasion)}
\begin{tabular}{@{}p{6.3cm}p{10cm}@{}}\toprule
Occasion & \bx\ T0 \quad \bx\ T1 \quad \bx\ T2 \\
Form used / order code & Form \blank[1cm] \quad order \blank[1.5cm] (from allocation list)\\
Position in the session & \bx\ start of session, before any test or course content (protocol) \quad \bx\ other: \blank[3cm]\\
Date / clock time started -- finished & \blank[2.5cm] \quad \blank[1.5cm} -- \blank[1.5cm]\\
Minutes since the end of the last test or demanding activity & \blank[1.5cm] min\\
Mode & \bx\ paper, in person (protocol) \quad \bx\ other: \blank[3cm]\\
Room & \bx\ quiet \quad \bx\ some noise \quad \bx\ noisy \quad Lighting adequate for colours: \bx\ yes \bx\ no\\
Timing method & \bx\ audio recording + later measurement \quad \bx\ stopwatch\\
Breaks taken (when, how long) & \blank[8cm]\\
Tasks omitted or interrupted, and why & \blank[8cm]\\
Deviations from the script & \blank[8cm]\\
Facilitator & \blank[5cm]\\ \bottomrule
\end{tabular}""".replace(r"\blank[1.5cm}", r"\blank[1.5cm]"))
    return doc("\n".join(b), "EF battery --- administration log --- facilitator only", "v%s" % VERSION, size="10pt", margin="1.7cm")


def cloze_form():
    items = HAYLING_POOL + HAYLING_PRACTICE["A"] + HAYLING_PRACTICE["B"] + HAYLING_RESERVE
    rng = random.Random(POOL_SEED + 23)
    order = list(range(len(items)))
    rng.shuffle(order)
    rows = [r"%d. %s\hfill\blank[3cm]\par\vspace{3pt}" % (k, tex(items[i][0].replace("___.", "..."))) for k, i in enumerate(order, 1)]
    body = (r"""\begin{center}{\LARGE\bfseries Sentence completion survey}\end{center}
For each sentence, write the \textbf{first single word} that comes to mind to complete it. Do not think for long; there are no right or wrong answers. Write one word only.

Your first language: \blank[4cm] \quad Age: \blank[1.5cm]

\begin{multicols}{1}""" + "\n".join(rows) + r"\end{multicols}"
)
    # Researcher instructions (not printed): independent sample, n >= 30, language background like the cohort's,
    # never study participants; keep an item if >= 80% give the expected word; item map in stimuli.json (cloze_order).
    return doc(body, "Sentence completion survey", "", size="11pt", margin="2cm"), [items[i] for i in order]


def allocation(n=60):
    rng = random.Random(POOL_SEED + 31)
    orders = ["ABC", "ACB", "BAC", "BCA", "CAB", "CBA"]
    rows = []
    while len(rows) < n:
        blk = orders[:]
        rng.shuffle(blk)
        rows += blk
    return [dict(slot=i + 1, block=i // 6 + 1, order=o, T0=o[0], T1=o[1], T2=o[2]) for i, o in enumerate(rows[:n])]


# ========================================================================================
# Diagnostics
# ========================================================================================
def diagnostics_md(forms, meta, checks):
    try:
        from wordfreq import zipf_frequency
    except ImportError:
        zipf_frequency = None
    L = ["# Form diagnostics -- EF battery v%s" % VERSION, "",
         "Generated by `ef.py`. Seeds: %s; pool seed %d." % (meta["seeds"], meta["pool_seed"]), "",
         "Stimulus *properties* only. Equal properties do not prove equal difficulty; form equivalence must be confirmed in the pilot.", ""]
    L += ["## W3 plus-minus", "", "| Form | L1 mean | L2 mean | L3 mean | L1 crossings | L2 crossings | L3 (+/-) crossings |", "|---|---|---|---|---|---|---|"]
    for F, f in forms.items():
        a, b_, c = f["pm"]["lists"]
        L.append("| %s | %.2f | %.2f | %.2f | %d/30 | %d/30 | %d/15, %d/15 |" % (
            F, statistics.mean(a["items"]), statistics.mean(b_["items"]), statistics.mean(c["items"]),
            sum(crosses(n, "+") for n in a["items"]), sum(crosses(n, "-") for n in b_["items"]),
            sum(crosses(n, o) for n, o in zip(c["items"], c["ops"]) if o == "+"),
            sum(crosses(n, o) for n, o in zip(c["items"], c["ops"]) if o == "-")))
    L += ["", "## W7 trail geometry (test layouts)", "", "| Form | Part | Path (mm) | Turning (deg) | Mean nearest distractor (mm) | Distractors <15 mm | Crossings |", "|---|---|---|---|---|---|---|"]
    for F, f in forms.items():
        for part in ("tmtA", "tmtB"):
            m = tmt_metrics(f[part])
            L.append("| %s | %s | %.1f | %.0f | %.1f | %d | %d |" % (F, part[-1], m["path_mm"], m["turning_deg"], m["mean_nearest_distractor_mm"], m["near_distractors_15mm"], m["crossings"]))
    L += ["", "Pooled-median target: %s" % meta["tmt_target"], ""]
    L += ["## W5 sentences", "", "| Form | Part | Mean words | SD words | Mean target Zipf |", "|---|---|---|---|---|"]
    for F, f in forms.items():
        for p in ("A", "B"):
            w = [n_words(s) for s, _ in f["hay"][p]]
            z = statistics.mean(zipf_frequency(t, "en") for _, t in f["hay"][p]) if zipf_frequency else float("nan")
            L.append("| %s | %s | %.2f | %.2f | %.2f |" % (F, p, statistics.mean(w), statistics.pstdev(w), z))
    L += ["", "## W6 colour counts (red/green/blue)", "", "| Form | W words | C inks | CW inks | CW congruent |", "|---|---|---|---|---|"]
    for F, f in forms.items():
        s = f["stroop"]
        c = lambda seq: "/".join(str(seq.count(x)) for x in COLOURS)
        L.append("| %s | %s | %s | %s | %d |" % (F, c(s["words"]), c(s["colours"]), c(s["cw_ink"]), sum(a == b for a, b in zip(s["cw_words"], s["cw_ink"]))))
    L += ["", "## W4 prompts", "", "| Form | Letters | Semantic | Switching |", "|---|---|---|---|"]
    for F, f in forms.items():
        L.append("| %s | %s | %s | %s / %s |" % (F, " ".join(f["flu"]["letters"]), f["flu"]["cat"], *f["flu"]["alt"]))
    L += ["", "## Automated checks", "", "| Check | Result | Detail |", "|---|---|---|"]
    for name, ok, det in checks:
        L.append("| %s | %s | %s |" % (name, "PASS" if ok else "**FAIL**", det.replace("|", "/")))
    L += ["", "**%d / %d checks passed.**" % (sum(ok for _, ok, _ in checks), len(checks))]
    return "\n".join(L) + "\n"


def participant_safety_check(ptex, f):
    """Oral stimuli and expected answers must not appear in the participant booklet."""
    leaks = []
    for part in ("dsf", "dsb"):
        for t in f[part]["trials"] + f[part]["practice"]:
            if dash(t) in ptex:
                leaks.append(dash(t))
    for t in f["lns"]["trials"] + f["lns"]["practice"]:
        if dash(t) in ptex:
            leaks.append(dash(t))
    for p in ("A", "B"):
        for s, _ in f["hay"][p]:
            if gap(s)[:25] in ptex:
                leaks.append(s)
    for x in f["flu"]["letters"]:
        if ("Letter %s" % x) in ptex:
            leaks.append("fluency letter " + x)
    return leaks


# ========================================================================================
# Main
# ========================================================================================
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="build")
    ap.add_argument("--pdf", action="store_true")
    ap.add_argument("--reassign-hayling", action="store_true")
    ap.add_argument("--from-json", metavar="STIMULI_JSON",
                    help="rebuild documents from a frozen stimuli.json instead of regenerating (fast, exact)")
    a = ap.parse_args()
    if a.reassign_hayling:
        assign, cost = assign_hayling()
        print("cost", round(cost, 4))
        print("HAYLING_ASSIGNMENT = " + json.dumps(assign))
        return
    os.makedirs(a.out, exist_ok=True)
    if a.from_json:
        with open(a.from_json) as fh:
            frozen = json.load(fh)
        forms = frozen["forms"]
        meta = {k: v for k, v in frozen["meta"].items() if k not in ("code_sha256", "constraints")}
    else:
        print("generating stimuli (trail layouts take a few minutes) ...", flush=True)
        forms, meta = build_all()
    checks = run_checks(forms, meta)
    files = {}
    for F in FORMS:
        files["participant_booklet_%s.tex" % F] = participant_booklet(forms[F], meta)
        files["facilitator_record_%s.tex" % F] = facilitator_record(forms[F], meta)
        leaks = participant_safety_check(files["participant_booklet_%s.tex" % F], forms[F])
        checks.append(("%s participant booklet contains no oral stimuli / fluency prompts" % F, not leaks, "; ".join(leaks[:3])))
    files["scoring_key.tex"] = scoring_key(forms, meta)
    files["questionnaires.tex"] = questionnaires()
    files["administration_log.tex"] = admin_log()
    cz, cz_order = cloze_form()
    files["cloze_norming_form.tex"] = cz
    files["form_diagnostics.md"] = diagnostics_md(forms, meta, checks)
    failed = [c for c in checks if not c[1]]
    for name, body in files.items():
        with open(os.path.join(a.out, name), "w", encoding="utf-8") as fh:
            fh.write(body)
    with open(os.path.join(a.out, "allocation.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=["slot", "block", "order", "T0", "T1", "T2"])
        w.writeheader()
        w.writerows(allocation())
    code_hash = hashlib.sha256(open(__file__, "rb").read()).hexdigest()
    with open(os.path.join(a.out, "stimuli.json"), "w") as fh:
        json.dump(dict(meta=dict(meta, code_sha256=code_hash, constraints=CONSTRAINTS),
                       forms=forms, adexi=dict(items=ADEXI_ITEMS, key=ADEXI_KEY),
                       cloze_order=[dict(n=k + 1, sentence=s, expected=t) for k, (s, t) in enumerate(cz_order)]),
                  fh, indent=1)
    print("%d/%d checks passed" % (len(checks) - len(failed), len(checks)))
    if failed:
        for c in failed:
            print("FAIL:", c)
        sys.exit(1)
    if a.pdf:
        for name in files:
            if name.endswith(".tex"):
                r = subprocess.run(["pdflatex", "-interaction=nonstopmode", "-halt-on-error", name], cwd=a.out,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
                r = subprocess.run(["pdflatex", "-interaction=nonstopmode", "-halt-on-error", name], cwd=a.out,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
                print(("ok   " if r.returncode == 0 else "FAIL ") + name)
                if r.returncode:
                    print(r.stdout.decode(errors="ignore")[-2500:])


if __name__ == "__main__":
    main()
