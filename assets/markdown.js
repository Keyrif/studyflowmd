'use strict';

// Markdown preview for the note editor (the eye button next to "Contents"), in the spirit of
// Obsidian's reading view: headings, bold, italics, lists, checkboxes, quotes, code, tables,
// links, ==highlights== and [[wiki links]].
//
// Safety: every piece of the note's text is HTML-escaped *before* any formatting is added,
// so a note can never inject markup or scripts into the page. Links only work for http(s)
// and mailto addresses.

const MD_SAFE_URL = /^(https?:\/\/|mailto:)/i;

function mdEscape(text) {
  return String(text).replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  );
}

// A formula, drawn by KaTeX (assets/vendor/katex) like in Obsidian: $inline$ or $$display$$.
// KaTeX escapes everything it outputs and, with trust: false, refuses commands that could add
// links or HTML. Without KaTeX (or for broken LaTeX) the formula's source is shown as code.
function mdMath(tex, display) {
  if (typeof katex !== 'undefined') {
    try {
      const html = katex.renderToString(tex, {
        displayMode: display, throwOnError: false, trust: false, strict: 'ignore',
        maxSize: 20, maxExpand: 500, output: 'htmlAndMathml',
      });
      return display ? `<div class="md-math">${html}</div>` : html;
    } catch {}
  }
  const source = mdEscape(display ? `$$${tex}$$` : `$${tex}$`);
  return display ? `<pre><code>${source}</code></pre>` : `<code>${source}</code>`;
}

// $x^2$ is a formula, but "$5 and $10" is not: no space right inside the dollar signs,
// and no digit right after the closing one.
const MD_INLINE_MATH = /(^|[^\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?![\d$])/g;

// Formatting inside one line of text.
function mdInline(text) {
  // Code spans and formulas first, so their contents are never formatted.
  const codes = [];
  const maths = [];
  let out = text.replace(/`([^`]+)`/g, (_, code) => `\u0000${codes.push(code) - 1}\u0000`);
  out = out.replace(MD_INLINE_MATH, (_, before, tex) => `${before}\u0001${maths.push(tex) - 1}\u0001`);
  out = mdEscape(out);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, url) =>
    MD_SAFE_URL.test(url) ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>` : match,
  );
  out = out
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => `<span class="md-wikilink">${label || target}</span>`)
    .replace(/\*\*(?=\S)(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)(.+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?=\S)([^*]+?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?=\S)([^_]+?)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)(.+?)~~/g, '<del>$1</del>')
    .replace(/==(?=\S)(.+?)==/g, '<mark>$1</mark>');
  return out
    .replace(/\u0001(\d+)\u0001/g, (_, index) => mdMath(maths[Number(index)], false))
    .replace(/\u0000(\d+)\u0000/g, (_, index) => `<code>${mdEscape(codes[Number(index)])}</code>`);
}

const MD_LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

function mdList(lines) {
  // Nested lists: an item indented further than the one before starts a sub-list.
  let html = '';
  const stack = []; // [{ indent, tag }]
  for (const line of lines) {
    const [, spaces, marker, rest] = line.match(MD_LIST_ITEM);
    const indent = spaces.replace(/\t/g, '    ').length;
    const tag = /\d/.test(marker) ? 'ol' : 'ul';
    while (stack.length && indent < stack.at(-1).indent) html += `</li></${stack.pop().tag}>`;
    if (!stack.length || indent > stack.at(-1).indent) {
      stack.push({ indent, tag });
      html += `<${tag}>`;
    } else {
      html += '</li>';
    }
    const task = rest.match(/^\[([ xX])\]\s+(.*)$/);
    html += task
      ? `<li class="md-task"><input type="checkbox" disabled ${task[1] !== ' ' ? 'checked' : ''}> ${mdInline(task[2])}`
      : `<li>${mdInline(rest)}`;
  }
  while (stack.length) html += `</li></${stack.pop().tag}>`;
  return html;
}

const mdTableRow = (line) =>
  line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());

