// Local state workflow checks, without browser dependencies.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { webcrypto } = require('node:crypto');
const html = fs.readFileSync('index.html','utf8');
const code = fs.readFileSync('assets/app.js','utf8');

function app(saved,session={username:'Student'},hash='#dashboard') {
  const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([,id])=>['#'+id,{
    value:'',innerHTML:'',textContent:'',hidden:false,disabled:false,files:[],dataset:{},attrs:{},classList:{toggle(){},contains(){return false;},add(){},remove(){}},
    setAttribute(name,value){this.attrs[name]=value;},removeAttribute(name){delete this.attrs[name];},
    addEventListener(name,fn){this['on'+name]=fn;},showModal(){this.open=true;},close(){this.open=false;},focus(){},reset(){},
  }]));
  elements.set('meta[name="theme-color"]',{});
  elements.get('#task-filter').value='all';
  const storage=new Map(saved?[['studyflow.workspace.v1',JSON.stringify(saved)]]:[]);
  if(session!==null)storage.set('studyflow.demoSession',JSON.stringify(session));
  const context=vm.createContext({
    document:{body:{classList:{toggle(){}}},documentElement:{dataset:{},style:{setProperty(){}}},querySelector:s=>{if(!elements.has(s))throw Error('Missing selector '+s);return elements.get(s);},querySelectorAll:()=>[],addEventListener(){}},
    window:{addEventListener(){}},location:{hash,replace(value){this.hash=value;}},
    localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},
    structuredClone,Date,Blob,crypto:webcrypto,setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){},URL,
  });
  vm.runInContext(code,context);
  return {elements,storage,run:script=>vm.runInContext(script,context)};
}
const submit={preventDefault(){}};

test('fresh visitors and malformed sessions require login even on direct workspace links',()=>{
  for(const session of [null,{}, {username:''},{username:'   '}]){
    const a=app(undefined,session,'#notes');
    assert.equal(a.run('location.hash'),'#login');assert.equal(a.elements.get('#auth-view').hidden,false);
    a.run("location.hash='#subjects';navigate()");assert.equal(a.run('location.hash'),'#login');
  }
  const register=app(undefined,null,'#register');assert.equal(register.run('location.hash'),'#register');
});

test('remembered login opens workspace and skips sign-in; clearing session restores the gate',()=>{
  const a=app(undefined,{username:'Sam'},'#login');
  assert.equal(a.run('location.hash'),'#dashboard');assert.equal(a.elements.get('#auth-view').hidden,true);
  const nextTab=app(undefined,{username:'Sam'},'#notes');assert.equal(nextTab.run('location.hash'),'#notes');
  nextTab.run("demoSession=null;navigate()");assert.equal(nextTab.run('location.hash'),'#login');
});

test('joined subjects persist, stay read-only, and can be left without touching personal notes',()=>{
  const a=app(),e=a.elements;
  e.get('#join-code').value='STUDY-DEMO';e.get('#join-form').onsubmit(submit);
  assert.equal(a.run("state.subjects.filter(s=>s.role==='member').length"),1);
  const joinedId=a.run("state.subjects.find(s=>s.role==='member').id");
  const reloaded=app(JSON.parse(a.storage.get('studyflow.workspace.v1')));
  assert.equal(reloaded.run("state.subjects.find(s=>s.role==='member').ownerName"),'Alex Morgan');
  a.run(`openSubject('${joinedId}')`);
  assert.equal(e.get('#save-subject').hidden,true);assert.equal(e.get('#leave-subject').hidden,false);
  a.run("openNote(state.notes.find(n=>n.subject==='Shared study group').id)");
  assert.equal(e.get('#note-body').readOnly,true);assert.equal(e.get('#save-note').hidden,true);
  const body=a.run("state.notes.find(n=>n.subject==='Shared study group').body");
  e.get('#note-body').value='Overwrite';e.get('#note-form').onsubmit(submit);
  assert.equal(a.run("state.notes.find(n=>n.subject==='Shared study group').body"),body);
  e.get('#join-form').onsubmit(submit);assert.equal(a.run('state.subjects.length'),5);
  e.get('#leave-subject').onclick();e.get('#access-confirm').onclick();
  assert.equal(a.run('state.subjects.length'),4);assert.equal(a.run('state.notes.length'),3);
});

test('owner can revoke membership; closing invitations and rotating codes preserve other members',()=>{
  const a=app(),e=a.elements;a.run("openSubject('s0')");
  e.get('#demo-member').onclick();assert.equal(a.run('state.subjects[0].members.length'),1);
  e.get('#subject-public').value='private';e.get('#subject-form').onsubmit(submit);
  assert.equal(a.run('state.subjects[0].members.length'),1);
  const oldCode=a.run('state.subjects[0].inviteCode');
  e.get('#rotate-code').onclick();e.get('#access-confirm').onclick();
  assert.notEqual(a.run('state.subjects[0].inviteCode'),oldCode);assert.equal(a.run('state.subjects[0].members.length'),1);
  a.run('confirmRevokeMember(state.subjects[0].members[0].id)');e.get('#access-confirm').onclick();
  assert.equal(a.run('state.subjects[0].members.length'),0);assert.equal(a.run('state.notes.length'),3);
});

