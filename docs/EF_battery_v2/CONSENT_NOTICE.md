# Assessment notice `ef-assessment-notice-v2` (DRAFT for ethics review)

This notice is shown to students at the start of every assessment occasion (T0, optional T1, T2). The student must accept it before the questionnaire opens. Per the study design (decision Q7), completing the assessment is required before the course sessions open, so there is no opt-out path inside the app. The ethics committee should confirm that this is acceptable, or ask for a different route, such as a staff override for students who decline.

- **Where it lives in the app:** `apps/api/src/efa/consent-notice.ts`. The API serves it, so the student bundle carries no copy.
- **Keeping it in sync:** `consent-notice.spec.ts` fails if the text below and the app differ.
- **Versioning:** if the committee changes the wording, edit both, bump the version (e.g. `ef-assessment-notice-v2`), and existing acceptances keep their old version string.

**Version history:**

- `ef-assessment-notice-v1`: camera and screen were not recorded during the puzzles.
- `ef-assessment-notice-v2` (2026-11-25): the camera (video, no sound) and the platform tab (screenshots and page content) are recorded during the questionnaire and puzzles, as in the course sessions, and the page pauses if the camera is turned off or covered. Occasions accepted under v1 keep that version string.

**To confirm with the committee:**

- recording the camera and the platform tab during the questionnaire and puzzles (v2), and blocking the page while the camera is off or covered;

- the partial-disclosure framing ("attention and memory puzzles"; construct names are not shown to students);
- that typed responses in the word and sentence puzzles are stored regardless of the course's separate text-capture setting;
- the required-completion design;
- the contact route named in the notice.

---

## Text shown to students

**Before you begin: attention and memory puzzles**

As part of this research course, you will complete a short questionnaire ("About you and how you feel today") and a set of attention and memory puzzles. This takes about 35 minutes the first time and about 30 minutes on later occasions. The puzzles are not part of the course assessment, there is no pass mark, and you will not see a score.

What we record: your answers to the questionnaire; for each puzzle, what was shown, what you typed, clicked or pressed, and the timing of each response; and basic information about your device (browser, screen and window size, and whether you used full screen). Words you type in the word and sentence puzzles are stored as part of your answers. As in the course sessions, we also record your camera (a video of your face, without sound) and this browser tab (screenshots and the page content) while you do the questionnaire and puzzles. We do not record your keystrokes outside the answer boxes.

How it is used: your answers are used for research only, linked to your course account and kept with the other research data from this course, as described in the participant information sheet and consent form for this study. Results are reported only in a form that does not identify you.

Completing the questionnaire and puzzles is required before the course sessions open. If you have questions, or wish to withdraw from the study, please contact your instructor or the research team named in the participant information sheet.

Please use a desktop or laptop computer with a keyboard, a mouse or trackpad and a webcam, in a quiet place where you will not be interrupted. Close other tabs and silence notifications before you start. Keep your camera on and uncovered: the page pauses until it works again.

☐ I have read this notice and agree to take part in the questionnaire and puzzles.
