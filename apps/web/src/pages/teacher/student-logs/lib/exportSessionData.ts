import JSZip from 'jszip';

export interface ExportProgress {
  stage: 'fetching' | 'downloading' | 'zipping' | 'done';
  /** 0–100 */
  percent: number;
  detail: string;
}

const README = `GALS Session Export — README
============================

This folder contains all data recorded during one student learning session
on the GALS (Guided Adaptive Learning System) platform.

FOLDER CONTENTS
---------------

session_data.json
  The complete session data in JSON format. See sections below.

recordings/
  WebM video files — one file per recording segment (webcam + screen capture).
  Files are named recording_0.webm, recording_1.webm, etc.
  Open with any modern video player (VLC, Chrome, etc.).

SESSION DATA JSON — SECTIONS
-----------------------------

_meta
  Export metadata: timestamp, schema version, student name, course name.

session
  Session identifiers, start/end time, duration, course, browser info.

student
  Student id, name, email.

summary
  AI-generated session summary (if available).

biometrics.emotionFrames
  Facial emotion probabilities captured at ~5 FPS via webcam.
  Fields: frameWallMs (Unix ms), faceDetected, pHappiness, pSadness,
  pSurprise, pFear, pAnger, pDisgust, pContempt, pNeutral,
  dominantEmotion, dominantProbability, headPoseYaw/Pitch/Roll.

biometrics.actionUnits
  Facial Action Unit (AU) intensities from py-feat, aligned to video frames.
  Fields: frameIndex, wallTime (ISO), au01–au28, faceConf.
  AUs represent muscle movements (e.g. AU12 = lip corner pull = smile).

biometrics.gaze
  Eye-gaze coordinates from WebGazer (browser-based eye tracking).
  Fields: timestamp (ISO), gazeX, gazeY (viewport pixels), confidence, pageUrl.

biometrics.pupil
  Pupil diameter measurements.
  Fields: timestamp (ISO), pupilDiameter (pixels).

interactions.clicks
  Mouse click events with position and target element.
  Fields: timestamp, x, y (viewport pixels), pageUrl, elementSelector, elementText.

interactions.scrolls
  Page scroll events.
  Fields: timestamp, scrollY (pixels from top), scrollPercent (0–100), pageUrl.

interactions.keystrokes
  Aggregated typing events (not raw keystrokes — privacy-safe).
  Fields: timestamp, fieldId, keystrokeCount, pauseDurationMs, typingSpeedWPM.

interactions.cursor
  Cursor movement samples.
  Fields: timestamp, x, y (viewport pixels), pageUrl, elementTarget.

interactions.clipboard
  Copy/paste/cut events.
  Fields: timestamp, action (copy|cut|paste), textLength, pageUrl.

interactions.visibility
  Tab focus/blur events (student switched tabs or minimised window).
  Fields: timestamp, visibleState (visible|hidden), hiddenDurationMs, pageUrl.

interactions.viewport
  Browser window resize events.
  Fields: timestamp, width, height (pixels), orientation.

communications.chatbotMessages
  All messages exchanged with the floating Learning Assistant chatbot.
  Fields: createdAt, role (USER|ASSISTANT), content, contextSource,
  selectedText, suggestedStrategy, promptTokens, completionTokens, model.

communications.dialogueHistory
  Messages from the Dialogue sidebar (student RAG chat).
  Fields: role, text, timestamp, dialogueSessionId.

learning.interventionEvents
  Activity events triggered by learning strategies (Practice Testing,
  Distributed Practice, Stepwise Learning, Interrogative Elaboration).
  Fields: action, timestamp, interventionId, metadata.

learning.assessmentEvents
  Quiz and assessment activity events.
  Fields: action, timestamp, assessmentId, attemptId, questionId, metadata.

learning.masteryTrajectory
  Knowledge component mastery updates over time.
  Fields: timestamp, kcId, plus mastery-specific fields from metadata.

learning.efDetections
  Executive Function (EF) constructs detected via text mining of chat messages.
  Fields: createdAt, constructKey, label, confidence, severity, rationale.

fullEventLog
  Raw list of every activity event in the session, in chronological order.
  Useful for building custom timelines or filtering specific event types.

replay.snapshots
  DOM snapshots of the student's screen captured every 1–2 seconds.
  Each snapshot contains the full HTML at that moment plus scroll/size metadata.
  Useful for session replay — render the HTML in an iframe to reconstruct
  exactly what the student was looking at.

recordings
  Metadata for each video recording segment, including filename, duration,
  start/end times, and a presigned download URL (valid for 1 hour from export).

TIMESTAMP ALIGNMENT
-------------------
All timestamps are ISO 8601 strings (UTC) unless noted.
biometrics.emotionFrames uses frameWallMs (Unix milliseconds) for
sub-millisecond alignment with video frames.
Use session.startedAt as the timeline anchor: subtract it from any
timestamp to get the offset in milliseconds from session start.

LOADING THE DATA
----------------
Python example:
  import json
  with open("session_data.json") as f:
      data = json.load(f)
  emotions = data["biometrics"]["emotionFrames"]
  print(f"{len(emotions)} emotion frames captured")

JavaScript / Node example:
  const data = JSON.parse(fs.readFileSync("session_data.json", "utf8"));
  const clicks = data.interactions.clicks;

QUESTIONS
---------
Contact the GALS development team for schema questions or data access issues.
`;

