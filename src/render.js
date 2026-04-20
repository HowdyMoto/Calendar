// ── Time grid rendering ─────────────────────────────────

import {
  events, photoCache, PX_PER_MIN, MIN_CARD_HEIGHT,
  dayStartHour, dayEndHour, lastStructureKey, lastGutterKey,
  firedMilestones, dismissedEvents, previousStates, ONE_SHOT_ANIM_CLASSES,
  setPxPerMin, setDayStartHour, setDayEndHour,
  setLastStructureKey, setLastGutterKey,
} from './state.js';
import { minsOf, eventKey, escapeHtml, formatCountdown, checkMilestone, getInitials } from './utils.js';
import { getEventColor, urgencyBgAlpha, urgencyTextColor, blendWithBg } from './colors.js';
import { hexToRgb } from './utils.js';
import { dismissEvent } from './animations.js';
import { pickAvatarPerson } from './api.js';

function computeDayRange(timedEvents) {
  const now = new Date();
  let earliest = now.getHours();
  let latest = now.getHours() + 1;

  timedEvents.forEach(e => {
    const s = new Date(e.start.dateTime);
    const end = new Date(e.end.dateTime);
    earliest = Math.min(earliest, s.getHours());
    latest = Math.max(latest, end.getHours() + (end.getMinutes() > 0 ? 1 : 0));
  });

  setDayStartHour(Math.max(0, earliest - 1));
  setDayEndHour(Math.min(24, latest + 1));

  const list = document.getElementById('events-list');
  const availableHeight = list.clientHeight;
  const totalMinutes = (dayEndHour - dayStartHour) * 60;
  setPxPerMin(Math.max(0.5, availableHeight / totalMinutes));
}

function renderHourGutter() {
  const gutter = document.getElementById('hour-gutter');
  const column = document.getElementById('event-column');
  const totalHeight = (dayEndHour - dayStartHour) * 60 * PX_PER_MIN;

  gutter.style.height = `${totalHeight}px`;
  column.style.height = `${totalHeight}px`;

  const gutterKey = `${dayStartHour}-${dayEndHour}-${PX_PER_MIN.toFixed(3)}`;
  if (gutterKey === lastGutterKey) return;
  setLastGutterKey(gutterKey);

  gutter.innerHTML = '';
  column.querySelectorAll('.hour-line').forEach(el => el.remove());

  for (let h = dayStartHour; h <= dayEndHour; h++) {
    const topPx = (h - dayStartHour) * 60 * PX_PER_MIN;

    if (h > dayStartHour && h < dayEndHour) {
      const label = document.createElement('div');
      label.className = 'hour-label';
      label.style.top = `${topPx}px`;
      const displayHour = h % 12 || 12;
      const ampm = h < 12 ? 'AM' : 'PM';
      label.textContent = `${displayHour} ${ampm}`;
      gutter.appendChild(label);
    }

    if (h > dayStartHour && h < dayEndHour) {
      const line = document.createElement('div');
      line.className = 'hour-line';
      line.style.top = `${topPx}px`;
      column.appendChild(line);
    }
  }
}

function timeToY(date) {
  const startOfDay = new Date(date);
  startOfDay.setHours(dayStartHour, 0, 0, 0);
  return minsOf(date, startOfDay) * PX_PER_MIN;
}

function buildOverlapClusters(timedEvents) {
  const clusters = [];
  let cluster = null;

  for (const ev of timedEvents) {
    const start = new Date(ev.start.dateTime).getTime();
    const end = new Date(ev.end.dateTime).getTime();

    // Cluster based on actual time overlap, not visual card height
    if (!cluster || start >= cluster.clusterEnd) {
      if (cluster) clusters.push(cluster);
      cluster = { events: [ev], clusterStart: start, clusterEnd: end };
    } else {
      cluster.events.push(ev);
      cluster.clusterEnd = Math.max(cluster.clusterEnd, end);
    }
  }
  if (cluster) clusters.push(cluster);

  for (const c of clusters) {
    c.isOverlapping = c.events.length > 1;
  }
  return clusters;
}

