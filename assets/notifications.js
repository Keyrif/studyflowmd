'use strict';

// Notifications panel (next to Deadlines and Subjects) and browser push notifications.
// - The server creates reminders every hour (planner/tasks.py). This panel lists them,
//   newest first, with an x to delete each one. A badge counts the unread ones.
// - "Turn on browser notifications" subscribes this browser, so reminders pop up even when
//   no StudyFlowMD tab is open (delivered by the service worker in assets/sw.js).

const NOTIFICATION_POLL_MS = 60 * 1000;
const notificationToggle = document.getElementById('notifications-toggle');
const notificationPopup = document.getElementById('notifications-popup');
const notificationList = document.getElementById('notification-list');
const notificationBadge = document.getElementById('notification-count');
const pushSetting = document.getElementById('push-setting');
let notifications = [];
let pushPublicKey;

function timeAgo(iso) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString(uiLocale(), { day: 'numeric', month: 'short' });
}

function renderNotifications(unread) {
  notificationBadge.textContent = unread > 9 ? '9+' : String(unread);
  notificationBadge.hidden = !unread;
  notificationToggle.setAttribute('aria-label', unread ? `Notifications, ${unread} unread` : 'Notifications');
  notificationList.innerHTML = notifications.length
    ? notifications
        .map(
          (n) =>
            `<div class="notification-item ${n.read ? '' : 'unread'}"><button class="notification-open" ${n.task ? `data-notification-task="${escapeHTML(n.task)}"` : 'disabled'}><span class="notification-dot" aria-hidden="true"></span><span class="notification-text"><strong translate="no">${escapeHTML(n.title)}</strong><small>${escapeHTML(n.body)}</small><time>${escapeHTML(timeAgo(n.created))}</time></span></button><button class="icon-button notification-delete" data-delete-notification="${escapeHTML(n.id)}" aria-label="Delete notification" title="Delete">${icon('x')}</button></div>`,
        )
        .join('')
    : '<p class="empty">No notifications yet. Reminders for upcoming deadlines will show up here.</p>';
}

async function loadNotifications() {
  if (!currentUser) return;
  try {
    const data = await api('/api/notifications/');
    notifications = data.results;
    renderNotifications(data.unread);
  } catch {}
}

async function openNotifications() {
  if (typeof closeDeadlines === 'function') closeDeadlines();
  showPanel(notificationPopup);
  notificationToggle.setAttribute('aria-expanded', 'true');
  await loadNotifications();
  renderPushSetting();
  // Opening the panel counts as reading them.
  if (notifications.some((n) => !n.read)) {
    try {
      await api('/api/notifications/read-all/', { method: 'POST' });
      notifications.forEach((n) => (n.read = true));
      notificationBadge.hidden = true;
    } catch {}
  }
}

function closeNotifications() {
  if (notificationPopup.hidden) return;
  hidePanel(notificationPopup);
  notificationToggle.setAttribute('aria-expanded', 'false');
  renderNotifications(0);
}

notificationToggle.addEventListener('click', () => {
  if (notificationPopup.hidden) openNotifications();
  else closeNotifications();
});
document.getElementById('notifications-close').addEventListener('click', closeNotifications);
document.addEventListener('click', (event) => {
  if (!notificationPopup.hidden && !event.target.closest('.notification-control')) closeNotifications();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !notificationPopup.hidden) {
    closeNotifications();
    notificationToggle.focus();
  }
});

notificationList.addEventListener('click', async (event) => {
  const remove = event.target.closest('[data-delete-notification]');
  if (remove) {
    const id = remove.dataset.deleteNotification;
    try {
      await api(`/api/notifications/${encodeURIComponent(id)}/`, { method: 'DELETE' });
    } catch (error) {
      toast(error.message);
      return;
    }
    notifications = notifications.filter((n) => String(n.id) !== id);
    renderNotifications(notifications.filter((n) => !n.read).length);
    return;
  }
  const open = event.target.closest('[data-notification-task]');
  if (open && state.tasks.some((t) => t.id === open.dataset.notificationTask)) {
    closeNotifications();
    openTask(open.dataset.notificationTask);
  }
});

/* ---------- Browser push notifications ---------- */

const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

// The server's public key arrives as base64url text; the browser wants raw bytes.
function keyBytes(base64url) {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

async function currentSubscription() {
  const registration = await navigator.serviceWorker.getRegistration('assets/');
  return registration ? registration.pushManager.getSubscription() : null;
}

async function renderPushSetting() {
  if (pushPublicKey === undefined) {
    try {
      pushPublicKey = (await api('/api/push/')).public_key;
    } catch {
      pushPublicKey = null;
    }
  }
  if (!pushPublicKey || !pushSupported()) {
    pushSetting.hidden = true;
    return;
  }
  pushSetting.hidden = false;
  const label = pushSetting.querySelector('span');
  const button = pushSetting.querySelector('button');
  if (Notification.permission === 'denied') {
    label.textContent = 'Browser notifications are blocked in your browser settings.';
    button.hidden = true;
    return;
  }
  const subscribed = Boolean(await currentSubscription());
  label.textContent = subscribed ? 'Browser notifications are on.' : 'Get reminders even when this tab is closed.';
  button.textContent = subscribed ? 'Turn off' : 'Turn on';
  button.hidden = false;
  button.dataset.action = subscribed ? 'off' : 'on';
}

async function enablePush() {
  // The permission question may only be asked right after a click, never on its own.
  if ((await Notification.requestPermission()) !== 'granted') return renderPushSetting();
  const registration = await navigator.serviceWorker.register('assets/sw.js', { scope: 'assets/' });
  await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true, // every push must show a visible notification
    applicationServerKey: keyBytes(pushPublicKey),
  });
  await api('/api/push/', { method: 'POST', body: subscription.toJSON() });
  toast('Browser notifications are on.');
}

async function disablePush() {
  const subscription = await currentSubscription();
  if (!subscription) return;
  try {
    await api('/api/push/unsubscribe/', { method: 'DELETE', body: { endpoint: subscription.endpoint } });
  } catch {}
  await subscription.unsubscribe();
  toast('Browser notifications are off.');
}

pushSetting.querySelector('button').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    if (button.dataset.action === 'off') await disablePush();
    else await enablePush();
  } catch (error) {
    toast(error.message || 'Browser notifications could not be turned on.');
  } finally {
    button.disabled = false;
    renderPushSetting();
  }
});

// Signing out stops this browser's notifications, so the next person on a shared computer
// doesn't get your reminders. (The server notices the dead subscription on its next push.)
document.addEventListener(
  'click',
  (event) => {
    if (event.target.closest('[data-logout]') && pushSupported()) {
      currentSubscription().then((subscription) => subscription?.unsubscribe()).catch(() => {});
    }
  },
  true,
);

// Keep the badge fresh: check now, every minute, and whenever the tab comes back into view.
setTimeout(loadNotifications, 1500);
setInterval(() => {
  if (!document.hidden) loadNotifications();
}, NOTIFICATION_POLL_MS);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) loadNotifications();
});
