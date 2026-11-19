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
  if (event.animationName === 'brand-flash') event.target.classList.remove('brand-flash');
});

// Clicking the logo sends a short burst of glow (the hover glow stays while the mouse is on it).
document.querySelector('.brand')?.addEventListener('pointerdown', (event) => {
  const brand = event.currentTarget;
  brand.classList.remove('brand-flash');
  void brand.offsetWidth; // restart the animation if clicked again quickly
  brand.classList.add('brand-flash');
});
