export const DEFAULT_PROMPTS: Record<string, string> = {
  metacognition_general: `Task: Decide whether the learner utterance below shows METACOGNITION -- i.e., the learner is explicitly thinking about their own thinking, knowing, understanding, or learning.

Mark POSITIVE if the utterance:
  - uses a first-person pronoun (I, we, my, our) AND
  - references a cognitive state, process, or product (understand, know, think, remember, sure, confused, learn, figured out, realize, notice).
Examples of positive: "I'm not sure if I got this correct." / "I think I understand now." / "I don't remember how to start." / "We need to figure out what's missing."
Mark NEGATIVE if the utterance describes only object-level facts, asks a content question without self-reference, or expresses pure affect with no cognitive referent.
Examples of negative: "The answer is 42." / "What is X?" / "This is annoying."

Output JSON only: {"label": "positive" | "negative", "confidence": 0.0..1.0, "rationale": "<=20 words>"}

Utterance: <<<INSERT_UTTERANCE>>>`,

  metacognitive_monitoring: `Task: Decide whether the learner utterance shows METACOGNITIVE MONITORING -- specifically, the learner verbalising awareness that something they did or thought is incorrect, incomplete, or mistaken.

Mark POSITIVE if the utterance contains:
  - explicit error recognition ("that's wrong", "I made a mistake", "that doesn't look right")
  - self-correction signals ("wait", "oh no", "actually no", "hmm that's not right")
  - doubt about own answer ("I don't think this is correct", "this doesn't add up")
Examples of positive: "It's incorrect. What's happened?" / "Wait, I divided when I should have multiplied." / "That can't be right."
Mark NEGATIVE if the utterance is content-execution, content-question, or non-error reflection.
Examples of negative: "The next step is to multiply." / "What does this term mean?"

Output JSON only: {"label": "positive" | "negative", "confidence": 0.0..1.0, "rationale": "<=20 words>"}

Utterance: <<<INSERT_UTTERANCE>>>`,

  attention_regulation: `Task: Decide whether the learner utterance signals ATTENTION REGULATION FAILURE / MIND-WANDERING -- i.e., the learner reports their attention drifted from the task.

Mark POSITIVE if the utterance contains:
  - explicit task-unrelated thought ("I was thinking about lunch", "I keep zoning out")
  - reading-without-comprehending ("I read this paragraph three times and didn't take it in")
  - lost-place markers ("where was I", "wait, what was I doing")
Examples of positive: "I was thinking about lunch instead." / "I keep re-reading this and it's not going in." / "I just zoned out for a minute."
Mark NEGATIVE if the utterance shows on-task confusion, content-question, or simple silence. Confusion ("I don't get this") is NOT mind-wandering -- only label positive if attention was reported as elsewhere.

WARNING: text-only detection of this construct has a published ceiling of kappa around 0.21. Treat outputs as noisy. Confidence should rarely exceed 0.6.

Output JSON only: {"label": "positive" | "negative", "confidence": 0.0..1.0, "rationale": "<=20 words>"}

Utterance: <<<INSERT_UTTERANCE>>>`,

  working_memory: `Task: Estimate WORKING-MEMORY LOAD for the adult learner who produced the utterance below, on a 3-level scale.

WARNING: WM capacity (a person-level trait) is NOT recoverable from text alone. WM LOAD (a moment-level state) is only weakly inferable from text. Treat outputs as noisy proxies.

Rate LOW if the utterance is fluent, on-track, and shows no signs of tracking difficulty.
Rate MEDIUM if the utterance shows mild reformulation, brief hesitation, or one self-correction.
Rate HIGH if the utterance contains:
  - lost-track markers ("wait, what was I doing?", "where was I?", "OK so back to...")
  - multiple mid-sentence reformulations or restarts
  - reference loss (pronouns without antecedent, abandoned clauses)
  - sudden syntactic simplification mid-task

Examples:
  LOW: "The mitochondrion produces ATP through oxidative phosphorylation."
  MEDIUM: "The answer is -- hmm, let me think -- I think it's 42."
  HIGH: "Wait, what was I supposed to do again? I had something but... never mind."

Output JSON only: {"label": "low" | "medium" | "high", "confidence": 0.0..1.0, "rationale": "<=20 words>", "warning": "text-only WM detection is weak; pair with keystroke / latency features for production use."}

Utterance: <<<INSERT_UTTERANCE>>>`,

  cognitive_flexibility: `Task: Decide whether the learner utterance signals COGNITIVE FLEXIBILITY (a strategic approach change), with the explicit caveat that this lexical signal is NOT validated as a measure of EF cognitive flexibility -- it captures verbalised strategy switches, which may co-occur with set-shifting or with rote rhetorical moves.

Mark POSITIVE if the utterance contains:
  - a verbal pivot ("actually", "on second thought", "scratch that", "never mind")
  - explicit alternative-strategy framing ("let me try a different approach", "what if I instead...", "or I could...")
  - abandonment + restart ("that won't work -- let me back up")
Examples: "Actually, that won't work -- let me back up and try a different approach." / "On second thought, scratch that -- alternatively I could..."
Mark NEGATIVE if the utterance is mere correction of a calculation slip (that's metacognitive monitoring) or content delivery without strategy change.

Output JSON only: {"label": "positive" | "negative", "confidence": 0.0..1.0, "rationale": "<=20 words>", "warning": "surface marker; not validated as EF cognitive flexibility."}

Utterance: <<<INSERT_UTTERANCE>>>`,

  confusion: `Task: Decide whether the learner utterance below expresses CONFUSION -- a perceived mismatch between what the learner expected and what they encountered, including not knowing how to proceed.

Mark POSITIVE if the utterance contains:
  - explicit non-understanding ("I don't get this", "I'm confused", "this makes no sense")
  - surprise-at-mismatch ("wait, why does this work?", "how can that be?")
  - verification questions where the learner is checking a conflict with their prior model ("do we assume X is zero?", "shouldn't this be Y instead?")
  - why/how-questions framed against an apparent contradiction
Examples: "Wait, I don't get why this works." / "I'm confused about the difference between mean and median." / "Why isn't pressure a function of theta and z?"
Mark NEGATIVE if the utterance is a pure factual request without expressed mismatch ("What's the formula for area?"), an emotional outburst without a content target, or a self-reported general lack of focus.

Optionally output a SEVERITY 1..5 (1 = mild puzzlement, 5 = blocked / cannot proceed) following MathDial conventions.

Output JSON only: {"label": "positive" | "negative", "severity": 1-5 | null, "confidence": 0.0..1.0, "rationale": "<=20 words>"}

Utterance: <<<INSERT_UTTERANCE>>>`,

  frustration: `Task: Decide whether the learner utterance below expresses FRUSTRATION -- a sustained negative affect arising from blocked progress on a task they care about.

Mark POSITIVE if the utterance contains:
  - expressions of being stuck for a while ("I've been on this forever", "still not working", "I keep getting it wrong")
  - exasperation markers ("ugh", "argh", repeated punctuation "why?!", expletives in service of the task)
  - give-up signals ("I give up", "just tell me the answer", "forget it")
  - repetition of prior complaints ("like I said, this isn't working")
Examples: "Ugh, I've been stuck on this forever." / "This makes no sense. I already told you that." / "Why isn't this working??" / "I give up."
Mark NEGATIVE if the utterance is brief confusion without sustained-blockage signal, or neutral content. Do not confuse boredom ("this is boring") with frustration (which is high-arousal and goal-directed).

Output JSON only: {"label": "positive" | "negative", "confidence": 0.0..1.0, "rationale": "<=20 words>"}

Utterance: <<<INSERT_UTTERANCE>>>`,

  engagement: `Task: Decide whether the learner utterance is ON-TASK or OFF-TASK relative to the current course / problem context.

Mark ON-TASK if the utterance:
  - engages with course content
  - builds on a peer's contribution
  - asks a content question or proposes a content step
Mark OFF-TASK if the utterance:
  - discusses unrelated topics ("anyone seen the new movie?")
  - is pure social chatter without content ("haha cool")
  - is meta-complaint without content target ("this class is so boring lol")
  - is a non-content procedural aside unrelated to the current step ("what time is lunch?")

Output JSON only: {"label": "on-task" | "off-task", "confidence": 0.0..1.0, "rationale": "<=20 words>"}

Utterance: <<<INSERT_UTTERANCE>>>
Course context: <<<INSERT_COURSE_TOPIC_OR_CURRENT_PROBLEM>>>`,

  boredom: `Task: Decide whether the learner utterance below expresses BOREDOM -- a low-arousal negative affect characterised by lack of interest, perceived monotony, or wanting the activity to end.

Mark POSITIVE if the utterance contains:
  - explicit boredom self-disclosure ("I'm bored", "this is boring", "so boring")
  - criticising-coping markers ("can we do something else?", "this is tedious", "I'd rather do anything else")
  - restless waiting-for-end signals ("I can't wait for class to end", "how much longer")
  - daydreaming-from-monotony ("so boring I keep zoning out", "my mind keeps drifting")
Examples (verbatim from AEQ-S Bieleke 2021 and BROMP manuals): "The lecture bores me." / "This is boring." / "Can we do something else?" / "I would rather put off this boring work till tomorrow."
Mark NEGATIVE for: confusion (low-arousal but not boredom), frustration (high-arousal negative), terse one-word replies WITHOUT explicit boredom marker ("k", "next", "idk" -- these correlate with disengagement but are NOT validated as boredom-positive in any published codebook).

WARNING: text-only boredom detection has a published ceiling of 69% binary accuracy (D'Mello 2008); GoEmotions excluded boredom due to low IRR. Treat outputs as high-precision-low-recall; default to negative on ambiguous cases.

Output JSON only: {"label": "positive" | "negative", "confidence": 0.0..1.0, "rationale": "<=20 words>"}

Utterance: <<<INSERT_UTTERANCE>>>`,
};
