'use strict';

const OCR_MAX_BYTES = 10 * 1024 * 1024;
const OCR_MAX_FILES = 10;
const OCR_SCAN_MS = 3600; // one full scan-and-split cycle of the animation (see ocr-preview.css)
let ocrStartedAt = 0;
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
  document.getElementById('import-submit').hidden = false;
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

// Returns false (and shows why) if the chosen photos can't be sent.
function startOcrPreview() {
  const files = [...document.getElementById('import-images').files];
  const error = document.getElementById('import-error');
  if (!files.length) return false;
  if (files.length > OCR_MAX_FILES) {
    error.textContent = 'Choose up to 10 photos at a time.';
    return false;
  }
  if (files.some((file) => !file.type.startsWith('image/') || file.size > OCR_MAX_BYTES)) {
    error.textContent = 'Use image files under 10 MB each.';
    return false;
  }
  error.textContent = '';
  ocrUrls = files.map((file) => URL.createObjectURL(file));
  ocrImageIndex = 0;
  document.getElementById('import-panes').hidden = true;
  document.getElementById('ocr-loading').hidden = false;
  // The button did its job; the scan screen shows only the animation.
  document.getElementById('import-submit').hidden = true;
  document.getElementById('ocr-count').textContent = files.length > 1 ? `1 / ${files.length}` : '';
  paintTiles(ocrUrls[0]);
  ocrStartedAt = performance.now();
  return true;
}

// Upload the photos. The server only stores them and queues a background job, so it answers
// within moments; the dialog closes and the user can keep working while a worker reads them.
async function runOcrImport(subjectId) {
  if (!startOcrPreview()) return;
  const form = new FormData();
  [...document.getElementById('import-images').files].forEach((file) => form.append('images', file));
  if (subjectId) form.append('subject', subjectId);
  let job;
  try {
    job = await api('/api/notes/ocr/', { method: 'POST', form });
  } catch (error) {
    stopOcrPreview();
    document.getElementById('import-error').textContent = error.message;
    return;
  }
  // The upload itself takes a moment; let the scanning animation play its full cycle first.
  const animated = typeof motionEnabled !== 'function' || motionEnabled();
  const left = OCR_SCAN_MS - (performance.now() - ocrStartedAt);
  if (animated && left > 0) await new Promise((resolve) => setTimeout(resolve, left));
  trackUpload(job);
  closeDialog(document.getElementById('import-dialog'));
  watchOcrJob(job);
}

/* ---------- "Uploading file" placeholders ----------
   While a worker reads the photos, each photo gets a placeholder (a card on the Overview, a
   row in the file lists) where its note will appear, with its own progress bar. When the
   note is ready, the real note takes the placeholder's place. */

const uploads = new Map(); // job id -> { subject, photos: [{ key, name, state, since, shown }] }

function trackUpload(job) {
  const subject = state.subjects.find((s) => s.id === String(job.subject))?.name || '';
  uploads.set(job.id, {
    subject,
    photos: job.photos.map((photo, index) => ({ key: `${job.id}-${index}`, name: photo.name, state: photo.state })),
  });
  updateUpload(job);
}

function updateUpload(job) {
  const upload = uploads.get(job.id);
  if (!upload) return;
  job.photos.forEach((photo, index) => {
    const placeholder = upload.photos[index];
    if (photo.state === 'queued' && !placeholder.since) placeholder.since = performance.now();
    placeholder.state = photo.state;
    placeholder.note = photo.note;
  });
  renderNotes();
}

// Shown progress: a small start while waiting in line, then easing towards 90% while being
// read (we can't see inside Tesseract, so this part is an estimate), 100% once it's done.
function uploadProgress(photo) {
  if (photo.state === 'done' || photo.state === 'failed') return 100;
  if (photo.state !== 'queued') return 6;
  const seconds = (performance.now() - photo.since) / 1000;
  return Math.round(12 + 78 * (1 - Math.exp(-seconds / 2.5)));
}

// The placeholders a list should show; `subject` limits them to one subject's files.
function uploadPlaceholders(subject) {
  return [...uploads.values()]
    .filter((upload) => subject === undefined || upload.subject === subject)
    .flatMap((upload) => upload.photos.filter((photo) => !photo.shown).map((photo) => ({ ...photo, subject: upload.subject })));
}

const uploadTitle = (name) => name.replace(/\.[^.]+$/, '') || 'Scanned note';
const uploadLabel = (photo) => (photo.state === 'failed' ? 'Couldn’t read this photo' : 'Uploading file');
const uploadBar = (photo) =>
  `<span class="upload-bar ${photo.state === 'failed' ? 'failed' : ''}"><span style="width:${uploadProgress(photo)}%"></span></span>`;

