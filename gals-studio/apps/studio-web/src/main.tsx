import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './index.css';
import { App } from './App';
import { Library } from './pages/Library';
import { Replay } from './pages/Replay';
import { Coding } from './pages/Coding';
import { Analysis } from './pages/Analysis';
import { Codebook } from './pages/Codebook';

const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <Library /> },
      { path: 'replay/:sessionId', element: <Replay /> },
      { path: 'coding/:sessionId', element: <Coding /> },
      { path: 'codebook', element: <Codebook /> },
      { path: 'analysis', element: <Analysis /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