export async function exportSessionData(
  sessionId: string,
  onProgress?: (p: ExportProgress) => void,
): Promise<void> {
  const report = (stage: ExportProgress['stage'], percent: number, detail: string) =>
    onProgress?.({ stage, percent, detail });

  // ── Step 1: Fetch JSON from backend ──────────────────────────────────────
  report('fetching', 5, 'Fetching session data…');
  const token = localStorage.getItem('token');
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};

  const res = await fetch(`/api/activity-log/teacher/sessions/${sessionId}/export`, { headers });
  if (!res.ok) throw new Error(`Export fetch failed: ${res.status}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionData: any = await res.json();
  report('fetching', 30, 'Session data received');

  // ── Step 2: Download recording videos ────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recordings: any[] = sessionData?.recordings ?? [];
  const videoBlobs: { filename: string; blob: Blob }[] = [];
  const completedRecs = recordings.filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (r: any) => r.uploadStatus === 'COMPLETED' && r.downloadUrl,
  );

  for (let i = 0; i < completedRecs.length; i++) {
    const rec = completedRecs[i];
    const pct = 30 + Math.round(((i + 1) / Math.max(completedRecs.length, 1)) * 50);
    report('downloading', pct, `Downloading recording ${i + 1} of ${completedRecs.length}…`);
    try {
      const vRes = await fetch(rec.downloadUrl as string);
      if (vRes.ok) {
        const blob = await vRes.blob();
        videoBlobs.push({ filename: rec.filename as string, blob });
      }
    } catch {
      // Non-fatal — skip unavailable segment
    }
  }

  // ── Step 3: Build ZIP ─────────────────────────────────────────────────────
  report('zipping', 82, 'Building ZIP archive…');
  const zip = new JSZip();

  // Derive folder name: studentName_courseName_date_time
  const rawName: string = sessionData?._meta?.studentName ?? 'unknown';
  const rawCourse: string =
    sessionData?._meta?.courseName ?? sessionData?.session?.courseId ?? 'unknown_course';
  const startedAt: string = sessionData?._meta?.sessionStartedAt ?? new Date().toISOString();
  const dt = new Date(startedAt);
  const datePart = dt.toISOString().slice(0, 10); // YYYY-MM-DD
  const timePart = dt.toISOString().slice(11, 19).replace(/:/g, '-'); // HH-MM-SS
  const safeName = (s: string) =>
    s
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  const folderName = `${safeName(rawName)}_${safeName(rawCourse)}_${datePart}_${timePart}`;

  const folder = zip.folder(folderName)!;

  // README
  folder.file('README.txt', README);

  // Session JSON
  folder.file('session_data.json', JSON.stringify(sessionData, null, 2));

  // Videos
  if (videoBlobs.length > 0) {
    const recFolder = folder.folder('recordings')!;
    for (const { filename, blob } of videoBlobs) {
      recFolder.file(filename, blob);
    }
  }

  report('zipping', 92, 'Compressing…');
  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 1 },
  });

  // ── Step 4: Trigger download ──────────────────────────────────────────────
  report('done', 100, 'Done');
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${folderName}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
