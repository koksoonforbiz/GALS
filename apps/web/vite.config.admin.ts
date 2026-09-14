import { createDoorConfig } from './vite.config.shared';

// Private teacher/admin door → dist-admin (every route).
export default createDoorConfig('admin', { outDir: 'dist-admin' });
