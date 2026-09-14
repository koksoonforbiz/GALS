// Private teacher/admin door entry (index.html -> dist / dist-admin).
// Also what plain `vite` dev serves.
import { mount } from './app/bootstrap';
import { AdminApp } from './app/AdminApp';

mount(AdminApp);
