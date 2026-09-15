/**
 * Two-door split: which door this bundle was built for.
 *
 * Injected at build time by Vite `define` (see vite.config.shared.ts):
 *   'student' — public door, student + auth routes only
 *   'admin'   — private door, every route (teacher + student + auth)
 *
 * Plain `vite` dev and the legacy `build` are the admin (full) app, so
 * the day-to-day dev workflow is unchanged.
 *
 * Route strings and nav items are NOT keyed off this constant — they come
 * from the NavConfig each entry point injects (src/nav/NavConfigContext.tsx),
 * so the student bundle never contains teacher paths even as dead code.
 * DOOR is only for small behavioural toggles (e.g. whether to show the
 * registration link).
 */
export type Door = 'student' | 'admin';

export const DOOR: Door = __GALS_DOOR__;

export const WRONG_DOOR_PATH = '/wrong-door';
