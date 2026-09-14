import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { pdfjs } from 'react-pdf';
import '../index.css';
import 'katex/dist/katex.min.css';
import '../components/editor/editor-styles.css';

// Moved from main.tsx: global setup shared by both entry points.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export function mount(App: ComponentType) {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error('Root element not found. Ensure the HTML entry has a div with id="root".');
  }

  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
