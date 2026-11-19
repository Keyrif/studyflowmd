'use strict';

// Phones: Deadlines, Notifications and Subjects live in a dropdown behind the hamburger
// button on the right of the header (desktop shows them as normal buttons; see topbar-menu.css).

const topbar = document.querySelector('.topbar');
const topbarMenuButton = document.getElementById('topbar-menu');
const topbarActions = document.getElementById('topbar-actions');

function setTopbarMenu(open) {
  topbar.classList.toggle('menu-open', open);
  topbarMenuButton.setAttribute('aria-expanded', String(open));
  topbarMenuButton.innerHTML = icon(open ? 'x' : 'menu');
}

topbarMenuButton?.addEventListener('click', () => setTopbarMenu(!topbar.classList.contains('menu-open')));

document.addEventListener('click', (event) => {
  // composedPath, not contains(): the hamburger swaps its icon on click, so the tapped
  // <svg> is no longer inside the button by the time this runs.
  if (!topbar.classList.contains('menu-open') || event.composedPath().includes(topbarMenuButton)) return;
  // A tap on one of the menu's buttons does its usual job (its popup opens on its own),
  // and the menu folds away; so does a tap anywhere else.
  const item = event.target.closest('#topbar-actions > .button, #topbar-actions > div > .button');
  if (item || !topbarActions.contains(event.target)) setTopbarMenu(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && topbar.classList.contains('menu-open')) {
    setTopbarMenu(false);
    topbarMenuButton.focus();
  }
});

// Back to desktop width: the buttons are visible again, so the menu state no longer applies.
matchMedia('(max-width: 760px)').addEventListener('change', () => setTopbarMenu(false));
