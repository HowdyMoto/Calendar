// ── Screens, scroll tracking, pull-to-refresh ───────────

import { DEMO_MODE } from './config.js';
import { events, setLastStructureKey, setLastGutterKey } from './state.js';
import { renderEvents } from './render.js';
import { fetchEvents } from './api.js';
import { checkMorningBriefing } from './briefing.js';
import { loadDemoEvents } from './demo.js';

export const authScreen = document.getElementById('auth-screen');
export const calendarScreen = document.getElementById('calendar-screen');
export const loadingScreen = document.getElementById('loading-screen');
const reauthBanner = document.getElementById('reauth-banner');

export function showScreen(screen) {
  [authScreen, calendarScreen, loadingScreen].forEach(s => s.classList.add('hidden'));
  screen.classList.remove('hidden');
}

export function showReauthBanner() {
  reauthBanner?.classList.remove('hidden');
}

export function hideReauthBanner() {
  reauthBanner?.classList.add('hidden');
}

export function setLoaderStatus(text) {
  const el = document.getElementById('loader-status');
  if (el) el.textContent = text;
}

// Occasionally make "Nudge" dance on the auth screen
const nudgeWord = document.getElementById('nudge-word');
setInterval(() => {
  if (authScreen.classList.contains('hidden')) return;
  nudgeWord.classList.add('antsy');
  setTimeout(() => nudgeWord.classList.remove('antsy'), 3200);
}, 12000);

// Scroll tracking — let user browse freely, rubber-band back after 30s
let userScrolledRecently = false;
let scrollTimeout = null;
const SCROLL_RETURN_DELAY = 30000;

document.addEventListener('DOMContentLoaded', () => {
  const list = document.getElementById('events-list');
  if (list) {
    list.addEventListener('scroll', () => {
      userScrolledRecently = true;
      if (scrollTimeout) clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        userScrolledRecently = false;
      }, SCROLL_RETURN_DELAY);
    }, { passive: true });
  }

  // ── Pull-to-refresh ──
  const indicator = document.getElementById('pull-indicator');
  let pullStartY = 0;
  let pulling = false;
  const PULL_THRESHOLD = 80;

  list.addEventListener('touchstart', (e) => {
    if (list.scrollTop <= 0) {
      pullStartY = e.touches[0].clientY;
      pulling = true;
    }
  }, { passive: true });

  list.addEventListener('touchmove', (e) => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - pullStartY;
    if (dy > 0 && list.scrollTop <= 0) {
      const progress = Math.min(dy / PULL_THRESHOLD, 1);
      indicator.style.transform = `translateY(${Math.min(dy * 0.5, 50)}px)`;
      indicator.style.opacity = progress;
      indicator.classList.toggle('ready', progress >= 1);
    } else {
      indicator.style.transform = '';
      indicator.style.opacity = 0;
    }
  }, { passive: true });

  list.addEventListener('touchend', () => {
    if (!pulling) return;
    pulling = false;
    const wasReady = indicator.classList.contains('ready');
    indicator.style.transform = '';
    indicator.style.opacity = 0;
    indicator.classList.remove('ready');
    if (wasReady) {
      indicator.classList.add('refreshing');
      indicator.style.opacity = 1;
      indicator.style.transform = 'translateY(40px)';
      // Dynamic import to avoid circular dep with demo.js
      const refresh = DEMO_MODE ? loadDemoEvents : fetchEvents;
      Promise.resolve(refresh()).finally(() => {
        indicator.classList.remove('refreshing');
        indicator.style.transform = '';
        indicator.style.opacity = 0;
      });
    }
  }, { passive: true });
});

// ── Wake Lock (keep screen on) ──────────────────────────
export async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      await navigator.wakeLock.request('screen');
    }
  } catch (e) {
    // Wake lock not available or denied
  }
}

// Dismiss expanded cards when tapping outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.event-card')) {
    document.querySelectorAll('.event-card.expanded').forEach(el => el.classList.remove('expanded'));
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    requestWakeLock();
    if (typeof gapi !== 'undefined' && gapi.client?.getToken()) {
      fetchEvents().then(() => checkMorningBriefing());
    } else if (!DEMO_MODE && typeof gapi !== 'undefined') {
      // Token gone (expired + failed reauth) — try to restore from storage or re-prompt
      const stored = localStorage.getItem('gapi_token');
      if (stored) {
        gapi.client.setToken(JSON.parse(stored));
        fetchEvents().then(() => checkMorningBriefing());
      }
    } else if (DEMO_MODE) {
      checkMorningBriefing();
    }
  }
});

// ── Resize → recalculate scale ──────────────────────────
window.addEventListener('resize', () => {
  setLastStructureKey('');
  setLastGutterKey('');
  if (events.length) renderEvents();
});

// ── Service Worker ──────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'SW_UPDATED') {
      showUpdateOverlay();
    }
  });
}

function showUpdateOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'update-overlay';
  overlay.innerHTML = `
    <div class="update-icon">✨</div>
    <div class="update-text">Updating...</div>
  `;
  document.body.appendChild(overlay);
  setTimeout(() => window.location.reload(), 1800);
}
