import React from 'react';
import ReactDOM from 'react-dom/client';
import { EditorTestHarness } from './EditorTestHarness';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <EditorTestHarness />
  </React.StrictMode>,
);
