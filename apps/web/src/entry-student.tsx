// Public student door entry (student.html -> dist-student/index.html).
// Everything reachable from here ships to the public hostname; the
// dependency-cruiser boundary rule seeds from this file.
import { mount } from './app/bootstrap';
import { StudentApp } from './app/StudentApp';

mount(StudentApp);
