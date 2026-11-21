import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {syncDocumentDisplayAttributes} from './platform/tvEnvironment';
import {initPerformanceProfile} from './platform/performanceProfile';

syncDocumentDisplayAttributes();
initPerformanceProfile();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
