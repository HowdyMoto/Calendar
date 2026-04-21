// ── Timers & scheduling ─────────────────────────────────

import { DEMO_MODE } from './config.js';
import {
  updateTimer, refreshTimer, firedMilestones, dismissedEvents, previousStates,
  setUpdateTimer, setRefreshTimer,
} from './state.js';
import { renderEvents } from './render.js';
import { fetchEvents, fetchTasks } from './api.js';
import { checkEveningBriefing } from './briefing.js';
import { loadDemoEvents } from './demo.js';

export function startTimers() {
  if (updateTimer) clearInterval(updateTimer);
  setUpdateTimer(setInterval(renderEvents, 10000));

  if (refreshTimer) clearInterval(refreshTimer);
  setRefreshTimer(setInterval(
    DEMO_MODE ? loadDemoEvents : () => { fetchEvents(); fetchTasks(); checkEveningBriefing(); },
    60 * 1000
  ));

  scheduleMidnightRefresh();
}

function scheduleMidnightRefresh() {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const msUntilMidnight = midnight - now;
  setTimeout(() => {
    firedMilestones.clear();
    dismissedEvents.clear();
    previousStates.clear();
    fetchEvents();
    scheduleMidnightRefresh();
  }, msUntilMidnight + 1000);
}
