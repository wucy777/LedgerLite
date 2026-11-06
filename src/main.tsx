import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './frontend/App';
import { ErrorBoundary } from './frontend/components/ErrorBoundary';
import { bootstrapHighRefresh } from './frontend/features/settings/display-mode';
import './frontend/styles/base.css';
import './frontend/styles/shell.css';
import './frontend/styles/toast.css';
import './frontend/styles/components.css';
import './frontend/styles/auth.css';
import './frontend/styles/skeleton.css';
import './frontend/styles/back-gesture.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

bootstrapHighRefresh();

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
