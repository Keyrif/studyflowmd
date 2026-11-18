# Frontend guide

This file is for developers working on the StudyFlowMD interface: how to run it, how the files are organised, and what the frontend does. The README describes the project itself.

## Running it

The frontend is served by Django together with the API, so run the whole app:

1. Copy `.env.example` to `.env` and fill in the values (database password, `DJANGO_SECRET_KEY`).
2. Start everything with Docker: `docker compose up --build`, then open http://localhost:8000.

`node preview.mjs` (http://127.0.0.1:4173) serves only the static files, with no API behind them. It is useful for checking layout and styles, but signing in and loading data will not work there.

## How it is built

Plain ES6+ JavaScript, locally bundled Bootstrap 5.3.3 CSS, and separate custom CSS. No React, build step, or package installation. Bootstrap is distributed under the MIT license; its license banner is retained in the vendor file.

- `index.html` holds all the markup: the sidebar, every view, and every dialog.
- `assets/app.js` holds the application state, rendering, and all calls to the Django API (`/api/...`).
- `assets/experience.js` handles sign-in, registration, and logout.
- `assets/i18n.js` translates the interface between English and Romanian.
- `assets/styles.css` holds the base layout and the themes, switched with the `data-theme` attribute on `<html>`. The other CSS files each add one layer on top, and `material3.css` is loaded last.

All data (accounts, subjects, tasks, notes, memberships) lives in PostgreSQL and is reached through the API.

Notes are paginated so the app stays fast with thousands of them. `/api/notes/` returns 30 at a time with only a short preview and the size; the full text is fetched when a note is opened, and the skill export uses `/api/notes/export/?subject=<id>`. Search and the per-subject file list run on the server. `state.notes` is a cache of whatever has been loaded, and `noteLists` tracks which notes each paged list shows. Tasks and subjects are small and are loaded in full, because the calendar, counters, and deadline popup need all of them. The browser's `localStorage` only keeps personal preferences: theme, font size, language, subject order, recently opened notes, and whether the mini timer was dismissed.

## Security notes for frontend code

- Every piece of user text is passed through `escapeHTML()` before it is inserted with `innerHTML`. Keep doing this for any new template.
- Colors that come from the server go through `safeColor()` before being written into a `style` attribute.
- Every request sends the `X-CSRFToken` header from the `csrftoken` cookie (see `api()` in `app.js`). Django rejects changes without it.
- A Content Security Policy (`SECURE_CSP` in `config/settings.py`) only allows scripts from our own `assets/` files. Never add inline `<script>` blocks, `onclick="..."` attributes, or `eval`; they will be blocked. Loading anything from a new outside site (another font or CDN) needs an entry in the policy.
- Django serves `index.html` through `config/views.py`, which adds a content fingerprint to every `assets/...js` and `.css` link (`app.js?v=3f9a2c81d0`). Browsers therefore always get the current file after an update. Keep asset links as plain `assets/...` paths in `index.html`; the fingerprint is added automatically.
- The frontend only hides buttons a user may not use. The real permission checks happen in Django, and the backend tests in `planner/tests.py` and `accounts/tests.py` verify them.

## Tests

- Backend: `docker compose exec web python manage.py test` runs the Django tests for accounts, permissions, and rate limits against a temporary database.
- Frontend: `node --test skill-export.test.cjs` checks the skill ZIP builder. Without Node installed, run it in Docker: `docker run --rm -v "${PWD}:/app:ro" -w /app node:22-alpine node --test skill-export.test.cjs`.
- `frontend.test.cjs` is out of date: it tests the earlier browser-only demo (sample data, `STUDY-DEMO` code) and all its tests fail against the current API-based app. It needs rewriting before it is useful again.

## Material 3 Expressive

`assets/material3.css` is loaded last and restyles the light and dark themes after Material 3 Expressive: tonal color roles (`--m3-*` tokens mapped onto the older `--bg`/`--accent`/`--panel` variables), large 28px surface shapes, pill buttons that morph into rounded squares on press, tonal/filled/extended-FAB button variants, connected button groups for tabs, M3 switch, checkbox, chips, search bar, fields, select menus, dialogs, snackbar, and a floating toolbar for mobile navigation. Blur (acrylic) surfaces, the liquid motion layer, layout, and markup are unchanged; the Counter-Strike theme is untouched. Roboto Flex is loaded from Google Fonts and falls back to Roboto / Segoe UI offline.

## Features

- Responsive overview, tasks, notes library, subjects, and calendar.
- Light and dark Material 3 Expressive themes with blurred surfaces, plus a Counter-Strike 1.6 VGUI-inspired theme, selected from the bottom of the sidebar.
- Sign-in and registration screens at `#login` and `#register`, backed by Django sessions. Visitors who are not signed in are redirected to sign-in, including direct workspace URLs. Logout is next to the username on desktop and under More on mobile.
- Overview with recently opened files first; upcoming deadlines in a chronological popup and a subject-count shortcut in the header.
- PERSONAL / SHARED collections. Subject cards and settings display the owner's name.
- Owners create and rename subjects, open or close invitations, reset invitation codes, and remove individual members. Closing invitations or resetting a code keeps existing members.
- Others join an open subject with its 8-character invitation code. Members get read-only access to the subject's files and can leave at any time. When a member leaves or is removed, their own tasks stay, just unfiled.
- Deleting a subject keeps its files in the notes library as unfiled. The owner's tasks for it are deleted; members' tasks stay, unfiled.
- Explorer-style file lists within each subject and the notes library, with name, modified date, type, and size columns. Lists show 30 files at a time with a Load more button.
- Create, edit, complete, and delete tasks; filter by completion.
- Create, edit, search, delete, import, and download Markdown or text files. Multiple `.md` and `.txt` files can be imported into a chosen subject at once.
- Import photos of notes (up to 10 JPG, PNG, or WebP, 10 MB each). The upload only stores the photos and queues a background job, so the dialog closes within moments. A Celery worker cleans each photo up, reads it with Tesseract OCR (Romanian and English), and saves it as a Markdown note; the page asks for progress every 1.5 seconds (`/api/notes/ocr/<job id>/`) and adds each note as soon as it is ready.
- Daily deadline reminders: every morning at 8:00 (Bucharest time), each student gets one email listing their unfinished tasks due tomorrow.
- Export a subject as an AI skill: a ZIP with `SKILL.md` and all its notes as references.
- Monthly calendar for deadlines, exams, and study sessions. Click a date to add an event, or an existing event to edit it.
- Focus timer with an editable 1–180 minute duration. A synchronized mini clock sits below the header on other pages and can be dragged to a trash zone to hide it.
- Six event colors, red highlights for overdue tasks, and orange for tomorrow. Completed tasks do not glow.
- Font size settings (100–150%) and English / Romanian interface language.
- Mobile floating bottom navigation with appearance and import controls under More. The calendar uses colored markers and a monthly agenda on small screens.
- Counter-Strike and reduced-motion settings disable animations.

## Liquid glass motion

`assets/liquid.css` and `assets/liquid.js` add a motion layer on top of the light and dark themes. Remove their two tags from `index.html` to switch it off; nothing else depends on them.

- Spring easing (`--spring`, `--spring-soft`) for presses, hovers, dialogs, popups, the snackbar, and view changes, which arrive as a staggered cascade.
- A selection pill that stretches as it flows between sidebar items (and the mobile bottom bar); the subject and sign-in tabs get a sliding pill.
- Glass surfaces catch a soft highlight under the pointer.
- Cards can be picked up. Subject cards drag freely and reorder their neighbours, and the new order is saved. Recent-note cards stretch on a rubber band and snap back. Mouse: drag. Touch: press and hold, then drag.
- Light/dark switching pours out from the switch (browsers with View Transitions), and calendar months slide in from the direction of travel.

## Not built yet

- Notes are edited as Markdown source, not rendered.
- Reminder emails print in the worker's log (`docker compose logs worker`); a real mail server is not configured yet.