function renderMarkdown(source) {
  const lines = String(source).replace(/\r\n?/g, '\n').split('\n');
  let html = '';
  let paragraph = [];
  const flush = () => {
    if (paragraph.length) html += `<p>${paragraph.map(mdInline).join('<br>')}</p>`;
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flush();
      const code = [];
      for (i += 1; i < lines.length && !/^\s*```/.test(lines[i]); i += 1) code.push(lines[i]);
      html += `<pre><code>${mdEscape(code.join('\n'))}</code></pre>`;
      continue;
    }
    // A display formula: $$ ... $$ on one line, or spread over several lines.
    const math = line.match(/^\s*\$\$(.*)$/);
    if (math) {
      flush();
      const closedHere = math[1].match(/^(.*?)\$\$\s*$/);
      let tex;
      if (closedHere) {
        tex = closedHere[1];
      } else {
        const body = [math[1]];
        for (i += 1; i < lines.length && !lines[i].includes('$$'); i += 1) body.push(lines[i]);
        if (i < lines.length) body.push(lines[i].slice(0, lines[i].indexOf('$$')));
        tex = body.join('\n');
      }
      if (tex.trim()) html += mdMath(tex.trim(), true);
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      flush();
      html += `<h${heading[1].length}>${mdInline(heading[2])}</h${heading[1].length}>`;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      html += '<hr>';
      continue;
    }
    if (/^\s*>/.test(line)) {
      flush();
      const quoted = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i += 1) quoted.push(lines[i].replace(/^\s*>\s?/, ''));
      i -= 1;
      html += `<blockquote>${renderMarkdown(quoted.join('\n'))}</blockquote>`;
      continue;
    }
    if (MD_LIST_ITEM.test(line)) {
      flush();
      const items = [];
      for (; i < lines.length && MD_LIST_ITEM.test(lines[i]); i += 1) items.push(lines[i]);
      i -= 1;
      html += mdList(items);
      continue;
    }
    // A table: a row of cells followed by a |---|---| separator line.
    if (line.includes('|') && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(lines[i + 1] || '')) {
      flush();
      const head = mdTableRow(line);
      const body = [];
      for (i += 2; i < lines.length && lines[i].includes('|') && lines[i].trim(); i += 1) body.push(mdTableRow(lines[i]));
      i -= 1;
      html += `<div class="md-table"><table><thead><tr>${head.map((cell) => `<th>${mdInline(cell)}</th>`).join('')}</tr></thead><tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${mdInline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return html || '<p class="md-empty">Nothing to preview yet.</p>';
}

/* ---------- The eye button in the note dialog ---------- */

const notePreviewToggle = document.getElementById('note-preview-toggle');
const notePreview = document.getElementById('note-preview');
const noteBodyField = document.getElementById('note-body');
const noteFormatField = document.getElementById('note-format');

const noteFullscreenButton = document.getElementById('note-fullscreen');
const noteReader = document.getElementById('note-reader');

// The note is the user's own words: the interface translator must never touch it
// (otherwise "Mon" in a table would turn into "Lun"). Only the empty-state hint is ours.
function fillPreview(element, text) {
  element.innerHTML = renderMarkdown(text);
  element.setAttribute('translate', text.trim() ? 'no' : 'yes');
}

function setNotePreview(on) {
  if (!notePreviewToggle) return;
  if (on) fillPreview(notePreview, noteBodyField.value);
  notePreview.hidden = !on;
  // The editor stays in the layout (just invisible), so the preview sits exactly on top
  // of it and the dialog never changes size.
  noteBodyField.parentElement.classList.toggle('previewing', on);
  notePreviewToggle.setAttribute('aria-pressed', String(on));
  notePreviewToggle.setAttribute('aria-label', on ? 'Back to editing' : 'Preview formatted note');
  notePreviewToggle.title = on ? 'Back to editing' : 'Preview formatted note';
  notePreviewToggle.innerHTML = icon(on ? 'edit' : 'eye');
}

// Only Markdown notes have formatting to show; plain text notes hide both buttons.
function syncNoteButtons() {
  const markdown = noteFormatField.value === 'md';
  notePreviewToggle.hidden = noteFullscreenButton.hidden = !markdown;
  if (!markdown) setNotePreview(false);
}

// Called when a note opens: Markdown notes with text open formatted, like Obsidian's
// reading view; a new or empty note opens ready for typing.
function resetNotePreview() {
  if (!notePreviewToggle) return;
  setNotePreview(noteFormatField.value === 'md' && noteBodyField.value.trim() !== '');
  syncNoteButtons();
}

function openNoteReader() {
  document.getElementById('note-reader-title').textContent =
    document.getElementById('note-title').value.trim() || 'Untitled';
  fillPreview(document.getElementById('note-reader-body'), noteBodyField.value);
  noteReader.showModal();
  noteReader.querySelector('.note-reader-body').scrollTop = 0;
}

notePreviewToggle?.addEventListener('click', () => setNotePreview(notePreview.hidden));
noteFullscreenButton?.addEventListener('click', openNoteReader);
notePreview?.addEventListener('dblclick', () => {
  setNotePreview(false);
  noteBodyField.focus();
});
noteFormatField?.addEventListener('change', syncNoteButtons);
// Closing the full-screen reader must not close the note behind it.
noteReader?.addEventListener('cancel', (event) => event.stopPropagation());
