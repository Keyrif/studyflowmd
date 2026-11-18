'use strict';

// Drag-to-trash for the small floating widgets at the top of the page (the mini timer and
// the followed-tasks widget). Drag one away and a trash can appears; drop it in to hide it.

const MINI_TIMER_KEY = 'studyflow.miniTimerDismissed';

function readFlag(key) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key, on) {
  try {
    if (on) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch {}
}

const miniTimerDismissed = () => readFlag(MINI_TIMER_KEY);
const setMiniTimerDismissed = (dismissed) => writeFlag(MINI_TIMER_KEY, dismissed);

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

function trashHit(drag, x, y) {
  const can = drag.trash.querySelector('svg').getBoundingClientRect();
  const pad = 55;
  return x > can.left - pad && x < can.right + pad && y > can.top - pad && y < can.bottom + pad;
}

function swallowNextClick() {
  const swallow = (event) => {
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener('click', swallow, true);
  setTimeout(() => window.removeEventListener('click', swallow, true), 60);
}

/**
 * Let `element` be dragged into a trash can.
 *   title / hint  text shown under the trash can while dragging
 *   onTrash()     hide the widget and remember that choice
 *   done          toast shown after it has been thrown away
 */
function makeTrashable(element, { title, hint, onTrash, done }) {
  let drag = null;

  function begin() {
    const rect = element.getBoundingClientRect();
    const ghost = element.cloneNode(true);
    ghost.removeAttribute('id');
    ghost.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
    ghost.querySelectorAll('.follow-list').forEach((node) => node.remove());
    ghost.classList.add('timer-ghost');
    Object.assign(ghost.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    const overlay = document.createElement('div');
    overlay.className = 'timer-trash-overlay';
    overlay.innerHTML = `<div class="timer-trash">${TRASH_SVG}<p></p><small></small></div>`;
    overlay.querySelector('p').textContent = title;
    overlay.querySelector('small').textContent = hint;
    document.body.append(overlay, ghost);
    document.body.classList.add('timer-dragging');
    element.style.visibility = 'hidden';
    requestAnimationFrame(() => overlay.classList.add('visible'));
    Object.assign(drag, { active: true, ghost, overlay, rect, trash: overlay.querySelector('.timer-trash') });
  }

  function throwAway(current) {
    const can = current.trash.querySelector('svg').getBoundingClientRect();
    const dx = can.left + can.width / 2 - (current.rect.left + current.rect.width / 2);
    const dy = can.top + can.height * 0.28 - (current.rect.top + current.rect.height / 2);
    current.ghost.style.transition = 'transform .45s cubic-bezier(.5,0,.75,0), opacity .45s ease-in';
    current.ghost.style.transform = `translate(${dx}px, ${dy}px) scale(.12) rotate(28deg)`;
    current.ghost.style.opacity = '0';
    onTrash();
    element.hidden = true;
    element.style.visibility = '';
    setTimeout(() => {
      current.trash.classList.remove('hot');
      current.trash.classList.add('gulp');
    }, 430);
    setTimeout(() => {
      current.ghost.remove();
      current.overlay.classList.remove('visible');
    }, 950);
    setTimeout(() => {
      current.overlay.remove();
      if (typeof toast === 'function') toast(done);
    }, 1250);
  }

  function returnHome(current) {
    current.ghost.style.transition = 'transform .45s cubic-bezier(.34,1.56,.64,1)';
    current.ghost.style.transform = 'translate(0, 0) scale(1) rotate(0)';
    current.overlay.classList.remove('visible');
    setTimeout(() => {
      current.ghost.remove();
      current.overlay.remove();
      element.style.visibility = '';
    }, 460);
  }

  element.addEventListener('pointerdown', (event) => {
    // Don't start a drag from inside the open dropdown list.
    if (event.button !== 0 || !event.isPrimary || drag || event.target.closest('.follow-list')) return;
    drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, active: false };
  });

  window.addEventListener(
    'pointermove',
    (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.active) {
        if (Math.hypot(dx, dy) < 6) return;
        begin();
      }
      event.preventDefault();
      const tilt = Math.max(-8, Math.min(8, dx / 40));
      drag.ghost.style.transform = `translate(${dx}px, ${dy}px) scale(1.06) rotate(${tilt}deg)`;
      drag.trash.classList.toggle('hot', trashHit(drag, event.clientX, event.clientY));
    },
    { passive: false },
  );

  function end(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const current = drag;
    drag = null;
    if (!current.active) return;
    document.body.classList.remove('timer-dragging');
    swallowNextClick();
    if (event.type === 'pointerup' && trashHit(current, event.clientX, event.clientY)) throwAway(current);
    else returnHome(current);
  }

  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}

makeTrashable(document.getElementById('mini-focus'), {
  title: 'Drop the timer here to hide it',
  hint: 'Start it again from Overview to bring it back',
  onTrash: () => setMiniTimerDismissed(true),
  done: 'Timer hidden. Start it from Overview to bring it back.',
});
