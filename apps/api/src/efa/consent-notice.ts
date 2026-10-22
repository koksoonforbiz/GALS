/**
 * Notice shown and accepted at the start of every assessment occasion.
 * Stored version = EFA_NOTICE_VERSION on efa_occasions.consent_version.
 *
 * DRAFT pending ethics approval. docs/EF_battery_v2/CONSENT_NOTICE.md holds
 * the same paragraphs for the ethics submission; consent-notice.spec.ts
 * keeps the two identical. Bump the version whenever the wording changes.
 *
 * Wording is neutral by design (blinding): no construct names.
 */
export const EFA_NOTICE_VERSION = 'ef-assessment-notice-v1';

export const EFA_NOTICE_TITLE = 'Before you begin: attention and memory puzzles';

export const EFA_NOTICE_PARAGRAPHS: readonly string[] = [
  'As part of this research course, you will complete a short questionnaire ("About you and how you feel today") and a set of attention and memory puzzles. This takes about 35 minutes the first time and about 30 minutes on later occasions. The puzzles are not part of the course assessment, there is no pass mark, and you will not see a score.',
  'What we record: your answers to the questionnaire; for each puzzle, what was shown, what you typed, clicked or pressed, and the timing of each response; and basic information about your device (browser, screen and window size, and whether you used full screen). Words you type in the word and sentence puzzles are stored as part of your answers. We do not record your keystrokes outside the answer boxes, your camera or your screen during the puzzles.',
  'How it is used: your answers are used for research only, linked to your course account and kept with the other research data from this course, as described in the participant information sheet and consent form for this study. Results are reported only in a form that does not identify you.',
  'Completing the questionnaire and puzzles is required before the course sessions open. If you have questions, or wish to withdraw from the study, please contact your instructor or the research team named in the participant information sheet.',
  'Please use a desktop or laptop computer with a keyboard and a mouse or trackpad, in a quiet place where you will not be interrupted. Close other tabs and silence notifications before you start.',
];

export const EFA_NOTICE_ACCEPT_LABEL =
  'I have read this notice and agree to take part in the questionnaire and puzzles.';
