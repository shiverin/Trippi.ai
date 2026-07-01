import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
// Self-hosted Poppins (bundled, same-origin) so the app font can't be blocked by
// ad/tracker blockers the way the Google Fonts CDN can.
import '@fontsource/poppins/300.css';
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/500.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
// Geist Sans (self-hosted too) — used only for secondary "subtext" via --font-subtext.
import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-sans/600.css';
import './index.css';
import { startConnectivityProbe } from './sync/connectivity';
import { requestPersistentStorage } from './sync/persistentStorage';

startConnectivityProbe();
// Keep offline data (map tiles, file blobs, IndexedDB) exempt from eviction.
requestPersistentStorage();

registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    registration.update().catch(() => {});
    window.setInterval(
      () => {
        registration.update().catch(() => {});
      },
      60 * 60 * 1000
    );
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
