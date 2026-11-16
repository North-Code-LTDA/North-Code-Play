import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { syncNativeRuntimeAttributes } from './platform/nativeRuntime';

syncNativeRuntimeAttributes();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
