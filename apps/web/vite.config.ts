import { createDoorConfig } from './vite.config.shared';

// Default config: plain `vite` dev and the legacy `pnpm build` are the
// full (admin) app in ./dist, so the day-to-day workflow is unchanged.
// The two-door images use vite.config.admin.ts / vite.config.student.ts.
export default createDoorConfig('admin', { outDir: 'dist' });