function uploadCard(photo) {
  return `<div class="col-md-4"><div class="glass upload-card ${photo.state === 'failed' ? 'failed' : ''}" data-upload-key="${escapeHTML(photo.key)}"><div class="note-top"><span class="note-icon">${icon('upload')}</span><span class="file-type">.md</span></div><h3 translate="no">${escapeHTML(uploadTitle(photo.name))}</h3><p class="upload-label">${uploadLabel(photo)}</p>${uploadBar(photo)}</div></div>`;
}

function uploadRow(photo, showSubject) {
  return `<tr class="upload-row ${photo.state === 'failed' ? 'failed' : ''}" data-upload-key="${escapeHTML(photo.key)}"><td><div class="file-name upload-name">${icon('upload')}<span translate="no">${escapeHTML(uploadTitle(photo.name))}.md</span></div></td>${showSubject ? `<td>${escapeHTML(photo.subject || 'Unfiled')}</td>` : ''}<td colspan="3"><div class="upload-status"><span class="upload-label">${uploadLabel(photo)}</span>${uploadBar(photo)}</div></td></tr>`;
}

// Move the bars smoothly between server updates, without redrawing the lists.
setInterval(() => {
  uploads.forEach((upload) =>
    upload.photos.forEach((photo) => {
      if (photo.shown) return;
      document.querySelectorAll(`[data-upload-key="${CSS.escape(photo.key)}"] .upload-bar > span`).forEach((bar) => {
        bar.style.width = `${uploadProgress(photo)}%`;
      });
    }),
  );
}, 250);

// Ask the server how the job is going every 1.5 seconds. Each note replaces its placeholder
// as soon as its photo has been read, instead of all of them at the very end.
const OCR_POLL_MS = 1500;
async function watchOcrJob(job) {
  const user = currentUser;
  const upload = uploads.get(job.id);
  for (;;) {
    if (currentUser !== user) return uploads.delete(job.id); // signed out meanwhile
    for (const [index, photo] of job.photos.entries()) {
      const placeholder = upload.photos[index];
      if (photo.state !== 'done' || !photo.note || placeholder.shown) continue;
      try {
        showNewNote(rememberNote(noteFromApi(await api(`/api/notes/${photo.note}/`))));
      } catch {}
      placeholder.shown = true;
      render();
    }
    if (job.status === 'done' || job.status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, OCR_POLL_MS));
    try {
      job = await api(`/api/notes/ocr/${job.id}/`);
      updateUpload(job);
    } catch (error) {
      toast(error.message);
      uploads.delete(job.id);
      renderNotes();
      return;
    }
  }
  // Photos that couldn't be read keep their red placeholder for a few seconds, then go.
  setTimeout(() => {
    uploads.delete(job.id);
    renderNotes();
  }, upload.photos.some((photo) => photo.state === 'failed') ? 5000 : 0);
  refreshNoteCounts();
  const created = `${job.done} note${job.done === 1 ? '' : 's'} created from your photos.`;
  if (job.status === 'failed') toast(job.error || 'Your photos could not be read.');
  else if (job.failed) toast(`${created} ${job.error}`); // some photos worked, some didn't
  else toast(created);
}

document.getElementById('ocr-scan').addEventListener('animationiteration', () => {
  if (ocrUrls.length < 2) return;
  ocrImageIndex = (ocrImageIndex + 1) % ocrUrls.length;
  document.getElementById('ocr-count').textContent = `${ocrImageIndex + 1} / ${ocrUrls.length}`;
  paintTiles(ocrUrls[ocrImageIndex]);
});

/* ---------- Text / Markdown imports: the short writing animation ---------- */
const WRITE_MS = 1000;
let writeStartedAt = 0;

function startWriting() {
  document.getElementById('import-panes').hidden = true;
  document.getElementById('import-submit').hidden = true;
  document.getElementById('write-loading').hidden = false;
  writeStartedAt = performance.now();
}

function stopWriting() {
  document.getElementById('write-loading').hidden = true;
  document.getElementById('import-panes').hidden = false;
  document.getElementById('import-submit').hidden = false;
}

// Saving text files is quick; wait out the rest of the 1-second animation before closing.
async function finishWriting() {
  const animated = typeof motionEnabled !== 'function' || motionEnabled();
  const left = WRITE_MS - (performance.now() - writeStartedAt);
  if (animated && left > 0) await new Promise((resolve) => setTimeout(resolve, left));
}

document.getElementById('import-form').addEventListener('reset', stopWriting);
document.getElementById('import-dialog').addEventListener('close', stopWriting);

document.getElementById('import-text-tab').addEventListener('click', () => setImportMode('text'));
document.getElementById('import-image-tab').addEventListener('click', () => setImportMode('image'));
document.getElementById('import-form').addEventListener('reset', () => {
  stopOcrPreview();
  setImportMode('text');
});
document.getElementById('import-dialog').addEventListener('close', stopOcrPreview);

setImportMode('text');
