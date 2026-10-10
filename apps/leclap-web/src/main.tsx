import 'reflect-metadata';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import './index.css';
import i18n, { i18nReady } from '@/i18n';
import App from '@/App';
import { isBot } from '@/lib/isBot';
import { watchSystemTheme } from '@/lib/theme';
import { watchPageScrollbar } from '@/lib/page-scrollbar';
import { cameraDebugRequested, installCameraDebug } from '@/lib/camera-debug';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

// Default theme is the OS color scheme: follow it live until the user picks one via the toggle.
watchSystemTheme();

// A modal hides the page scrollbar without moving the page behind it (index.css reads this width).
watchPageScrollbar();

// `?debugCamera=1` times the camera's record start on the visitor's own hardware (see camera-debug.ts).
if (cameraDebugRequested(window.location.search)) installCameraDebug();

// The active language's bundle is a lazy chunk (see i18n/index.ts), and it has to be in memory
// before the first paint: rendering early would show English and then swap once the chunk lands.
await i18nReady;

createRoot(rootElement).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <App />
    </I18nextProvider>
  </StrictMode>
);

// Offline/PWA support. Registered in production only (so it never caches the dev server or
// fights HMR) and never for crawlers/automation.
if (import.meta.env.PROD && 'serviceWorker' in navigator && !isBot()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
