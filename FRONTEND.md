# Frontend prototype

Open `index.html` directly, or run `node preview.mjs` and visit http://127.0.0.1:4173.

Run `node --test frontend.test.cjs` for migration, subject lifecycle, multi-file import, calendar selection, and theme-state checks. These exercise local state; visual checks are done in the browser.

Plain ES6+ JavaScript, locally bundled Bootstrap 5.3.3 CSS, and separate custom CSS. No React, build step, or package installation. Bootstrap is distributed under the MIT license; its license banner is retained in the vendor file.

## Available now

- Responsive overview, tasks, notes library, and subjects.
- Light and dark acrylic, plus a Counter-Strike 1.6 VGUI-inspired theme, selected from the bottom of the sidebar.
- Minimal overview with recently opened files first; upcoming deadlines in a chronological popup and a subject-count shortcut in the header.
- PERSONAL / SHARED collections. Subject cards and settings display the saved owner's name.
- Owners create/rename subjects, open or close invitations, reset invitation codes, and revoke individual memberships. Closing invitations or resetting a code preserves existing memberships. Owner deletion preserves personal files and deadlines as unfiled.
- Members have read-only files and a Leave subject action, with confirmation. Leaving removes the local shared collection and keeps personal content intact.
- To try joining locally, use `STUDY-DEMO` (Alex Morgan's sample collection). Owner settings include Add demo member for trying removal. All memberships persist in the browser; generated owner codes are not yet redeemable by other accounts or devices.
- Explorer-style file lists within each subject and the notes library, with name, modified date, type, and size columns.
- Create, edit, complete, and delete tasks; filter by completion.
- Create, edit, search, delete, import, and download Markdown or text files. Multiple `.md` and `.txt` files can be imported into a chosen subject at once, up to 1 MB each.
- Monthly calendar for deadlines, exams, and study sessions. Click a date to add an event or an existing event to edit it.
- Focus timer with an editable 1–180 minute duration. The synchronized clock sits below the header buttons on other pages; applying a duration pauses and resets it.
- Six saved event colors, red overdue task highlights, and orange highlights for tomorrow. Completed tasks do not glow.
- Font size settings (100–150%) saved in browser storage across themes.
- Acrylic popup entry/exit animations; CS and reduced-motion preferences disable animations.
- Mobile floating bottom navigation with appearance/import controls under More. The calendar uses colored markers and a readable monthly agenda on small screens.
- Footer stays at the viewport bottom on short pages and follows content on longer pages.
- Two-second timer startup pulse; on expiry a non-blocking announcement expands from the clock, stays for three seconds, bursts into particles and shrinks back. CS and reduced-motion settings use a simple three-second announcement.
- Matching sign-in/register screens at `#login` and `#register`; logout is next to the desktop username and under More on mobile. These are explicitly demo forms: no real authentication, password storage, or credential requests. A demo username is saved locally, and logout preserves workspace notes/tasks.
- New visitors are redirected to sign-in, including direct workspace URLs. Valid demo sessions are remembered across tabs and browser restarts using localStorage. Logout clears that session and redirects other open tabs to sign-in. Clearing browser data also requires signing in again. If storage is unavailable, login lasts only in the current tab. This is frontend navigation behavior, not server-enforced security; Django sessions will replace it.
- New subject is shown only on Overview, Notes library, and Subjects. Mobile navigation uses a translucent blurred acrylic background (CS stays opaque).
- Browser-local task, note, and theme persistence. The initial workspace includes sample data; clearing browser storage resets it. Storage is per browser and origin, with no account or synchronization. The timer resets on reload.

## Liquid glass motion

`assets/liquid.css` and `assets/liquid.js` add a motion layer on top of the acrylic themes. Remove their two tags from `index.html` to switch it off; nothing else depends on them.

- Spring easing (`--spring`, `--spring-soft`) for presses, hovers, dialogs, popups, the toast, and view changes, which arrive as a staggered cascade.
- A selection pill that stretches as it flows between sidebar items (and the mobile bottom bar); the subject and sign-in tabs get a sliding underline.
- Glass surfaces catch a soft highlight under the pointer.
- Cards can be picked up. Subject cards drag freely and reorder their neighbours, and the new order is saved. Recent-note cards stretch on a rubber band and snap back. Mouse: drag. Touch: press and hold, then drag.
- Light/dark switching pours out from the switch (browsers with View Transitions), and calendar months slide in from the direction of travel.
- Counter-Strike and reduced-motion settings keep everything static, as before.

## Later

The initial four subjects and their notes are sample data. The sidebar shows the prototype username `Student`; Django authentication/API, PostgreSQL persistence, image/PDF OCR, real public sharing, Celery/Redis reminders, and Docker are not implemented. Invitation and membership changes are local UI demonstrations; Django must implement actual cross-account access and enforce permissions. Notes are edited as source, not rendered HTML.

`index.html` holds the common markup; `assets/styles.css` holds layout and both themes using `data-theme`; `assets/app.js` holds demo state and interactions. The local preview server is only a development convenience, not the planned application backend.
