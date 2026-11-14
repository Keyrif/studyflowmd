'use strict';

function thanosSnap(elements) {
  const targets = [elements]
    .flat()
    .filter((element) => element?.isConnected && element.getClientRects().length);
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!targets.length || reduced || typeof Element.prototype.animate !== 'function') {
    return Promise.resolve();
  }
  return Promise.all(targets.map(disintegrate));
}

function disintegrate(element) {
  const rect = element.getBoundingClientRect();
  if (!rect.width || !rect.height) return Promise.resolve();
  const context = getComputedStyle(element.parentElement || element);
  const layer = document.createElement('div');
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    pointerEvents: 'none',
    zIndex: '9999',
    color: context.color,
    fontFamily: context.fontFamily,
    fontSize: context.fontSize,
    lineHeight: context.lineHeight,
  });

  const size = Math.max(8, Math.sqrt((rect.width * rect.height) / 110));
  const columns = Math.ceil(rect.width / size);
  const rows = Math.ceil(rect.height / size);
  const animations = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const piece = element.cloneNode(true);
      piece.removeAttribute('id');
      piece.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
      const top = row * size;
      const left = column * size;
      Object.assign(piece.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        margin: '0',
        boxSizing: 'border-box',
        visibility: 'visible',
        backdropFilter: 'none',
        transition: 'none',
        clipPath: `inset(${top}px ${Math.max(0, rect.width - left - size)}px ${Math.max(0, rect.height - top - size)}px ${left}px)`,
      });
      layer.append(piece);

      const delay = (column / columns) * 500 + (row / rows) * 120 + Math.random() * 220;
      const dx = 30 + Math.random() * 90;
      const dy = -(15 + Math.random() * 70);
      const spin = (Math.random() - 0.5) * 80;
      animations.push(
        piece.animate(
          [
            { transform: 'translate(0, 0) rotate(0) scale(1)', opacity: 1 },
            { transform: `translate(${dx * 0.3}px, ${dy * 0.3}px) rotate(${spin * 0.3}deg) scale(0.95)`, opacity: 0.9, offset: 0.3 },
            { transform: `translate(${dx}px, ${dy}px) rotate(${spin}deg) scale(0.6)`, opacity: 0 },
          ],
          { duration: 950, delay, easing: 'cubic-bezier(0.45, 0, 0.55, 1)', fill: 'both' },
        ).finished,
      );
    }
  }

  document.body.append(layer);
  element.style.visibility = 'hidden';
  return Promise.all(animations)
    .catch(() => {})
    .then(() => layer.remove());
}
