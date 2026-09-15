/// <reference types="vite/client" />

// Two-door split — injected by Vite `define` per build target
// (vite.config.shared.ts). See src/door.ts.
declare const __GALS_DOOR__: 'student' | 'admin';
