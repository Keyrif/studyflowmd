'use strict';

document.addEventListener('pointerdown', (event) => {
  const icon = event.target
    .closest('nav a, #sidebar-import, .theme-switch')
    ?.querySelector('[data-icon]');
  if (!icon) return;
  icon.classList.remove('icon-pressed');
  void icon.offsetWidth;
  icon.classList.add('icon-pressed');
});

document.addEventListener('animationend', (event) => {
  if (event.animationName === 'icon-press') event.target.classList.remove('icon-pressed');
});
