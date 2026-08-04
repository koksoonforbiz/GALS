# Draft email to IITS — GALS deployment for an SMU Academy workshop

**To:** IITS (SMU Integrated Information Technology Services) — [IITS contact / helpdesk]
**Cc:** [SCIS IT / lab contact], [SMU Academy programme lead], [Project supervisor]
**From:** [Your name], [School / Centre], Singapore Management University
**Subject:** Request to deploy the GALS learning platform on the SCIS L40 server for a selected SMU Academy workshop — architecture, data scope, and risk assessment

---

Dear [IITS contact],

I am writing on behalf of our research team to request IITS's support in hosting the
**GALS (Gaze-Aware Learning System)** platform for **research purposes**. We intend
to have a **selected SMU Academy (SMUA) workshop adopt GALS** so that we can study how
participants revise and consolidate their learning. We have designed this deployment
to be **deliberately low-risk** — minimal data collection, no video recording, and no
external dependencies — and we plan to host it on the **SCIS L40 server**. This email
lays out exactly what GALS does, what it collects, where the data goes, and the
residual risks and how we mitigate them, so that IITS can assess it quickly.

---

## 1. What we plan to do in the workshop

We intend to have a **selected SMUA workshop adopt GALS for research purposes**.
Towards the end of the workshop, participants will use GALS for roughly
**[15–20] minutes** to **revise the content covered during the day** and complete a
**short quiz** to consolidate their learning. Participation is
**[voluntary / part of the session]**, and each participant will be shown a
**consent notice** before any data is collected. GALS is a browser-based web
application — participants simply open a URL, work through the revision material, and
finish the quiz. No software is installed on participant or SMU devices.

---

## 2. System architecture and data flow (so risk can be assessed)

- **Client side (participant's browser):** renders the revision content and quiz.
  Eye-gaze tracking runs here via **WebGazer**, a client-side JavaScript library.
  The webcam is used *only in-browser* to estimate where the participant is looking;
  **the raw camera image is processed locally and never leaves the device.** Only the
  resulting numeric **gaze coordinates** are transmitted.
- **Server side (hosted at SMU):** a single application server (web + API) with a
  local database that stores the learning content, quiz logic, and the collected
  data streams. This is the component we are asking IITS to help host.
- **Network:** all traffic served over **HTTPS/TLS**. Access limited to the workshop
  cohort for the workshop period.
- **No third-party / external calls:** GALS does not send data to any external
  analytics, advertising, or cloud AI service. All collected data stays within the
  SMU-hosted instance.

---

## 3. Data we will collect (full inventory)

*Biometric — the only biometric signal collected:*
- **Eye-gaze estimates** — on-screen gaze coordinates (x, y) with a confidence value,
  computed client-side by WebGazer.

*Learning-interaction / behavioural telemetry:*
- Learning **activity logs** (module/page navigation, time-on-task)
- **Mouse** clicks, cursor movement, and scroll events
- **Keyboard interaction** timing and **clipboard** (copy/paste) events
- **Page visibility** and **viewport** state (tab focus, window size)
- Periodic **DOM snapshots / screenshots of the on-screen learning content** — used to
  replay the session for research; these capture the **learning material on screen,
  not the participant**

*Learning & assessment records:*
- **Quiz responses and scores**
- Knowledge-component **mastery**, spaced-repetition, and **attempt** records
- Any **chatbot / dialogue messages** exchanged with the platform's learning
  assistant (if used in this workshop)

*Explicitly NOT collected in this deployment:*
- **Webcam / video recordings** — the recording feature is **turned OFF**; no video
  of participants is recorded, stored, or transmitted
- **Facial-expression / emotion analysis** and **facial action units** — these depend
  on the webcam feed, which is off, so they are not produced
- **No credentials, passwords, or payment information**; **no NRIC / financial data**
- Participants are identified only by a **workshop-scoped pseudonymous ID**, not by
  name where avoidable

---

## 4. Risk assessment

| Risk area | Exposure | Mitigation |
|---|---|---|
| **Camera / video privacy** | Perceived recording of participants | Webcam **never recorded or transmitted**; WebGazer processes the image **on-device only**; only gaze coordinates leave the browser. Clear consent notice shown up front. |
| **Sensitivity of collected data** | Behavioural + gaze data | No video, no emotion inference, no NRIC/credentials. Data is pseudonymous and limited to the workshop. |
| **Data at rest / in transit** | Interception or unauthorised access | HTTPS/TLS in transit; database on the SMU-hosted instance with access restricted to the research team. Data can be **encrypted at rest** if IITS requires. |
| **External data leakage** | Third-party services | **None** — no external analytics/AI/cloud calls; all data stays on the SMU instance. |
| **Access control** | Unauthorised entry | Instance reachable only by the workshop cohort during the workshop window; can be **firewalled to SMU network / VPN** and taken offline afterwards. |
| **Data retention** | Long-term holding | Data retained only for **[study duration]**, then **[anonymised / deleted]** per SMU data-governance and PDPA requirements. |
| **Consent / PDPA** | Compliance | Explicit participant consent obtained; collection aligns with **PDPA** and **[IRB / ethics approval ref, if applicable]**. |
| **Availability during workshop** | Service downtime disrupts session | Single lightweight instance; we will **load-test for the cohort size** and have a fallback plan so a GALS outage does not block the workshop. |

---

## 5. Hosting — SCIS L40 server

For now, we intend to host GALS **on-premise on the SCIS L40 server**, so that all
data stays entirely within SMU infrastructure and behind the SMU network. Keeping the
deployment on-premise means no data leaves SMU and there is no external hosting review
to complete.

- **Data location:** stays within SMU infrastructure
- **Access control:** behind the SMU network / firewall, reachable only by the
  workshop cohort during the workshop window
- **Teardown:** we will take the instance offline immediately after the workshop /
  study period

We will comply with any hardening, network segmentation, access-control, encryption,
port, or logging requirements IITS specifies for hosting on the L40 server.

---

## 6. What we are asking of IITS

1. Your **approval / support to host GALS on the SCIS L40 server** for this workshop;
   and
2. Any **security / data-governance steps** we should complete beforehand (reviews,
   approvals, configuration standards).

We are happy to arrange a short meeting or complete any assessment form to walk
through the architecture and safeguards above. Our aim is to make this as easy as
possible to approve, and we will adapt the deployment to meet your requirements.

Thank you very much for your support — we look forward to your guidance.

Best regards,

[Your name]
[Title / Role]
[School / Centre], Singapore Management University
[Email] · [Phone]