export function renderEvents() {
  const now = new Date();
  const list = document.getElementById('events-list');
  const column = document.getElementById('event-column');
  const empty = document.getElementById('empty-state');
  const header = document.getElementById('date-header');
  const allDayRow = document.getElementById('all-day-row');

  header.textContent = now.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric'
  });

  if (events.length === 0) {
    list.classList.add('hidden');
    empty.classList.remove('hidden');
    allDayRow.classList.add('hidden');
    return;
  }

  list.classList.remove('hidden');
  empty.classList.add('hidden');

  const timedEvents = events.filter(e => e.start.dateTime);
  computeDayRange(timedEvents);
  renderHourGutter();

  const nowLine = document.getElementById('now-line');
  const nowY = timeToY(now);
  nowLine.style.top = `${Math.round(nowY)}px`;
  nowLine.classList.remove('hidden');

  const fmt = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  // ── All-day events ──
  const allDayEvents = events.filter(e => !e.start.dateTime);
  if (allDayEvents.length) {
    allDayRow.innerHTML = allDayEvents.map(e =>
      `<div class="all-day-chip${e._isTask ? ' task-chip' : ''}">${e._isTask ? '☑ ' : ''}${escapeHtml(e.summary || '(No title)')}</div>`
    ).join('');
    allDayRow.classList.remove('hidden');
  } else {
    allDayRow.classList.add('hidden');
  }

  // ── Timed events ──
  const clusters = buildOverlapClusters(timedEvents);

  let structureKey = '';
  let bounceCount = 0;
  const cardDataList = [];

  clusters.forEach((cluster) => {
    const minCardMs = (MIN_CARD_HEIGHT / PX_PER_MIN) * 60000;

    if (cluster.isOverlapping) {
      const colVisualEnds = [];
      cluster.events.forEach(ev => {
        const evStart = new Date(ev.start.dateTime).getTime();
        const evEnd = new Date(ev.end.dateTime).getTime();
        const visualEnd = Math.max(evEnd, evStart + minCardMs);
        let col = colVisualEnds.findIndex(end => end <= evStart);
        if (col === -1) {
          col = colVisualEnds.length;
          colVisualEnds.push(0);
        }
        colVisualEnds[col] = visualEnd;
        cardDataList.push({ event: ev, column: col, totalColumns: 0, _cluster: cluster });
      });
      const total = colVisualEnds.length;
      cardDataList.forEach(cd => {
        if (cd._cluster === cluster && cd.totalColumns === 0) cd.totalColumns = total;
      });
    } else {
      cardDataList.push({ event: cluster.events[0], column: 0, totalColumns: 1, _cluster: cluster });
    }
  });

  let prevVisualBottom = 0;

  const hasAntsyNext = cardDataList.some(cd => {
    const s = new Date(cd.event.start.dateTime);
    const m = (s - now) / 60000;
    return m > 0 && m <= 3 && !dismissedEvents.has(eventKey(cd.event));
  });

  const cardsHtml = cardDataList.map((cd, idx) => {
    const event = cd.event;
    const start = new Date(event.start.dateTime);
    const end = new Date(event.end.dateTime);
    const key = eventKey(event);
    const minsUntil = (start - now) / 60000;
    const durationMins = minsOf(end, start);

    let state = '';
    let countdown = '';
    let animClass = '';
    let progress = 0;

    if (now >= end) {
      state = 'past';
      if (previousStates.has(key)) animClass = ' meeting-done';
    } else if (now >= start && now < end) {
      state = 'current';
      progress = (now - start) / (end - start);
      const minsLeft = (end - now) / 60000;
      if (!dismissedEvents.has(key)) {
        animClass = ' antsy';
      } else if (minsLeft <= 5) {
        animClass = hasAntsyNext ? ' wrapping-up' : ' wrapping-up-urgent';
        if (!hasAntsyNext) {
          const wrapKey = `wrap5_${key}`;
          if (!firedMilestones.has(wrapKey)) {
            firedMilestones.set(wrapKey, true);
            if (navigator.vibrate) navigator.vibrate([100, 50, 100, 50, 200]);
          }
        }
      }
      countdown = `${Math.ceil(minsLeft)}m left`;
    } else {
      state = 'future';
      countdown = formatCountdown(start - now);
      const milestone = checkMilestone(key, minsUntil);
      if (minsUntil <= 3 && !dismissedEvents.has(key)) {
        animClass = ' antsy';
      } else if (milestone === 3) {
        animClass = ' throb-large';
      } else if (milestone === 15) {
        animClass = ' throb-medium';
      } else if (milestone === 30) {
        animClass = ' throb-small';
      }
    }

    let topPx = timeToY(start);
    const heightPx = Math.max(MIN_CARD_HEIGHT, durationMins * PX_PER_MIN);
    // Push single-column cards down if min-height causes visual overlap
    if (cd.totalColumns <= 1 && prevVisualBottom > topPx + 1) {
      topPx = prevVisualBottom + 2;
    }
    if (cd.totalColumns <= 1) {
      prevVisualBottom = Math.max(prevVisualBottom, topPx + heightPx);
    }
    const isCompact = heightPx <= 56;
    const gap = 4;
    const colWidthPct = (100 / cd.totalColumns).toFixed(2);
    const leftPct = (cd.column * 100 / cd.totalColumns).toFixed(2);
    const overlapClass = cd.totalColumns > 1 ? ' overlap-col' : '';

    let posStyle = `top:${Math.round(topPx)}px;height:${Math.round(heightPx)}px;`;
    if (cd.totalColumns > 1) {
      posStyle += `left:calc(${leftPct}% + ${gap / 2}px + 4px);width:calc(${colWidthPct}% - ${gap}px - 4px);right:auto;`;
    }

    let cardStyle = '';
    let timeColor = '';
    let titleColor = '';

    if (state === 'future' || state === 'current' || state === 'past') {
      const rgb = hexToRgb(getEventColor(event));
      const r = rgb ? rgb.r : 74;
      const g = rgb ? rgb.g : 158;
      const b = rgb ? rgb.b : 255;
      if (state === 'future') {
        const bgA = urgencyBgAlpha(minsUntil);
        const txt = urgencyTextColor(bgA, r, g, b);
        const o = blendWithBg(r, g, b, bgA);
        titleColor = ` style="color: ${txt.title}"`;
        timeColor = ` style="color: ${txt.sub}"`;
        cardStyle = `background: rgb(${o.r},${o.g},${o.b});--card-text:${txt.title};--card-sub:${txt.sub};`;
      } else if (state === 'current') {
        const txt = urgencyTextColor(0.55, r, g, b);
        const o = blendWithBg(r, g, b, 0.55);
        titleColor = ` style="color: ${txt.title}"`;
        timeColor = ` style="color: ${txt.sub}"`;
        cardStyle = `background: rgb(${o.r},${o.g},${o.b});--card-text:${txt.title};--card-sub:${txt.sub};`;
      } else {
        const o = blendWithBg(r, g, b, 0.2);
        cardStyle = `background: rgb(${o.r},${o.g},${o.b});`;
      }
    }

    const progressStyle = state === 'current' ? `--progress: ${(progress * 100).toFixed(1)}%;` : '';
    const bounceDelay = animClass ? `animation-delay: ${(bounceCount++ * 0.4).toFixed(1)}s;` : '';
    const allStyles = posStyle + cardStyle + progressStyle + bounceDelay;
    const dismissAttr = animClass === ' antsy' ? ` data-dismiss="${escapeHtml(key)}"` : '';
    const compactClass = isCompact ? ' compact-card' : '';

    const avatarPerson = pickAvatarPerson(event);
    const avatarName = avatarPerson.displayName || avatarPerson.email || '';
    const avatarInitials = getInitials(avatarName);

    const startTimeStr = fmt(start);
    const fullTimeStr = `${fmt(start)} – ${fmt(end)}`;

    const details = [];
    details.push(`<div class="detail-row"><span class="detail-icon">🕐</span> ${fullTimeStr}</div>`);
    if (countdown && state === 'current') {
      details.push(`<div class="detail-row"><span class="detail-icon">⏳</span> ${escapeHtml(countdown)}</div>`);
    }
    if (event.location) {
      details.push(`<div class="detail-row"><span class="detail-icon">📍</span> ${escapeHtml(event.location)}</div>`);
    }
    const organizer = event.organizer || {};
    const organizerName = organizer.displayName || organizer.email || '';
    if (organizerName) {
      details.push(`<div class="detail-row"><span class="detail-icon">👤</span> Organized by ${escapeHtml(organizerName)}</div>`);
    }
    const attendeeCount = (event.attendees || []).filter(a => !a.self && !a.resource).length;
    if (attendeeCount > 0) {
      details.push(`<div class="detail-row"><span class="detail-icon">👥</span> ${attendeeCount} other${attendeeCount > 1 ? 's' : ''}</div>`);
    }
    if (event.description) {
      const desc = event.description.replace(/<[^>]+>/g, '').trim();
      if (desc) {
        const short = desc.length > 120 ? desc.slice(0, 120) + '…' : desc;
        details.push(`<div class="detail-row detail-desc">${escapeHtml(short)}</div>`);
      }
    }

    if (state === 'current') previousStates.add(key); else previousStates.delete(key);
    structureKey += `${idx}:${state}${animClass}|`;

    return `
      <div id="ev-${idx}" class="event-card ${state}${animClass}${compactClass}${overlapClass}" style="${allStyles}"${dismissAttr} data-expandable>
        <div class="card-summary">
          ${avatarName ? `<div class="organizer-avatar">
            ${photoCache[avatarPerson.email]
              ? `<img class="avatar-img" src="${photoCache[avatarPerson.email]}" referrerpolicy="no-referrer" alt="" onerror="this.remove()">`
              : `<span class="avatar-initials">${escapeHtml(avatarInitials)}</span>`}
          </div>` : ''}
          <div class="card-main">
            <div class="event-title"${titleColor}>${escapeHtml(event.summary || '(No title)')}</div>
            <div class="event-time"${timeColor}>${startTimeStr}${countdown ? ` · ${countdown}` : ''}</div>
          </div>
        </div>
        <div class="card-details">${details.join('')}</div>
      </div>
    `;
  }).join('');

  if (structureKey !== lastStructureKey) {
    column.querySelectorAll('.event-card').forEach(el => el.remove());
    column.insertAdjacentHTML('beforeend', cardsHtml);
    setLastStructureKey(structureKey);

    column.querySelectorAll('[data-dismiss]').forEach(el => {
      el.addEventListener('click', (e) => {
        if (el.classList.contains('antsy')) {
          e.stopImmediatePropagation();
          dismissEvent(el.dataset.dismiss, e);
        }
      });
    });

    const animSelector = ONE_SHOT_ANIM_CLASSES.map(c => '.' + c).join(', ');
    column.querySelectorAll(animSelector).forEach(el => {
      el.addEventListener('animationend', () => {
        el.classList.remove(...ONE_SHOT_ANIM_CLASSES);
      }, { once: true });
    });

    column.querySelectorAll('[data-expandable]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        el.classList.toggle('expanded');
      });
    });
  } else {
    column.querySelectorAll('.event-card').forEach(card => {
      const idx = card.id?.replace('ev-', '');
      const timeEl = card.querySelector('.event-time');
      if (timeEl) {
        const match = cardsHtml.match(new RegExp(`id="ev-${idx}"[\\s\\S]*?class="event-time"[^>]*>([^<]+)<`));
        if (match) timeEl.textContent = match[1];
      }
      if (card.classList.contains('current')) {
        const match = cardsHtml.match(new RegExp(`id="ev-${idx}"[^>]*--progress:\\s*([\\d.]+)%`));
        if (match) card.style.setProperty('--progress', match[1] + '%');
      }
    });

    nowLine.style.top = `${Math.round(nowY)}px`;
  }
}
