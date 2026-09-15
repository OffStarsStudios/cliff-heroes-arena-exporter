import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthGate } from './components/AuthGate';
import './styles.css';
import './liveops.css';
import './auth.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found.');

createRoot(container).render(
  <StrictMode>
    <AuthGate>
      <App />
    </AuthGate>
  </StrictMode>,
);
