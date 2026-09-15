import { createDoorConfig } from './vite.config.shared';

// Public student door → dist-student (student + auth routes only).
// student.html imports src/entry-student.tsx; the output is renamed to
// index.html so nginx serves both doors the same way.
export default createDoorConfig('student', { outDir: 'dist-student', input: 'student.html' });
