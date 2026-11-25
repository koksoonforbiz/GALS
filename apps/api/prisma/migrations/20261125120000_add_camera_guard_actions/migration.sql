-- Camera guard: the student's recorded webcam stopped giving a picture
-- (turned off, unplugged, covered, too dark) and when it came back.
-- Additive only.

ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'CAMERA_BLOCKED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'CAMERA_RESTORED';
