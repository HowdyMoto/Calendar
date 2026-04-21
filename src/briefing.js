// ── Morning & Evening Briefings ─────────────────────────

import { events } from './state.js';
import { todayString, escapeHtml, hexToRgb } from './utils.js';
import { getEventColor } from './colors.js';
import { spawnThumbsUp } from './animations.js';
import { fetchTomorrowEvents } from './api.js';

const MORNING_ACK_KEY = 'briefing_ack_date';
const EVENING_ACK_KEY = 'evening_briefing_ack_date';
const EVENING_HOUR = 18; // 6 PM

let briefingShowing = false;

export function checkMorningBriefing() {
  if (briefingShowing) return;
  if (localStorage.getItem(MORNING_ACK_KEY) === todayString()) return;

  const now = new Date();
  const futureEvents = events.filter(e => e.start.dateTime && new Date(e.start.dateTime) > now);
  if (futureEvents.length === 0) return;

  renderBriefing({
    events: futureEvents,
    kicker: '',
    ackKey: MORNING_ACK_KEY,
    subtitle: buildTodaySubtitle(futureEvents),
    todClass: todClassForHour(new Date().getHours()),
    dateLine: formatDateLine(new Date()),
    mode: 'morning',
  });
}

function formatDateLine(d) {
  return {
    weekday: d.toLocaleDateString('en-US', { weekday: 'long' }),
    monthDay: `${d.toLocaleDateString('en-US', { month: 'long' })} ${d.getDate()}`,
  };
}

export async function checkEveningBriefing() {
  if (briefingShowing) return;
  if (new Date().getHours() < EVENING_HOUR) return;
  if (localStorage.getItem(EVENING_ACK_KEY) === todayString()) return;
  await showEveningBriefing();
}

export async function showEveningBriefing() {
  if (briefingShowing) {
    console.log('[evening] already showing — skipped');
    return;
  }
  briefingShowing = true;
  try {
    const tomorrowEvents = (await fetchTomorrowEvents()).filter(e => e.start.dateTime);
    console.log('[evening] tomorrow has', tomorrowEvents.length, 'timed events');
    if (tomorrowEvents.length === 0) {
      localStorage.setItem(EVENING_ACK_KEY, todayString());
      briefingShowing = false;
      return;
    }
    const firstHour = new Date(tomorrowEvents[0].start.dateTime).getHours();
    renderBriefing({
      events: tomorrowEvents,
      kicker: 'Tomorrow',
      ackKey: EVENING_ACK_KEY,
      subtitle: buildTomorrowSubtitle(tomorrowEvents),
      todClass: todClassForHour(firstHour),
      dateLine: formatDateLine(new Date(tomorrowEvents[0].start.dateTime)),
      mode: 'evening',
    });
  } catch (err) {
    console.warn('Failed to show evening briefing:', err);
    briefingShowing = false;
  }
}

function buildTodaySubtitle(futureEvents) {
  const fmt = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (futureEvents.length === 0) return '';

  const now = new Date();
  const firstStart = new Date(futureEvents[0].start.dateTime);
  const lastEnd = futureEvents
    .map(e => new Date(e.end.dateTime))
    .reduce((a, b) => a > b ? a : b);
  const minsUntilFirst = (firstStart - now) / 60000;

  return minsUntilFirst > 120
    ? `Clear until ${fmt(firstStart)}`
    : `Busy until ${fmt(lastEnd)}`;
}

function buildTomorrowSubtitle(tomorrowEvents) {
  const fmt = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (tomorrowEvents.length === 0) return '';
  const firstStart = new Date(tomorrowEvents[0].start.dateTime);
  return `First at ${fmt(firstStart)}`;
}

function todClassForHour(h) {
  if (h < 5) return 'tod-night';
  if (h < 9) return 'tod-dawn';
  if (h < 15) return 'tod-midday';
  if (h < 18) return 'tod-golden';
  if (h < 22) return 'tod-dusk';
  return 'tod-night';
}

function renderBriefing({ events: evts, kicker, ackKey, subtitle, todClass, dateLine, mode }) {
  briefingShowing = true;

  const overlay = document.getElementById('briefing-overlay');
  const cardsContainer = document.getElementById('briefing-cards');
  const dismissBtn = document.getElementById('briefing-dismiss');
  const kickerEl = document.getElementById('briefing-kicker');
  const dateEl = document.getElementById('briefing-date');
  const subtitleEl = document.getElementById('briefing-subtitle');

  const fmt = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  overlay.classList.remove(
    'tod-dawn', 'tod-midday', 'tod-golden', 'tod-dusk', 'tod-night',
    'mode-morning', 'mode-evening'
  );
  overlay.classList.add(todClass);
  if (mode) overlay.classList.add(`mode-${mode}`);

  kickerEl.textContent = kicker || '';
  if (dateLine) {
    dateEl.innerHTML = `<span class="dt-weekday">${escapeHtml(dateLine.weekday)}</span><span class="dt-day">${escapeHtml(dateLine.monthDay)}</span>`;
  } else {
    dateEl.textContent = '';
  }
  subtitleEl.textContent = subtitle || '';

  cardsContainer.innerHTML = evts.map(event => {
    const start = new Date(event.start.dateTime);
    const end = new Date(event.end.dateTime);

    const rgb = hexToRgb(getEventColor(event));
    const r = rgb ? rgb.r : 74;
    const g = rgb ? rgb.g : 158;
    const b = rgb ? rgb.b : 255;

    return `
      <div class="briefing-card" style="background: rgba(${r},${g},${b},0.35);">
        <div class="bc-time">${fmt(start)} – ${fmt(end)}</div>
        <div class="bc-title">${escapeHtml(event.summary || '(No title)')}</div>
      </div>
    `;
  }).join('');

  overlay.classList.remove('hidden');

  const cards = cardsContainer.querySelectorAll('.briefing-card');
  cards.forEach((card, i) => {
    setTimeout(() => card.classList.add('cascade-in'), i * 300);
  });

  const totalDelay = cards.length * 300 + 600;
  setTimeout(() => {
    dismissBtn.classList.remove('hidden');
    dismissBtn.classList.add('visible');
  }, totalDelay);

  const dismiss = () => {
    localStorage.setItem(ackKey, todayString());
    overlay.classList.add('dismissing');
    overlay.addEventListener('animationend', () => {
      overlay.classList.add('hidden');
      overlay.classList.remove('dismissing');
      dismissBtn.classList.add('hidden');
      dismissBtn.classList.remove('visible');
      briefingShowing = false;
    }, { once: true });
  };

  dismissBtn.addEventListener('click', (e) => {
    spawnThumbsUp(e.clientX, e.clientY);
    dismiss();
  }, { once: true });

  const list = document.getElementById('events-list');
  const scrollDismiss = () => {
    if (!overlay.classList.contains('hidden')) {
      dismiss();
      list.removeEventListener('scroll', scrollDismiss);
    }
  };
  list.addEventListener('scroll', scrollDismiss, { passive: true });
}
