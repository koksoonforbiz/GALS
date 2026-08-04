# Draft email to IITS — GALS deployment for an SMU Academy workshop

**To:** IITS (SMU Integrated Information Technology Services) — [IITS contact / helpdesk]
**Cc:** [SCIS IT / lab contact], [SMU Academy programme lead], [Project supervisor]
**From:** [Your name], [School / Centre], Singapore Management University
**Subject:** Intent to deploy the GALS learning platform in an upcoming SMU Academy workshop — hosting options and data-collection scope

---

Dear IITS team,

I am writing on behalf of our research team to share our intent to run the **GALS
(Gaze-Aware Learning System)** platform as part of one of the upcoming **SMU
Academy (SMUA) workshops**, and to seek your guidance on the most appropriate and
lowest-risk way to host it within SMU's environment.

**1. What we plan to do in the workshop**

Towards the end of the workshop session, participants will use the GALS platform
to **revise the content covered during the day**, ending with a **short quiz** to
consolidate their learning. GALS runs entirely in the participant's web browser;
learners simply open the platform, work through the revision material, and
complete the quiz.

**2. Hosting**

Because participants will access GALS during the workshop, we need it hosted on a
reachable server. We are considering two options and would appreciate your advice
on which poses **less operational and security risk** for SMU:

- **Option A — On-premise:** hosting on the **SCIS L40 GPU server**; or
- **Option B — Cloud:** hosting on a cloud instance.

We are happy to follow whichever option IITS considers safer and easier to
support, and to comply with any hardening, network, or access-control
requirements you specify.

**3. Privacy safeguards for this deployment**

We have deliberately minimised data collection for this workshop:

- **Webcam video recording is turned OFF.** No video of participants is recorded,
  stored, or transmitted.
- The **only biometric signal collected is eye-gaze data**.
- Eye gaze is produced by **WebGazer running entirely on the client side** (in the
  participant's own browser). The webcam feed is processed locally in the browser
  to estimate gaze coordinates; **the raw camera image never leaves the device**
  — only the resulting gaze coordinates are sent to the server.

**4. Data we will collect**

For transparency, below is the full inventory of data GALS will collect in this
workshop configuration.

*Biometric (the only biometric signal):*
- **Eye-gaze estimates** — on-screen gaze coordinates (x, y) with a confidence
  value, computed client-side by WebGazer.

*Learning interaction / behavioural telemetry:*
- Learning **activity logs** (module/page navigation, time-on-task)
- **Mouse** clicks, cursor movement, and scroll events
- **Keyboard interaction** events and **clipboard** (copy/paste) events
- **Page visibility** and **viewport** state (tab focus, window size)
- Periodic **DOM snapshots / screenshots of the on-screen learning content** (used
  to replay the session; these capture the learning material on screen, not the
  participant)

*Learning & assessment records:*
- **Quiz responses and scores**
- Knowledge-component **mastery**, spaced-repetition, and **attempt** records
- Any **chatbot / dialogue messages** exchanged with the platform's learning
  assistant (if used in this workshop)

*Explicitly NOT collected in this deployment:*
- **Webcam / video recordings** (disabled)
- **Facial-expression / emotion analysis** and **facial action units** (these
  depend on the webcam feed, which is off)
- No credentials, passwords, or payment information are collected.

We would be grateful for your guidance on the preferred hosting option and any
information-security or data-governance steps we should complete before the
workshop. We are also happy to arrange a short meeting to walk through the
architecture, the data flow, and the safeguards above.

Thank you very much for your support.

Best regards,

[Your name]
[Title / Role]
[School / Centre], Singapore Management University
[Email] · [Phone]
