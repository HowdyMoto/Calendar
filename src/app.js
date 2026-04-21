// ── Entry point ─────────────────────────────────────────
// Wires up all modules and bootstraps the app.

import { DEMO_MODE } from './config.js';
import { setLastStructureKey, setLastGutterKey } from './state.js';
import { showScreen, calendarScreen, requestWakeLock } from './ui.js';
import { gapiLoaded, gisLoaded, handleAuth, handleLogout } from './auth.js';
import { showEveningBriefing, checkMorningBriefing } from './briefing.js';
import { renderEvents } from './render.js';
import { startTimers } from './timers.js';
import { loadDemoEvents, loadDemoTasks } from './demo.js';
import { toggleSettings, setShowTasks, setScale } from './settings.js';

// Side-effect imports (register event listeners on load)
import './ui.js';
import './settings.js';

// ── Bootstrap ───────────────────────────────────────────
if (DEMO_MODE) {
  showScreen(calendarScreen);
  loadDemoEvents();
  loadDemoTasks();
  requestAnimationFrame(() => {
    setLastStructureKey('');
    setLastGutterKey('');
    renderEvents();
    startTimers();
    checkMorningBriefing();
  });
} else {
  (function loadGoogleAPIs() {
    const gapiScript = document.createElement('script');
    gapiScript.src = 'https://apis.google.com/js/api.js';
    gapiScript.onload = gapiLoaded;
    document.head.appendChild(gapiScript);

    const gisScript = document.createElement('script');
    gisScript.src = 'https://accounts.google.com/gsi/client';
    gisScript.onload = gisLoaded;
    document.head.appendChild(gisScript);
  })();
}

requestWakeLock();

// Expose globals for inline onclick/onchange/oninput handlers
window.handleAuth = handleAuth;
window.handleLogout = handleLogout;
window.toggleSettings = toggleSettings;
window.setShowTasks = setShowTasks;
window.setScale = setScale;

// Debug/preview hooks — call from DevTools to force-show either briefing
// regardless of current time or ack state.
window.previewMorningBriefing = () => {
  localStorage.removeItem('briefing_ack_date');
  checkMorningBriefing();
};
window.previewEveningBriefing = () => {
  localStorage.removeItem('evening_briefing_ack_date');
  return showEveningBriefing();
};
