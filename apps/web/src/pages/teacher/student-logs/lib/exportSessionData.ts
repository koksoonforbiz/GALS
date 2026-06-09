import JSZip from 'jszip';

export interface ExportProgress {
  stage: 'fetching' | 'downloading' | 'encoding' | 'zipping' | 'done';
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
  The complete session data in JSON format. Each replay snapshot has its
  screenshotDataUrl replaced by a screenshotFile reference pointing to the
  corresponding file in the screen_recording/ folder.

recordings/
  WebM video files — one file per webcam recording segment.
  Files are named recording_0.webm, recording_1.webm, etc.

screen_recording/
  screen_recording.webm
    A timelapse video assembled from the pixel screenshots captured during
    the session. Plays at 5 fps (each frame = one snapshot, ~1-2 real seconds).
  frame_0000.jpg, frame_0001.jpg, ...
    Individual screenshot frames. Use these if you want to process frames
    independently or reconstruct the video at a different speed.

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
  DOM snapshots of the student's screen captured every 1-2 seconds.
  Each snapshot contains the full HTML plus scroll/size metadata.
  screenshotDataUrl is replaced by screenshotFile (path to the JPEG in
  screen_recording/) to keep session_data.json a manageable size.

recordings
  Metadata for each webcam video segment, including filename, duration,
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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function createScreenVideo(
  frames: string[],
  onProgress: (pct: number, detail: string) => void,
): Promise<Blob | null> {
  if (frames.length === 0) return null;

  const firstImg = await loadImage(frames[0]!);
  const width = firstImg.naturalWidth || 1280;
  const height = firstImg.naturalHeight || 720;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const FPS = 5;
  const stream = canvas.captureStream(FPS);
  const mimeType =
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1_500_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  return new Promise((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
    recorder.start(200);

    (async () => {
      const frameMs = Math.round(1000 / FPS);
      for (let i = 0; i < frames.length; i++) {
        try {
          const img = await loadImage(frames[i]!);
          ctx.drawImage(img, 0, 0, width, height);
        } catch {
          // Skip unloadable frame — canvas keeps the previous frame
        }
        onProgress(
          Math.round(((i + 1) / frames.length) * 100),
          `Encoding frame ${i + 1} of ${frames.length}…`,
        );
        await new Promise((res) => setTimeout(res, frameMs));
      }
      recorder.stop();
    })();
  });
}

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
  report('fetching', 25, 'Session data received');

  // ── Step 2: Extract screenshots from snapshots ────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const snapshots: any[] = sessionData?.replay?.snapshots ?? [];
  const screenshotFrames: { index: number; dataUrl: string; filename: string }[] = [];
  let frameIdx = 0;
  for (const snap of snapshots) {
    if (snap.screenshotDataUrl) {
      const filename = `frame_${String(frameIdx).padStart(4, '0')}.jpg`;
      screenshotFrames.push({
        index: frameIdx,
        dataUrl: snap.screenshotDataUrl as string,
        filename,
      });
      snap.screenshotFile = `screen_recording/${filename}`;
      delete snap.screenshotDataUrl;
      frameIdx++;
    }
  }
  report('fetching', 30, `Extracted ${screenshotFrames.length} screenshot frames`);

  // ── Step 3: Download webcam recording videos ──────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recordings: any[] = sessionData?.recordings ?? [];
  const videoBlobs: { filename: string; blob: Blob }[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const completedRecs = recordings.filter(
    (r: any) => r.uploadStatus === 'COMPLETED' && r.downloadUrl,
  );

  for (let i = 0; i < completedRecs.length; i++) {
    const rec = completedRecs[i];
    const pct = 30 + Math.round(((i + 1) / Math.max(completedRecs.length, 1)) * 20);
    report('downloading', pct, `Downloading webcam recording ${i + 1} of ${completedRecs.length}…`);
    try {
      const vRes = await fetch(rec.downloadUrl as string);
      if (vRes.ok) {
        const blob = await vRes.blob();
        videoBlobs.push({ filename: rec.filename as string, blob });
      }
    } catch (err) {
      console.error('[Export] webcam fetch error:', err);
    }
  }

  // ── Step 4: Encode screen recording video ─────────────────────────────────
  let screenVideoBlob: Blob | null = null;
  if (screenshotFrames.length > 0) {
    report(
      'encoding',
      52,
      `Encoding screen recording (${screenshotFrames.length} frames at 5 fps)…`,
    );
    screenVideoBlob = await createScreenVideo(
      screenshotFrames.map((f) => f.dataUrl),
      (pct, detail) => {
        report('encoding', 52 + Math.round(pct * 0.3), detail);
      },
    );
  }

  // ── Step 5: Build ZIP ─────────────────────────────────────────────────────
  report('zipping', 84, 'Building ZIP archive…');
  const zip = new JSZip();

  const rawName: string = sessionData?._meta?.studentName ?? 'unknown';
  const rawCourse: string =
    sessionData?._meta?.courseName ?? sessionData?.session?.courseId ?? 'unknown_course';
  const startedAt: string = sessionData?._meta?.sessionStartedAt ?? new Date().toISOString();
  const dt = new Date(startedAt);
  const datePart = dt.toISOString().slice(0, 10);
  const timePart = dt.toISOString().slice(11, 19).replace(/:/g, '-');
  const safeName = (s: string) =>
    s
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  const folderName = `${safeName(rawName)}_${safeName(rawCourse)}_${datePart}_${timePart}`;

  const folder = zip.folder(folderName)!;

  folder.file('README.txt', README);
  folder.file('session_data.json', JSON.stringify(sessionData, null, 2));

  // Webcam recordings
  if (videoBlobs.length > 0) {
    const recFolder = folder.folder('recordings')!;
    for (const { filename, blob } of videoBlobs) {
      recFolder.file(filename, blob);
    }
  }

  // Screen recording video + individual frames
  if (screenshotFrames.length > 0) {
    const screenFolder = folder.folder('screen_recording')!;
    if (screenVideoBlob) {
      screenFolder.file('screen_recording.webm', screenVideoBlob);
    }
    for (const { dataUrl, filename } of screenshotFrames) {
      // Strip the data URL prefix to get raw base64
      const base64 = (dataUrl as string).replace(/^data:[^;]+;base64,/, '');
      screenFolder.file(filename, base64, { base64: true });
    }
  }

  report('zipping', 94, 'Compressing…');
  const zipBlob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 1 },
  });

  // ── Step 6: Trigger download ──────────────────────────────────────────────
  report('done', 100, 'Done');
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${folderName}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
