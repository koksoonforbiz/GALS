import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { pdfjs } from 'react-pdf';
import App from './App';
import './index.css';
import 'katex/dist/katex.min.css';
import './components/editor/editor-styles.css';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found. Ensure index.html has a div with id="root".');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
