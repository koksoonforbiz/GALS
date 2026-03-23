# ATS Biometrics & Recording — Implementation Prompts

This folder contains four implementation prompts for adding multimodal biometric tracking and webcam recording to the Adaptive Tutoring System (ATS).

---

## Files

| File | Feature | Key Tech |
|------|---------|----------|
| `prompt_01_pupil_size_estimation.md` | SET Pupil Size Estimation | Client-side canvas processing, NestJS, PostgreSQL, MinIO CSV export |
| `prompt_02_webgazer_calibration.md` | WebGazer Eye Tracking + Calibration | WebGazer.js, 9-point calibration modal, inactivity re-calibration, gaze heatmap |
| `prompt_03_pyfeat_au_extraction.md` | py-feat Action Unit Extraction | Python microservice, Redis queue, Docker, AU timeline viewer |
| `prompt_04_webcam_session_recording.md` | Webcam Session Recording | MediaRecorder API, presigned MinIO uploads, timestamp synchronisation |

---

## Recommended Implementation Order

```
Feature 04 → Feature 01 → Feature 02 → Feature 03
```

**Reason**: Feature 04 (recording) establishes the `BiometricsSyncContext` and `wallClockOffset` that Features 01 and 02 depend on for timestamp alignment. Feature 03 (py-feat) depends on Feature 04's video files as its input source.

---

## Shared Infrastructure

All four features share:

- **`BiometricsSyncContext`** — provides `sessionId`, `courseId`, `wallClockOffset` to all hooks
- **Biometrics tab** in `CourseBuilderPage` — teacher settings for all four features live here
- **Biometrics tab** in `StudentLogPage` — teacher log viewers for all four features live here
- **ActivityLog action types** — each feature contributes new action types to the shared enum
- **MinIO bucket structure**:
  ```
  pupil-size/{studentId}/{sessionId}/
  webgazer/{studentId}/{sessionId}/
  pyfeat/{studentId}/{sessionId}/
  recordings/{courseId}/{studentId}/{sessionId}/
  ```
- **Privacy banner** — a single shared `BiometricsActiveBanner` component shows which features are active

---

## Cross-Feature Data Model Diagram

```
StudentSession
  ├── PupilSizeLog[]          (Feature 01)
  ├── WebgazerLog[]           (Feature 02)
  ├── WebgazerCalibrationEvent[] (Feature 02)
  ├── RecordingSegment[]      (Feature 04)
  │     └── PyfeatJob         (Feature 03, triggered on segment upload)
  │           └── PyfeatAuResult[]
  └── ActivityLog[]           (existing — all features emit events here)
```

---

## Timestamp Synchronisation Reference

All biometric timestamps derive from a single `wallClockOffset` computed at session start:

```typescript
const wallClockOffset = Date.now() - performance.now();
const toWallTime = (perfNow: number) => new Date(perfNow + wallClockOffset).toISOString();
```

This offset is stored in:
- `RecordingSegment.startWallTime` (absolute wall time)
- `ActivityLog` metadata on `RECORDING_STARTED`
- Passed as a prop to `usePupilSize` and `useWebgazer`

This ensures all four data streams can be precisely aligned in time during downstream analysis.
