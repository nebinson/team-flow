import React from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

function App() {
  return (
    <main className="welcome">
      <div className="brand-mark" aria-hidden="true">T</div>
      <p className="eyebrow">INTERNAL COMMUNICATION</p>
      <h1>TeamFlow</h1>
      <p className="intro">Your team’s conversations, all in one place.</p>
      <div className="status"><span /> Development workspace is ready</div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
