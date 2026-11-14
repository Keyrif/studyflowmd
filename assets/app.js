'use strict';

const icons = {
  logout: '<path d="M9 4H4v16h5M9 12h12m-4-4 4 4-4 4"/>',
  type: '<path d="M3 6h12M9 6v15M5 21h8M15 12h6M18 12v9"/>',
  moon: '<path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 2 2 3h4l1-3 3-1 2-3-2-2 1-3-3-2-2-3H9Z"/>',
  folder: '<path d="M3 7V4h6l3 3h9v13H3V7Z"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  check: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m7 12 3 3 7-7"/>',
  file: '<path d="M14 3H5v18h14V8l-5-5Z"/><path d="M14 3v5h5M8 12h8M8 16h6"/>',
  book: '<path d="M12 5C8 2 3 4 3 4v15s5-2 9 1c4-3 9-1 9-1V4s-5-2-9 1v15"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18M7 14h2M13 14h2M7 17h2"/>',
  arrow: '<path d="M4 12h15m-5-5 5 5-5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  chevrons: '<path d="m9 9 3-3 3 3m-6 6 3 3 3-3"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
  play: '<path d="m8 4 12 8-12 8V4Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  reset: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  scan: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M7 8h10M7 12h10M7 16h6"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',
  x: '<path d="m6 6 12 12M6 18 18 6"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>'
};
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
function readDemoSession(){
  try{const saved=JSON.parse(localStorage.getItem('studyflow.demoSession'));return typeof saved?.username==='string'&&saved.username.trim()?{username:saved.username.trim()}:null;}catch{return null;}
}
let demoSession=readDemoSession();
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.file}</svg>`;
function hydrateIcons() { $$('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); }); }
const escapeHTML = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const defaultSubjects = [
  { name: 'Microeconomics', color: '#9d9fbd', detail: 'Choices, markets & everything between.' },
  { name: 'Databases', color: '#7eaa97', detail: 'A little structure for a lot of data.' },
  { name: 'Statistics', color: '#c5a16d', detail: 'Finding the story in the numbers.' },
  { name: 'Web development', color: '#839eb6', detail: 'One idea, brought to the browser.' }
];
const dateString = (date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
function offsetDate(days) { const date = new Date(); date.setDate(date.getDate()+days); return dateString(date); }
const seed = {
  tasks: [
    {id:'t1', title:'Problem set · Consumer theory', subject:'Microeconomics', date:offsetDate(1), kind:'Assignment', done:false},
    {id:'t2', title:'Review SQL joins & normalization', subject:'Databases', date:offsetDate(2), kind:'Study session', done:false},
    {id:'t3', title:'Midterm · Probability distributions', subject:'Statistics', date:offsetDate(4), kind:'Exam', done:false},
    {id:'t4', title:'Build the first project wireframe', subject:'Web development', date:offsetDate(6), kind:'Assignment', done:false},
    {id:'t5', title:'Organize this semester’s subjects', subject:'Web development', date:offsetDate(0), kind:'Study session', done:true}
  ],
  notes: [
    {id:'n1',title:'Consumer theory',subject:'Microeconomics',body:'# Consumer theory\n\nHow we make choices with limited resources.\n\n## Key concepts\n- Preferences and utility\n- Budget constraints\n- Marginal rate of substitution\n\n## Next session\nWork through the practice problems.',updated: new Date().toISOString()},
    {id:'n2',title:'SQL, a quick reference',subject:'Databases',body:'# SQL, a quick reference\n\nJoins, keys, and a little order in the chaos.\n\n```sql\nSELECT subjects.name, COUNT(tasks.id)\nFROM subjects\nLEFT JOIN tasks ON tasks.subject_id = subjects.id\nGROUP BY subjects.name;\n```',updated:new Date().toISOString()},
    {id:'n3',title:'Probability essentials',subject:'Statistics',body:'# Probability essentials\n\nA few useful ideas for the next midterm.\n\n- Sample spaces and events\n- Conditional probability\n- Independent events\n- Expected values',updated:new Date().toISOString()}
  ]
};
let state;
let storageAvailable = true;
try {
  const saved = JSON.parse(localStorage.getItem('studyflow.workspace.v1'));
  const validTask = t => t && ['id','title','subject','date','kind'].every(k => typeof t[k] === 'string') && typeof t.done === 'boolean' && /^\d{4}-\d{2}-\d{2}$/.test(t.date);
  const validNote = n => n && ['id','title','subject','body','updated'].every(k => typeof n[k] === 'string');
  state = saved && Array.isArray(saved.tasks) && saved.tasks.every(validTask) && Array.isArray(saved.notes) && saved.notes.every(validNote) ? saved : structuredClone(seed);
} catch { state = structuredClone(seed); }
function save() {
  try { localStorage.setItem('studyflow.workspace.v1', JSON.stringify(state)); storageAvailable = true; return true; }
  catch { storageAvailable = false; toast('Browser storage is unavailable. Changes last only until this page closes.'); return false; }
}
let toastTimeout;
function toast(message) { $('#toast').textContent=message; $('#toast').hidden=false; clearTimeout(toastTimeout); toastTimeout=setTimeout(()=>$('#toast').hidden=true,4500); }
const subjectColor = name => state.subjects.find(s=>s.name===name)?.color || '#89a392';
if (!Array.isArray(state.subjects)) state.subjects = defaultSubjects.map((s,i)=>({...s,id:'s'+i,public:false}));
state.subjects.forEach(s=>{s.role=s.role||'owner';s.ownerName=s.ownerName||localUsername();s.members=s.members||[];s.inviteCode=s.inviteCode||crypto.randomUUID().slice(0,8).toUpperCase();});
let subjectTab='personal';
state.notes.forEach(n=>{if(!['md','txt'].includes(n.format))n.format='md';});
let activeSubject = null;
let currentView = 'dashboard';
let calendarDate = new Date(new Date().getFullYear(),new Date().getMonth(),1);
function dueLabel(date) {
  const days = Math.round((new Date(`${date}T12:00:00`) - new Date(`${dateString(new Date())}T12:00:00`))/86400000);
  return days < 0 ? `${Math.abs(days)}d overdue` : days===0 ? 'Today' : days===1 ? 'Tomorrow' : new Date(`${date}T12:00:00`).toLocaleDateString('en-GB',{day:'numeric',month:'short'});
}
function renderTasks(target, filter, limit=Infinity) {
  const tasks = state.tasks.filter(t=>filter==='all' || (filter==='done' ? t.done : !t.done)).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,limit);
  $(target).innerHTML = tasks.length ? tasks.map(t=>`<div class="task-row ${taskUrgency(t)} ${t.done?'done':''}"><input type="checkbox" class="task-check" data-complete="${escapeHTML(t.id)}" ${t.done?'checked':''} aria-label="Complete ${escapeHTML(t.title)}"><div class="task-info"><button class="task-name" data-edit-task="${escapeHTML(t.id)}">${escapeHTML(t.title)}</button><div class="task-meta"><span class="subject-dot" style="--subject-color:${subjectColor(t.subject)}"></span>${escapeHTML(t.subject)}<span>·</span>${escapeHTML(t.kind)}</div></div><span class="due ${t.date<=offsetDate(1)&&!t.done?'soon':''}">${t.done?'Completed':escapeHTML(dueLabel(t.date))}</span><button class="icon-button task-delete" data-delete-task="${escapeHTML(t.id)}" aria-label="Delete ${escapeHTML(t.title)}">${icon('trash')}</button></div>`).join('') : '<div class="empty">All clear here. A little breathing room.</div>';
}
function noteCard(n, recent=false) {
  const preview=n.body.replace(/[#*`>]/g,'').split('\n').filter(Boolean).slice(1).join(' ');
  return `<div class="${recent?'col-md-4':'col-md-6 col-xl-4'}"><button class="note-card glass" data-edit-note="${escapeHTML(n.id)}"><div class="note-top"><span class="note-icon">${icon('file')}</span><span class="file-type">.${n.format}</span></div><h3>${escapeHTML(n.title)}</h3><p>${escapeHTML(preview || 'A fresh page, ready for an idea.')}</p><div class="note-bottom"><span class="subject-dot" style="--subject-color:${subjectColor(n.subject)}"></span>${escapeHTML(n.subject)}<time>${new Date(n.updated).toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</time></div></button></div>`;
}
function renderNotes() {
  const query=$('#note-search').value.toLowerCase();
  const sorted=[...state.notes].sort((a,b)=>(b.opened||b.updated).localeCompare(a.opened||a.updated));
  $('#recent-notes').innerHTML=sorted.slice(0,3).map(n=>noteCard(n,true)).join('') || '<p class="empty">Your next idea belongs here. Add a note in the library.</p>';
  $('#all-notes').innerHTML=fileTable(sorted.filter(n=>`${n.title} ${n.subject} ${n.body}`.toLowerCase().includes(query)),true);
  if(activeSubject)$('#subject-files').innerHTML=fileTable(sorted.filter(n=>n.subject===activeSubject.name));
}
function render() {
  const open=state.tasks.filter(t=>!t.done);
  $('#task-count').textContent=open.length;
  $('#deadline-count').textContent=open.length;
  $('#subject-count').textContent=state.subjects.length+' subjects';
  renderTasks('#all-tasks',$('#task-filter').value);
  renderNotes(); renderSubjects(); renderDeadlines(); renderCalendar(); updateSubjectOptions();
}
const views={dashboard:['Overview','Room to think. Space to grow.','Your studies, a little more in flow.'],tasks:['My tasks','One thing at a time.','A clear place for everything on your list.'],notes:['Notes library','Keep your ideas close.','All your text and Markdown files.'],subjects:['Subjects','Your semester, in perspective.','A home for every collection of notes.'],calendar:['Calendar','A little room to plan.','Deadlines, exams, and everything coming up.'],subject:['Subjects','','Text and Markdown files']};
function navigate() {
  let hash=location.hash.slice(1);
  if(!demoSession&&!['login','register'].includes(hash)){hash='login';location.replace('#login');}
  else if(demoSession&&['login','register'].includes(hash)){hash='dashboard';location.replace('#dashboard');}
  const authRoute=['login','register'].includes(hash);
  document.body.classList.toggle('auth-active',authRoute);
  $('#auth-view').hidden=!authRoute;
  if(authRoute){setMobileMenu(false);closeDeadlines();if(typeof renderAuth==='function')renderAuth(hash);return;}
  activeSubject=hash.startsWith('subject/')?state.subjects.find(s=>s.id===hash.slice(8)):null;
  const view=activeSubject?'subject':Object.hasOwn(views,hash)&&hash!=='subject'?hash:'dashboard';
  currentView=view;
  $('#new-subject').hidden=!['dashboard','notes','subjects'].includes(view);
  setMobileMenu(false);
  $$('.view').forEach(el=>el.hidden=el.id!==view+'-view');
  $$('nav a').forEach(el=>{const selected=el.dataset.view===(view==='subject'?'subjects':view);el.classList.toggle('active',selected);if(selected)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
  $('#breadcrumb').textContent=activeSubject?activeSubject.name:views[view][0];$('#page-title').textContent=activeSubject?activeSubject.name:views[view][1];$('#page-subtitle').textContent=views[view][2];
  $('#mini-focus').hidden=view==='dashboard';
  if(activeSubject){$('#folder-visibility').textContent='Owner: '+activeSubject.ownerName+(activeSubject.role==='member'?' · Read only':' · You');$('#folder-import').hidden=$('#folder-new').hidden=activeSubject.role==='member';renderNotes();}
  closeDeadlines();
}
function openTask(id, date) {
  $('#task-form').reset();const task=state.tasks.find(t=>t.id===id);
  renderColorPicker(task?.color||({Exam:'violet',Assignment:'blue','Study session':'sage'}[task?.kind]));
  $('#task-id').value=task?.id||'';$('#task-title').value=task?.title||'';$('#task-date').value=task?.date||date||offsetDate(1);$('#task-subject').value=task?.subject??activeSubject?.name??state.subjects[0]?.name??'';$('#task-kind').value=task?.kind||'Assignment';$('#task-dialog-title').textContent=task?'A little adjustment':'A new small step';$('#task-dialog').showModal();$('#task-title').focus();
}
function openNote(id, imported) {
  const note=state.notes.find(n=>n.id===id)||imported;
  if(note?.id){note.opened=new Date().toISOString();save();renderNotes();}
  updateSubjectOptions();
  const readonly=!!note&&isSharedSubject(note.subject);
  if(readonly)$('#note-subject').innerHTML+=`<option value="${escapeHTML(note.subject)}">${escapeHTML(note.subject)}</option>`;
  ['#note-title','#note-body'].forEach(selector=>$(selector).readOnly=readonly);
  ['#note-format','#note-subject'].forEach(selector=>$(selector).disabled=readonly);
  $('#save-note').hidden=readonly;
  $('#note-format').value=note?.format||'md';
  $('#note-id').value=note?.id||'';$('#note-title').value=note?.title||'';$('#note-subject').value=note?.subject??activeSubject?.name??state.subjects[0]?.name??'';$('#note-body').value=note?.body||'';$('#delete-note').hidden=!note?.id||readonly;$('#note-dialog').showModal();$('#note-title').focus();
}
document.addEventListener('click',event=>{
  const target=event.target.closest('button');if(!target)return;
  if(target.hasAttribute('data-add-task'))openTask();
  if(target.dataset.editTask)openTask(target.dataset.editTask);
  if(target.dataset.deleteTask){state.tasks=state.tasks.filter(t=>t.id!==target.dataset.deleteTask);save();render();}
  if(target.dataset.editNote)openNote(target.dataset.editNote);
  if(target.hasAttribute('data-close'))closeDialog(target.closest('dialog'));
  if(target.dataset.subjectSettings)openSubject(target.dataset.subjectSettings);
  if(target.dataset.calendarDay)openTask(null,target.dataset.calendarDay);
  if(target.dataset.revokeMember)confirmRevokeMember(target.dataset.revokeMember);
});
document.addEventListener('change',event=>{if(event.target.dataset.complete){const task=state.tasks.find(t=>t.id===event.target.dataset.complete);if(task){task.done=event.target.checked;save();render();}}});
$('#task-form').addEventListener('submit',event=>{
  event.preventDefault();const title=$('#task-title').value.trim();if(!title){$('#task-title').focus();return;}
  const existing=state.tasks.find(t=>t.id===$('#task-id').value);
  const task={id:existing?.id||crypto.randomUUID(),title,subject:$('#task-subject').value,date:$('#task-date').value,kind:$('#task-kind').value,color:selectedEventColor,done:existing?.done||false};
  if(existing)Object.assign(existing,task);else state.tasks.push(task);save();render();closeDialog($('#task-dialog'));if(storageAvailable)toast('Task saved. One step closer.');
});
$('#note-form').addEventListener('submit',event=>{
  event.preventDefault();const title=$('#note-title').value.trim();if(!title){$('#note-title').focus();return;}
  const existing=state.notes.find(n=>n.id===$('#note-id').value);
  if(isSharedSubject(existing?.subject)||isSharedSubject($('#note-subject').value))return;
  const note={id:existing?.id||crypto.randomUUID(),title,subject:$('#note-subject').value,body:$('#note-body').value,format:$('#note-format').value,updated:new Date().toISOString()};
  if(existing)Object.assign(existing,note);else state.notes.push(note);save();render();closeDialog($('#note-dialog'));if(storageAvailable)toast('Your note is saved.');
});
$('#delete-note').onclick=()=>{if(isSharedSubject(state.notes.find(n=>n.id===$('#note-id').value)?.subject))return;state.notes=state.notes.filter(n=>n.id!==$('#note-id').value);save();render();closeDialog($('#note-dialog'));};
$('#download-note').onclick=()=>{const url=URL.createObjectURL(new Blob([$('#note-body').value],{type:'text/markdown;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=($('#note-title').value.trim().replace(/[^\p{L}\p{N}\s_-]/gu,'').slice(0,80)||'Untitled')+'.'+$('#note-format').value;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('#new-subject').onclick=()=>openSubject();$('#new-note').onclick=()=>openNote();
$('#task-filter').onchange=render;$('#note-search').oninput=renderNotes;
let acrylicDark = true;
function setTheme(theme) {
  document.documentElement.dataset.theme=theme;
  if(theme!=='cs')acrylicDark=theme==='dark';
  $('#theme-label').textContent=theme==='cs'?'Counter-Strike 1.6':'Acrylic';
  $('#theme-switch').setAttribute('aria-label',theme==='cs'?'Switch to Acrylic theme':'Switch to Counter-Strike theme');
  $('#theme-switch').setAttribute('aria-pressed',String(theme==='cs'));
  $('#dark-switch').hidden=theme==='cs';
  $('#dark-switch').setAttribute('aria-pressed',String(acrylicDark));
  $('#dark-label').textContent=acrylicDark?'Light mode':'Dark mode';
  $('meta[name="theme-color"]').content=theme==='cs'?'#3e4637':theme==='dark'?'#17211f':'#e8eeeb';
}
function rememberTheme(theme){setTheme(theme);try{localStorage.setItem('studyflow.theme',theme);localStorage.setItem('studyflow.acrylicDark',String(acrylicDark));}catch{toast('Theme changed for this session.');}}
$('#theme-switch').onclick=()=>rememberTheme(document.documentElement.dataset.theme==='cs'?(acrylicDark?'dark':'glass'):'cs');
$('#dark-switch').onclick=()=>rememberTheme(acrylicDark?'glass':'dark');
let durationMinutes=25, remaining=25*60, timerEnd=null, timerInterval=null;
function renderTimer(){const minutes=String(Math.floor(remaining/60)).padStart(2,'0'),seconds=String(remaining%60).padStart(2,'0');$('#mini-time').textContent=minutes+':'+seconds;$('#mini-toggle').innerHTML=icon(timerEnd?'pause':'play');$('#mini-toggle').setAttribute('aria-label',timerEnd?'Pause focus timer':'Start focus timer');$('#timer').innerHTML=`${minutes}<span>:</span>${seconds}`;$('#focus-toggle').innerHTML=`${icon(timerEnd?'pause':'play')}<span>${timerEnd?'Pause session':remaining===durationMinutes*60?'Start focusing':remaining===0?'Start another':'Keep going'}</span>`;}
function tick(){remaining=Math.max(0,Math.ceil((timerEnd-Date.now())/1000));if(remaining===0){clearInterval(timerInterval);timerEnd=null;if(typeof timerExpired==='function')timerExpired();else toast('Timer expired');}renderTimer();}
$('#focus-toggle').onclick=()=>{if(timerEnd){remaining=Math.max(0,Math.ceil((timerEnd-Date.now())/1000));timerEnd=null;clearInterval(timerInterval);}else{if(remaining===0)remaining=durationMinutes*60;timerEnd=Date.now()+remaining*1000;timerInterval=setInterval(tick,250);if(typeof energizeClock==='function')energizeClock();}renderTimer();};
$('#focus-reset').onclick=()=>{clearInterval(timerInterval);timerEnd=null;remaining=durationMinutes*60;renderTimer();};
$$('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{if(event.target===dialog){const bounds=dialog.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)closeDialog(dialog);}}));
window.addEventListener('hashchange',navigate);
function fileTable(notes, showSubject=false) {
  if(!notes.length)return '<p class="empty">No files yet. Add a new file or import your notes.</p>';
  return `<div class="table-scroll"><table class="files-table"><thead><tr><th scope="col">Name</th>${showSubject?'<th scope="col">Subject</th>':''}<th scope="col">Date modified</th><th scope="col">Type</th><th scope="col" class="file-size">Size</th></tr></thead><tbody>${notes.map(n=>`<tr><td><button class="file-name" data-edit-note="${escapeHTML(n.id)}">${icon('file')}<span>${escapeHTML(n.title)}.${n.format}</span></button></td>${showSubject?`<td>${escapeHTML(n.subject||'Unfiled')}</td>`:''}<td>${new Date(n.updated).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}</td><td>${n.format==='txt'?'Text document':'Markdown'}</td><td class="file-size">${Math.max(1,Math.ceil(new Blob([n.body]).size/1024))} KB</td></tr>`).join('')}</tbody></table></div>`;
}
function updateSubjectOptions() {
  ['#task-subject','#note-subject','#import-subject'].forEach(selector=>{
    const selected=$(selector).value;
    $(selector).innerHTML='<option value="">Unfiled</option>'+state.subjects.filter(s=>selector==='#task-subject'||s.role==='owner').map(s=>`<option value="${escapeHTML(s.name)}">${escapeHTML(s.name)}</option>`).join('');
    $(selector).value=state.subjects.some(s=>s.name===selected)?selected:'';
  });
}
function renderSubjects() {
  const personal=state.subjects.filter(s=>s.role==='owner'),shared=state.subjects.filter(s=>s.role==='member');
  $('#personal-count').textContent=personal.length;$('#shared-count').textContent=shared.length;
  ['personal','shared'].forEach(tab=>{$('#'+tab+'-tab').classList.toggle('active',subjectTab===tab);$('#'+tab+'-tab').setAttribute('aria-pressed',String(subjectTab===tab));});
  $('#subject-list').innerHTML=(subjectTab==='personal'?personal:shared).map(s=>`<div class="col-md-6"><article class="glass subject-card"><div class="subject-card-top"><span class="note-icon" style="color:${s.color}">${icon('folder')}</span><button class="icon-button" data-subject-settings="${escapeHTML(s.id)}" aria-label="Settings for ${escapeHTML(s.name)}">${icon('settings')}</button></div><a class="subject-title" href="#subject/${encodeURIComponent(s.id)}"><h2>${escapeHTML(s.name)}</h2></a><p>${state.notes.filter(n=>n.subject===s.name).length} files · ${s.role==='member'?'Read only':s.members.length+' members'}</p><p class="subject-owner-caption">Owner: ${escapeHTML(s.ownerName)}${s.role==='owner'?' (you)':''}</p><div class="subject-skill-actions"><a class="button secondary" href="#subject/${encodeURIComponent(s.id)}">Open subject ${icon('arrow')}</a><button class="button secondary" data-export-skill="${escapeHTML(s.id)}">${icon('spark')} Export as skill</button></div></article></div>`).join('') || '<p class="empty">'+(subjectTab==='personal'?'Create your first subject to collect your notes.':'Join a subject with an invitation code. It will stay here until you leave or access is revoked.')+'</p>';
}
function openSubject(id) {
  const subject=state.subjects.find(s=>s.id===id);
  const member=subject?.role==='member';
  $('#subject-owner').textContent=subject?.ownerName||localUsername();$('#subject-role').textContent=member?'Member · Read only':'Owner · You';
  $('#subject-name').readOnly=member;$('#owner-settings').hidden=member;$('#member-settings').hidden=!member;
  $('#leave-subject').hidden=!member;$('#save-subject').hidden=member;$('#subject-access').hidden=!subject;
  $('#subject-id').value=subject?.id||'';$('#subject-name').value=subject?.name||'';
  $('#subject-public').value=subject?.public?'public':'private';
  $('#delete-subject').hidden=!subject||member;$('#subject-error').textContent='';
  $('#subject-dialog-title').textContent=subject?'Subject settings':'New subject';
  if(subject)renderAccess(subject);
  $('#subject-dialog').showModal();$('#subject-name').focus();
}
$('#subject-form').onsubmit=event=>{
  event.preventDefault();const name=$('#subject-name').value.trim();const id=$('#subject-id').value;
  if(!name){$('#subject-error').textContent='Give your subject a name.';return;}
  if(state.subjects.some(s=>s.id!==id&&s.name.toLowerCase()===name.toLowerCase())){$('#subject-error').textContent='A subject with that name already exists.';return;}
  const existing=state.subjects.find(s=>s.id===id);
  if(existing?.role==='member')return;
  if(existing){const oldName=existing.name;existing.name=name;existing.public=$('#subject-public').value==='public';[...state.tasks,...state.notes].forEach(item=>{if(item.subject===oldName)item.subject=name;});}
  else state.subjects.push({id:crypto.randomUUID(),name,color:'#89a392',role:'owner',ownerName:localUsername(),members:[],inviteCode:crypto.randomUUID().slice(0,8).toUpperCase(),public:$('#subject-public').value==='public'});
  save();render();navigate();closeDialog($('#subject-dialog'));if(storageAvailable)toast(existing?'Subject updated.':'Subject created.');
};
$('#delete-subject').onclick=()=>{
  const subject=state.subjects.find(s=>s.id===$('#subject-id').value);if(!subject||subject.role==='member')return;
  $('#delete-subject-description').textContent=`Remove “${subject.name}” from your subjects?`;
  $('#delete-subject-dialog').showModal();
};
$('#confirm-delete-subject').onclick=()=>{
  const subject=state.subjects.find(s=>s.id===$('#subject-id').value);if(!subject||subject.role==='member')return;
  [...state.tasks,...state.notes].forEach(item=>{if(item.subject===subject.name)item.subject='';});
  state.subjects=state.subjects.filter(s=>s.id!==subject.id);activeSubject=null;
  save();closeDialog($('#delete-subject-dialog'));closeDialog($('#subject-dialog'));location.hash='subjects';render();navigate();
};
function renderDeadlines() {
  const tasks=state.tasks.filter(t=>!t.done).sort((a,b)=>a.date.localeCompare(b.date));
  $('#deadline-list').innerHTML=tasks.map(t=>`<button class="deadline-item" data-edit-task="${escapeHTML(t.id)}"><span><strong>${escapeHTML(t.title)}</strong><small>${escapeHTML(t.subject||'Unfiled')} · ${escapeHTML(t.kind)}</small></span><time class="due ${t.date<=offsetDate(1)?'soon':''}">${escapeHTML(dueLabel(t.date))}</time></button>`).join('') || '<p class="empty">No upcoming deadlines.</p>';
}
function closeDeadlines(){hidePanel($('#deadlines-popup'));$('#deadlines-toggle').setAttribute('aria-expanded','false');}
$('#deadlines-toggle').onclick=()=>{const open=$('#deadlines-popup').hidden;if(open)showPanel($('#deadlines-popup'));else closeDeadlines();$('#deadlines-toggle').setAttribute('aria-expanded',String(open));};
$('#deadlines-close').onclick=()=>{closeDeadlines();$('#deadlines-toggle').focus();};
document.addEventListener('click',event=>{if(!event.target.closest('.deadline-control'))closeDeadlines();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('#deadlines-popup').hidden){closeDeadlines();$('#deadlines-toggle').focus();}});
function renderCalendar() {
  const year=calendarDate.getFullYear(),month=calendarDate.getMonth();
  const monthEvents=state.tasks.filter(t=>t.date.startsWith(`${year}-${String(month+1).padStart(2,'0')}-`)).sort((a,b)=>a.date.localeCompare(b.date));
  $('#calendar-agenda').innerHTML='<h3>This month</h3>'+ (monthEvents.map(t=>`<button class="agenda-event ${t.done?'event-done':''}" data-edit-task="${escapeHTML(t.id)}" style="--event-color:${eventColor(t)}"><time>${new Date(t.date+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'})}</time><span><strong>${escapeHTML(t.title)}</strong><small>${escapeHTML(t.kind)} · ${escapeHTML(t.subject||'Unfiled')}</small></span></button>`).join('')||'<p class="empty">No events this month.</p>');
  $('#calendar-month').textContent=calendarDate.toLocaleDateString('en-GB',{month:'long',year:'numeric'});
  const start=new Date(year,month,1);start.setDate(start.getDate()-(start.getDay()+6)%7);
  const days=Array.from({length:42},(_,index)=>{const date=new Date(start);date.setDate(start.getDate()+index);return date;});
  $('#calendar-grid').innerHTML=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(day=>`<div class="weekday">${day}</div>`).join('')+days.map(date=>{
    const key=dateString(date);const events=state.tasks.filter(t=>t.date===key);
    return `<div class="calendar-cell ${date.getMonth()!==month?'outside-month':''} ${key===offsetDate(0)?'is-today':''}"><button class="calendar-day" data-calendar-day="${key}" aria-label="Add event on ${date.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}">${date.getDate()}</button>${events.map(t=>`<button style="--event-color:${eventColor(t)}" class="calendar-event ${t.done?'event-done':''}" data-edit-task="${escapeHTML(t.id)}" title="${escapeHTML(t.kind+': '+t.title)}"><span class="subject-dot" style="--subject-color:${subjectColor(t.subject)}"></span>${escapeHTML(t.title)}<small>${escapeHTML(t.kind)}</small></button>`).join('')}</div>`;
  }).join('');
}
$('#calendar-prev').onclick=()=>{calendarDate.setMonth(calendarDate.getMonth()-1);renderCalendar();};
$('#calendar-next').onclick=()=>{calendarDate.setMonth(calendarDate.getMonth()+1);renderCalendar();};
$('#calendar-today').onclick=()=>{calendarDate=new Date(new Date().getFullYear(),new Date().getMonth(),1);renderCalendar();};
function openImport(){
  $('#import-form').reset();updateSubjectOptions();$('#import-subject').value=activeSubject?.name||state.subjects[0]?.name||'';$('#import-error').textContent='';$('#import-dialog').showModal();
}
['#sidebar-import','#open-import','#import-library','#folder-import'].forEach(selector=>$(selector).onclick=openImport);
$('#folder-new').onclick=()=>openNote();
$('#import-form').onsubmit=async event=>{
  event.preventDefault();const files=[...$('#import-file').files];const subject=$('#import-subject').value;
  if(isSharedSubject(subject)){$('#import-error').textContent='This subject is read-only.';return;}
  if(!files.length)return;
  if(files.some(f=>! /\.(md|txt)$/i.test(f.name)||f.size>1024*1024)){$('#import-error').textContent='Use .txt or .md files under 1 MB each. Nothing was imported.';return;}
  $('#import-submit').disabled=true;
  try{
    const notes=await Promise.all(files.map(async file=>({id:crypto.randomUUID(),title:file.name.replace(/\.(md|txt)$/i,''),format:file.name.toLowerCase().endsWith('.txt')?'txt':'md',body:await file.text(),subject,updated:new Date().toISOString()})));
    state.notes.push(...notes);save();render();closeDialog($('#import-dialog'));if(storageAvailable)toast(`${notes.length} file${notes.length===1?'':'s'} imported.`);
  }catch{$('#import-error').textContent='A file could not be read. Try again.';}
  finally{$('#import-submit').disabled=false;}
};
$('#mini-toggle').onclick=()=>$('#focus-toggle').click();
$('#mini-reset').onclick=()=>$('#focus-reset').click();
const eventPalette = {sage:'#84b89a',blue:'#79a9e5',violet:'#b59ae7',rose:'#e696b3',orange:'#e9a55e',red:'#e78383'};
let selectedEventColor='sage';
function eventColor(task){return eventPalette[task.color]||({Exam:eventPalette.violet,Assignment:eventPalette.blue,'Study session':eventPalette.sage}[task.kind])||eventPalette.sage;}
function renderColorPicker(color){
  selectedEventColor=Object.hasOwn(eventPalette,color)?color:'sage';
  $('#event-colors').innerHTML=Object.entries(eventPalette).map(([name,value])=>`<label class="color-choice" style="--event-color:${value}"><input type="radio" name="event-color" value="${name}" aria-label="${name} event color" ${name===selectedEventColor?'checked':''}><span></span><small>${name}</small></label>`).join('');
}
$('#event-colors').addEventListener('change',event=>{if(Object.hasOwn(eventPalette,event.target.value))selectedEventColor=event.target.value;});
function taskUrgency(task){return task.done?'':task.date<offsetDate(0)?'task-overdue':task.date===offsetDate(1)?'task-tomorrow':'';}
function openDuration(){$('#focus-minutes').value=durationMinutes;$('#duration-dialog').showModal();$('#focus-minutes').focus();}
$('#timer').onclick=$('#mini-duration').onclick=openDuration;
$('#duration-form').onsubmit=event=>{
  event.preventDefault();const minutes=Number($('#focus-minutes').value);
  if(!Number.isInteger(minutes)||minutes<1||minutes>180)return;
  durationMinutes=minutes;$('#focus-reset').onclick();closeDialog($('#duration-dialog'));
};
function applyFontSize(size){
  const valid=[100,115,130,150].includes(Number(size))?Number(size):100;
  document.documentElement.style.setProperty('--font-scale',String(valid/100));
  $('#font-size').value=String(valid);$('#font-size-label').textContent=valid+'%';
  return valid;
}
$('#font-settings').onclick=()=>{setMobileMenu(false);$('#font-dialog').showModal();};
$('#font-form').onsubmit=event=>{
  event.preventDefault();const size=applyFontSize($('#font-size').value);
  try{localStorage.setItem('studyflow.fontSize',String(size));}catch{toast('Font size applied for this session.');}
  closeDialog($('#font-dialog'));
};
function initializePreferences(){try{applyFontSize(localStorage.getItem('studyflow.fontSize'));}catch{applyFontSize(100);}}
function motionEnabled(){return document.documentElement.dataset.theme!=='cs'&&!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;}
const closingAnimations=new WeakMap();
function animateOut(element,finish){
  if(closingAnimations.has(element))return;
  if(!motionEnabled()||!element.animate){finish();return;}
  const animation=element.animate([{opacity:1,transform:'translateY(0) scale(1)'},{opacity:0,transform:'translateY(8px) scale(.98)'}],{duration:150,easing:'ease-in',fill:'forwards'});
  closingAnimations.set(element,animation);
  animation.finished.then(()=>{finish();animation.cancel();closingAnimations.delete(element);}).catch(()=>{});
}
function closeDialog(dialog){if(dialog.open)animateOut(dialog,()=>dialog.close());}
function hidePanel(panel){if(!panel.hidden)animateOut(panel,()=>panel.hidden=true);}
function showPanel(panel){const animation=closingAnimations.get(panel);if(animation){animation.cancel();closingAnimations.delete(panel);}panel.hidden=false;}
$$('dialog').forEach(dialog=>dialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog(dialog);}));
function setMobileMenu(open){
  const panel=$('#appearance-panel');
  if(open){showPanel(panel);panel.classList.add('mobile-open');showPanel($('#mobile-dismiss'));}
  else if(panel.classList.contains('mobile-open')){animateOut(panel,()=>panel.classList.remove('mobile-open'));$('#mobile-dismiss').hidden=true;}
  $('#mobile-more').setAttribute('aria-expanded',String(open));
}
$('#mobile-more').onclick=()=>setMobileMenu($('#mobile-more').getAttribute('aria-expanded')!=='true');
$('#mobile-dismiss').onclick=()=>setMobileMenu(false);
$('#mobile-import').onclick=()=>{setMobileMenu(false);openImport();};
document.addEventListener('keydown',event=>{if(event.key==='Escape')setMobileMenu(false);});
try{acrylicDark=localStorage.getItem('studyflow.acrylicDark')!=='false';const theme=localStorage.getItem('studyflow.theme');setTheme(['cs','dark','glass'].includes(theme)?theme:'dark');}catch{setTheme('dark');}
function localUsername(){try{return JSON.parse(localStorage.getItem('studyflow.demoSession'))?.username||'Student';}catch{return 'Student';}}
function isSharedSubject(name){return !!name&&state.subjects.some(s=>s.name===name&&s.role==='member');}
function renderAccess(subject){
  $('#subject-code').value=subject.inviteCode;
  $('#invite-section').hidden=$('#subject-public').value!=='public';
  $('#subject-members').innerHTML=subject.members.map(member=>`<div class="access-member"><div><strong>${escapeHTML(member.name)}</strong><small>Read-only member</small></div><button type="button" class="button danger" data-revoke-member="${escapeHTML(member.id)}">Remove access</button></div>`).join('')||'<p class="sharing-help">Only you have access.</p>';
}
$('#subject-public').onchange=()=>{$('#invite-section').hidden=$('#subject-public').value!=='public';};
$('#personal-tab').onclick=()=>{subjectTab='personal';renderSubjects();};
$('#shared-tab').onclick=()=>{subjectTab='shared';renderSubjects();};
$('#folder-settings').onclick=()=>{if(activeSubject)openSubject(activeSubject.id);};
$('#join-subject').onclick=()=>{$('#join-code').value='';$('#join-error').textContent='';$('#join-dialog').showModal();$('#join-code').focus();};
$('#join-form').onsubmit=event=>{
  event.preventDefault();const code=$('#join-code').value.trim().toUpperCase();
  if(state.subjects.some(s=>s.inviteCode===code)){$('#join-error').textContent='This subject is already in your workspace.';return;}
  if(code!=='STUDY-DEMO'){$('#join-error').textContent='Code not found in this local preview. Try STUDY-DEMO.';return;}
  if(state.subjects.some(s=>s.name==='Shared study group')){$('#join-error').textContent='A subject with this name already exists.';return;}
  const subject={id:crypto.randomUUID(),name:'Shared study group',role:'member',ownerName:'Alex Morgan',color:'#b59ae7',public:true,inviteCode:code,members:[]};
  state.subjects.push(subject);
  state.notes.push({id:crypto.randomUUID(),title:'Welcome to the study group',subject:subject.name,body:'# Welcome\n\nThis is Alex’s shared collection.\n\nMembers can read and download these notes. Your membership stays saved in this browser until you leave.\n\nReal owner updates and revocation will be connected through Django.',format:'md',updated:new Date().toISOString()});
  subjectTab='shared';save();render();closeDialog($('#join-dialog'));location.hash='subjects';navigate();
};
let pendingAccessAction=null;
function confirmAccess(title,description,action){$('#access-confirm-title').textContent=title;$('#access-confirm-description').textContent=description;pendingAccessAction=action;$('#access-confirm-dialog').showModal();}
$('#access-confirm').onclick=()=>{const action=pendingAccessAction;pendingAccessAction=null;if(action)action();closeDialog($('#access-confirm-dialog'));};
$('#leave-subject').onclick=()=>{
  const subject=state.subjects.find(s=>s.id===$('#subject-id').value);if(subject?.role!=='member')return;
  confirmAccess('Leave this subject?',`“${subject.name}” will leave your Shared tab. ${subject.ownerName} keeps the original files. You’ll need a valid invitation to rejoin.`,()=>{
    state.subjects=state.subjects.filter(s=>s.id!==subject.id);state.notes=state.notes.filter(n=>n.subject!==subject.name);
    state.tasks.forEach(t=>{if(t.subject===subject.name)t.subject='';});activeSubject=null;subjectTab='shared';
    save();render();closeDialog($('#subject-dialog'));location.hash='subjects';navigate();
  });
};
function confirmRevokeMember(memberId){
  const subject=state.subjects.find(s=>s.id===$('#subject-id').value);if(subject?.role!=='owner')return;
  const member=subject.members.find(m=>m.id===memberId);if(!member)return;
  confirmAccess('Remove access?',`${member.name} will lose membership in “${subject.name}”. Other members keep their access.`,()=>{subject.members=subject.members.filter(m=>m.id!==memberId);save();renderSubjects();renderAccess(subject);});
}
$('#rotate-code').onclick=()=>{
  const subject=state.subjects.find(s=>s.id===$('#subject-id').value);if(subject?.role!=='owner')return;
  confirmAccess('Reset invitation code?','The old code will stop accepting new members. Existing members keep access.',()=>{subject.inviteCode=crypto.randomUUID().slice(0,8).toUpperCase();save();renderAccess(subject);});
};
$('#demo-member').onclick=()=>{
  const subject=state.subjects.find(s=>s.id===$('#subject-id').value);if(subject?.role!=='owner')return;
  if(subject.members.some(m=>m.demo)){toast('The demo member is already in this subject.');return;}
  subject.members.push({id:crypto.randomUUID(),name:'Taylor (demo)',demo:true});save();renderSubjects();renderAccess(subject);
};
initializePreferences();hydrateIcons();render();navigate();
