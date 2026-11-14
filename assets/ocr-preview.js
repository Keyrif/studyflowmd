'use strict';

const OCR_MAX_BYTES = 10 * 1024 * 1024;
const OCR_COLUMNS = 6;
const OCR_ROWS = 8;
let importMode = 'text';
let ocrUrls = [];
let ocrImageIndex = 0;

const currentImportMode = () => importMode;

function setImportMode(mode) {
  importMode = mode === 'image' ? 'image' : 'text';
  const image = importMode === 'image';
  document.getElementById('import-text-tab').classList.toggle('active', !image);
  document.getElementById('import-image-tab').classList.toggle('active', image);
  document.getElementById('import-text-tab').setAttribute('aria-selected', String(!image));
  document.getElementById('import-image-tab').setAttribute('aria-selected', String(image));
  document.getElementById('import-text-pane').hidden = image;
  document.getElementById('import-image-pane').hidden = !image;
  document.getElementById('import-file').required = !image;
  document.getElementById('import-images').required = image;
  document.getElementById('import-submit').textContent = image ? 'Process images' : 'Import files';
  document.getElementById('import-error').textContent = '';
}

function stopOcrPreview() {
  document.getElementById('ocr-loading').hidden = true;
  document.getElementById('import-panes').hidden = false;
  document.getElementById('import-submit').disabled = false;
  document.getElementById('ocr-tiles').replaceChildren();
  ocrUrls.forEach((url) => URL.revokeObjectURL(url));
  ocrUrls = [];
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    setTimeout(reject, 3000);
    image.src = url;
  });
}

async function paintTiles(url) {
  const stage = document.getElementById('ocr-tiles');
  const width = stage.clientWidth || 240;
  const height = stage.clientHeight || 320;
  let size = `${width}px ${height}px`;
  let offsetX = 0;
  let offsetY = 0;
  try {
    const image = await loadImage(url);
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const drawnWidth = image.naturalWidth * scale;
    const drawnHeight = image.naturalHeight * scale;
    size = `${drawnWidth}px ${drawnHeight}px`;
    offsetX = (drawnWidth - width) / 2;
    offsetY = (drawnHeight - height) / 2;
  } catch {}

  const tileWidth = width / OCR_COLUMNS;
  const tileHeight = height / OCR_ROWS;
  const tiles = [];
  for (let row = 0; row < OCR_ROWS; row += 1) {
    for (let column = 0; column < OCR_COLUMNS; column += 1) {
      const tile = document.createElement('div');
      const dx = (column + 0.5) / OCR_COLUMNS - 0.5;
      const dy = (row + 0.5) / OCR_ROWS - 0.5;
      const roll = Math.random();
      tile.className = `ocr-tile${roll < 0.2 ? ' blue' : roll < 0.55 ? ' orange' : ''}`;
      Object.assign(tile.style, {
        left: `${column * tileWidth}px`,
        top: `${row * tileHeight}px`,
        width: `${tileWidth}px`,
        height: `${tileHeight}px`,
        backgroundImage: `url("${url}")`,
        backgroundSize: size,
        backgroundPosition: `${-(column * tileWidth + offsetX)}px ${-(row * tileHeight + offsetY)}px`,
      });
      tile.style.setProperty('--dx', (dx * 2).toFixed(3));
      tile.style.setProperty('--dy', (dy * 2).toFixed(3));
      tile.style.setProperty('--delay', `${Math.round(Math.hypot(dx, dy) * 260)}ms`);
      tiles.push(tile);
    }
  }
  stage.replaceChildren(...tiles);
}

function startOcrPreview() {
  const files = [...document.getElementById('import-images').files];
  const error = document.getElementById('import-error');
  if (!files.length) return;
  if (files.some((file) => !file.type.startsWith('image/') || file.size > OCR_MAX_BYTES)) {
    error.textContent = 'Use image files under 10 MB each.';
    return;
  }
  error.textContent = '';
  ocrUrls = files.map((file) => URL.createObjectURL(file));
  ocrImageIndex = 0;
  document.getElementById('import-panes').hidden = true;
  document.getElementById('ocr-loading').hidden = false;
  document.getElementById('import-submit').disabled = true;
  document.getElementById('ocr-count').textContent = files.length > 1 ? `1 / ${files.length}` : '';
  paintTiles(ocrUrls[0]);
}

document.getElementById('ocr-scan').addEventListener('animationiteration', () => {
  if (ocrUrls.length < 2) return;
  ocrImageIndex = (ocrImageIndex + 1) % ocrUrls.length;
  document.getElementById('ocr-count').textContent = `${ocrImageIndex + 1} / ${ocrUrls.length}`;
  paintTiles(ocrUrls[ocrImageIndex]);
});

document.getElementById('import-text-tab').addEventListener('click', () => setImportMode('text'));
document.getElementById('import-image-tab').addEventListener('click', () => setImportMode('image'));
document.getElementById('import-form').addEventListener('reset', () => {
  stopOcrPreview();
  setImportMode('text');
});
document.getElementById('import-dialog').addEventListener('close', stopOcrPreview);

setImportMode('text');
