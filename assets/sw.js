'use strict';

// Service worker: a small script the browser keeps around even when no StudyFlowMD tab is
// open. When the server pushes a reminder, the browser wakes this up to display it.

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'StudyFlowMD', {
      body: data.body || '',
      tag: data.tag, // the same reminder replaces itself instead of stacking up
      data: { url: data.url || '/' },
    }),
  );
});

// Clicking the notification brings back an open StudyFlowMD tab, or opens a new one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((client) => client.url.startsWith(self.location.origin));
      return open ? open.focus() : self.clients.openWindow(url);
    }),
  );
});
