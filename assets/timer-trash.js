'use strict';

const MINI_TIMER_KEY = 'studyflow.miniTimerDismissed';

function miniTimerDismissed() {
  try {
    return localStorage.getItem(MINI_TIMER_KEY) === '1';
  } catch {
    return false;
  }
}

function setMiniTimerDismissed(dismissed) {
  try {
    if (dismissed) localStorage.setItem(MINI_TIMER_KEY, '1');
    else localStorage.removeItem(MINI_TIMER_KEY);
  } catch {}
}

const onOverview = () => ['', 'dashboard'].includes(location.hash.slice(1));

document.getElementById('focus-toggle').addEventListener('click', () => {
  if (onOverview()) setMiniTimerDismissed(false);
});
document.getElementById('duration-form').addEventListener('submit', () => {
  if (onOverview()) setMiniTimerDismissed(false);
});

const TRASH_SVG = `<svg viewBox="0 0 120 140" aria-hidden="true">
  <g class="trash-lid">
    <path d="M48 22v-7a3 3 0 0 1 3-3h18a3 3 0 0 1 3 3v7"/>
    <rect x="16" y="22" width="88" height="11" rx="5"/>
  </g>
  <path class="trash-body" d="M25 41h70l-7 86a9 9 0 0 1-9 8H41a9 9 0 0 1-9-8Z"/>
  <path d="M47 60v56M60 60v56M73 60v56"/>
</svg>`;

const miniTimer = document.getElementById('mini-focus');
let timerDrag = null;

function trashHit(drag, x, y) {
  const can = drag.trash.querySelector('svg').getBoundingClientRect();
  const pad = 55;
  return x > can.left - pad && x < can.right + pad && y > can.top - pad && y < can.bottom + pad;
}

function beginTimerDrag(drag) {
  const rect = miniTimer.getBoundingClientRect();
  const ghost = miniTimer.cloneNode(true);
  ghost.removeAttribute('id');
  ghost.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  ghost.classList.add('timer-ghost');
  Object.assign(ghost.style, {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  });

  const overlay = document.createElement('div');
  overlay.className = 'timer-trash-overlay';
  overlay.innerHTML = `<div class="timer-trash">${TRASH_SVG}<p>Drop the timer here to hide it</p><small>Start it again from Overview to bring it back</small></div>`;

  document.body.append(overlay, ghost);
  document.body.classList.add('timer-dragging');
  miniTimer.style.visibility = 'hidden';
  requestAnimationFrame(() => overlay.classList.add('visible'));
  Object.assign(drag, { active: true, ghost, overlay, rect, trash: overlay.querySelector('.timer-trash') });
}

function swallowNextClick() {
  const swallow = (event) => {
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener('click', swallow, true);
  setTimeout(() => window.removeEventListener('click', swallow, true), 60);
}

function throwTimerAway(drag) {
  const can = drag.trash.querySelector('svg').getBoundingClientRect();
  const dx = can.left + can.width / 2 - (drag.rect.left + drag.rect.width / 2);
  const dy = can.top + can.height * 0.28 - (drag.rect.top + drag.rect.height / 2);
  drag.ghost.style.transition = 'transform .45s cubic-bezier(.5,0,.75,0), opacity .45s ease-in';
  drag.ghost.style.transform = `translate(${dx}px, ${dy}px) scale(.12) rotate(28deg)`;
  drag.ghost.style.opacity = '0';
  setMiniTimerDismissed(true);
  miniTimer.hidden = true;
  miniTimer.style.visibility = '';
  setTimeout(() => {
    drag.trash.classList.remove('hot');
    drag.trash.classList.add('gulp');
  }, 430);
  setTimeout(() => {
    drag.ghost.remove();
    drag.overlay.classList.remove('visible');
  }, 950);
  setTimeout(() => {
    drag.overlay.remove();
    if (typeof toast === 'function') toast('Timer hidden. Start it from Overview to bring it back.');
  }, 1250);
}

function returnTimerHome(drag) {
  drag.ghost.style.transition = 'transform .45s cubic-bezier(.34,1.56,.64,1)';
  drag.ghost.style.transform = 'translate(0, 0) scale(1) rotate(0)';
  drag.overlay.classList.remove('visible');
  setTimeout(() => {
    drag.ghost.remove();
    drag.overlay.remove();
    miniTimer.style.visibility = '';
  }, 460);
}

miniTimer.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !event.isPrimary || timerDrag) return;
  timerDrag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, active: false };
});

window.addEventListener(
  'pointermove',
  (event) => {
    if (!timerDrag || event.pointerId !== timerDrag.id) return;
    const dx = event.clientX - timerDrag.startX;
    const dy = event.clientY - timerDrag.startY;
    if (!timerDrag.active) {
      if (Math.hypot(dx, dy) < 6) return;
      beginTimerDrag(timerDrag);
    }
    event.preventDefault();
    const tilt = Math.max(-8, Math.min(8, dx / 40));
    timerDrag.ghost.style.transform = `translate(${dx}px, ${dy}px) scale(1.06) rotate(${tilt}deg)`;
    timerDrag.trash.classList.toggle('hot', trashHit(timerDrag, event.clientX, event.clientY));
  },
  { passive: false },
);

function endTimerDrag(event) {
  if (!timerDrag || event.pointerId !== timerDrag.id) return;
  const drag = timerDrag;
  timerDrag = null;
  if (!drag.active) return;
  document.body.classList.remove('timer-dragging');
  swallowNextClick();
  if (event.type === 'pointerup' && trashHit(drag, event.clientX, event.clientY)) throwTimerAway(drag);
  else returnTimerHome(drag);
}

window.addEventListener('pointerup', endTimerDrag);
window.addEventListener('pointercancel', endTimerDrag);
