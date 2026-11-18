'use strict';

// The followed-tasks widget, shown under the mini timer at the top of every page.
// - It shows the followed task with the closest deadline (upcoming first, then overdue).
// - Clicking it opens a dropdown with every followed task; click one to open it, or its
//   star to unfollow it.
// - Like the timer, it can be dragged into the trash to hide it. Following a task again
//   brings it back.

const FOLLOW_WIDGET_KEY = 'studyflow.followWidgetDismissed';
const followWidgetDismissed = () => readFlag(FOLLOW_WIDGET_KEY);
const setFollowWidgetDismissed = (dismissed) => writeFlag(FOLLOW_WIDGET_KEY, dismissed);

const followWidget = document.getElementById('follow-widget');
const followButton = document.getElementById('follow-next');
const followList = document.getElementById('follow-list');

// Open followed tasks, closest deadline first. Upcoming ones come before overdue ones,
// so the widget points at what's next rather than at something already missed.
function followedTasks() {
  const today = offsetDate(0);
  const open = state.tasks.filter((task) => task.followed && !task.done);
  const upcoming = open.filter((task) => task.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const overdue = open.filter((task) => task.date < today).sort((a, b) => b.date.localeCompare(a.date));
  return [...upcoming, ...overdue];
}

function closeFollowList() {
  followList.hidden = true;
  followButton.setAttribute('aria-expanded', 'false');
}

function renderFollowWidget() {
  const tasks = followedTasks();
  const show = Boolean(currentUser) && tasks.length > 0 && !followWidgetDismissed();
  followWidget.hidden = !show;
  if (!show) {
    closeFollowList();
    return;
  }
  const next = tasks[0];
  followWidget.style.setProperty('--event-color', eventColor(next));
  followWidget.classList.toggle('follow-overdue', taskUrgency(next) === 'task-overdue');
  followWidget.classList.toggle('follow-soon', taskUrgency(next) === 'task-tomorrow');
  document.getElementById('follow-title').textContent = next.title;
  document.getElementById('follow-meta').textContent = `${dueLabel(next.date)} · ${next.kind}`;
  document.getElementById('follow-more').textContent = tasks.length > 1 ? `+${tasks.length - 1}` : '';
  followButton.setAttribute('aria-label', `Next followed task: ${next.title}. Show all followed tasks`);
  followList.innerHTML =
    '<div class="follow-list-heading">Followed tasks</div>' +
    tasks
      .map(
        (task) =>
          `<div class="follow-item ${taskUrgency(task)}"><button class="follow-open" data-edit-task="${escapeHTML(task.id)}"><span class="subject-dot" style="--subject-color:${eventColor(task)}"></span><span class="follow-item-text"><strong translate="no">${escapeHTML(task.title)}</strong><small>${escapeHTML(task.subject || 'Unfiled')} · ${escapeHTML(task.kind)}</small></span><time class="due">${escapeHTML(dueLabel(task.date))}</time></button><button class="icon-button task-follow following" data-follow-task="${escapeHTML(task.id)}" aria-label="Unfollow ${escapeHTML(task.title)}" title="Unfollow">${icon('star')}</button></div>`,
      )
      .join('');
}

followButton.addEventListener('click', () => {
  const open = followList.hidden;
  followList.hidden = !open;
  followButton.setAttribute('aria-expanded', String(open));
});
// Close the dropdown after picking a task, when clicking elsewhere, or with Escape.
followList.addEventListener('click', (event) => {
  if (event.target.closest('.follow-open')) closeFollowList();
});
document.addEventListener('click', (event) => {
  if (!followList.hidden && !followWidget.contains(event.target)) closeFollowList();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !followList.hidden) {
    closeFollowList();
    followButton.focus();
  }
});

makeTrashable(followWidget, {
  title: 'Drop here to hide followed tasks',
  hint: 'Follow a task again to bring it back',
  onTrash: () => {
    closeFollowList();
    setFollowWidgetDismissed(true);
  },
  done: 'Followed tasks hidden. Follow a task again to bring them back.',
});

renderFollowWidget();