test('custom timer duration resets correctly and font preference is saved',()=>{
  const a=app(),e=a.elements;
  e.get('#focus-minutes').value='40';e.get('#duration-form').onsubmit(submit);
  assert.equal(e.get('#mini-time').textContent,'40:00');
  e.get('#focus-toggle').onclick();assert.ok(a.run('timerEnd > 0'));
  e.get('#focus-reset').onclick();assert.equal(a.run('remaining'),2400);assert.equal(a.run('timerEnd'),null);
  e.get('#focus-minutes').value='0';e.get('#duration-form').onsubmit(submit);assert.equal(a.run('durationMinutes'),40);
  e.get('#font-size').value='130';e.get('#font-form').onsubmit(submit);
  assert.equal(a.storage.get('studyflow.fontSize'),'130');
  a.run("applyFontSize(100); initializePreferences()");assert.equal(e.get('#font-size-label').textContent,'130%');
});

test('New subject is limited to overview, notes library and subjects',()=>{
  const a=app();
  for(const view of ['dashboard','notes','subjects','tasks','calendar','subject/s0']){
    a.run(`location.hash='#${view}';navigate()`);
    assert.equal(a.elements.get('#new-subject').hidden,!['dashboard','notes','subjects'].includes(view));
  }
  a.run("demoSession=null;location.hash='#register';navigate()");assert.equal(a.elements.get('#auth-view').hidden,false);
});

test('event colors persist and urgency ignores completed tasks',()=>{
  const a=app(),e=a.elements;
  a.run("openTask('t1')");e.get('#event-colors').onchange({target:{value:'rose'}});
  e.get('#task-form').onsubmit(submit);
  assert.equal(a.run("state.tasks.find(t=>t.id==='t1').color"),'rose');
  assert.match(e.get('#calendar-grid').innerHTML,/#e696b3/);
  assert.equal(a.run("taskUrgency({done:false,date:offsetDate(-1)})"),'task-overdue');
  assert.equal(a.run("taskUrgency({done:false,date:offsetDate(1)})"),'task-tomorrow');
  assert.equal(a.run("taskUrgency({done:true,date:offsetDate(-1)})"),'');
});

test('existing notes migrate; subject rename and removal preserve attached work',()=>{
  const saved={tasks:[{id:'t',title:'Exam',subject:'Microeconomics',date:'2026-11-12',kind:'Exam',done:false}],notes:[{id:'n',title:'Existing',subject:'Microeconomics',body:'Keep this',updated:'2026-11-08T00:00:00Z'}]};
  const a=app(saved),e=a.elements;
  assert.equal(a.run('state.notes[0].format'),'md');
  a.run("openSubject('s0')");e.get('#subject-name').value='Economics';
  e.get('#subject-form').onsubmit(submit);
  assert.equal(a.run('state.notes[0].subject'),'Economics');
  assert.equal(a.run('state.tasks[0].subject'),'Economics');
  const reloaded=app(JSON.parse(a.storage.get('studyflow.workspace.v1')));
  assert.equal(reloaded.run('state.subjects[0].name'),'Economics');
  e.get('#confirm-delete-subject').onclick();
  assert.equal(a.run('state.notes[0].body'),'Keep this');
  assert.equal(a.run('state.notes[0].subject'),'');
  assert.equal(a.run('state.tasks[0].subject'),'');
  a.run("openNote('n')");assert.equal(e.get('#note-subject').value,'');
});

test('multiple txt and md imports stay in one subject, preserve content and escape filenames',async()=>{
  const a=app(),e=a.elements;
  e.get('#import-subject').value='Databases';
  e.get('#import-file').files=[
    {name:'<lesson>.txt',size:20,text:async()=>'<script>plain text</script>'},
    {name:'Second.md',size:20,text:async()=>'# Another lesson'},
  ];
  await e.get('#import-form').onsubmit(submit);
  assert.equal(a.run("state.notes.filter(n=>n.subject==='Databases').length"),3);
  assert.equal(a.run('state.notes.at(-2).format'),'txt');
  assert.equal(a.run('state.notes.at(-1).format'),'md');
  const table=a.run("fileTable(state.notes.filter(n=>n.subject==='Databases'))");
  assert.match(table,/&lt;lesson&gt;\.txt/);
  assert.match(table,/Second\.md/);
  assert.equal(a.run('state.notes.at(-2).body'),'<script>plain text</script>');
  const count=a.run('state.notes.length');
  e.get('#import-file').files=[{name:'bad.pdf',size:1,text:async()=>''}];
  await e.get('#import-form').onsubmit(submit);
  assert.equal(a.run('state.notes.length'),count);
});

test('calendar date prefills the event; duplicate subjects are rejected; dark theme survives CS toggle',()=>{
  const a=app(),e=a.elements;
  a.run("openTask(null,'2026-12-31')");assert.equal(e.get('#task-date').value,'2026-12-31');
  e.get('#subject-name').value='microeconomics';e.get('#subject-public').value='private';
  e.get('#subject-form').onsubmit(submit);
  assert.equal(a.run('state.subjects.length'),4);assert.match(e.get('#subject-error').textContent,/already exists/);
  a.run("rememberTheme('dark')");e.get('#theme-switch').onclick();
  assert.equal(a.run('document.documentElement.dataset.theme'),'cs');
  e.get('#theme-switch').onclick();assert.equal(a.run('document.documentElement.dataset.theme'),'dark');
  assert.equal(a.storage.get('studyflow.theme'),'dark');
});
