/**
 * Creates a function that converts a performance.now() timestamp
 * to an ISO-8601 wall clock string using the given offset.
 *
 * All biometric streams (pupil size, gaze, AUs, recording) must use
 * the same wallClockOffset so data can be precisely aligned.
 */
export const toWallTime =
  (wallClockOffset: number) =>
  (perfNow: number): string =>
    new Date(perfNow + wallClockOffset).toISOString();
