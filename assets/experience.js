'use strict';

// Visual timer effects use the actual clock's screen position. Nothing blocks input.
let expiryTimeout;
let expiryGeneration=0;
let timerEffects=[];
function clockElement(){return currentView==='dashboard'&&!document.body.classList.contains('auth-active')?$('#timer'):$('#mini-focus');}
function clearTimerEffects(){
  clearTimeout(expiryTimeout);expiryGeneration++;
  timerEffects.forEach(animation=>animation.cancel());timerEffects=[];
  $('#timer-expiry').hidden=true;$('#timer-particles').replaceChildren();
}
function energizeClock(){
  clearTimerEffects();
  if(!motionEnabled())return;
  const clock=clockElement();
  const glow=clock.animate([
    {boxShadow:'0 0 0 0 rgba(149,214,177,0)',filter:'brightness(1)'},
    {boxShadow:'0 0 36px 8px rgba(149,214,177,.32)',filter:'brightness(1.22)',offset:.25},
    {boxShadow:'0 0 0 26px rgba(149,214,177,0)',filter:'brightness(1)',offset:.5},
    {boxShadow:'0 0 30px 6px rgba(149,214,177,.25)',filter:'brightness(1.15)',offset:.7},
    {boxShadow:'0 0 0 35px rgba(149,214,177,0)',filter:'brightness(1)'}
  ],{duration:2000,easing:'ease-out'});
  timerEffects.push(glow);
  const rect=clock.getBoundingClientRect();
  for(let i=0;i<3;i++){
    const ring=document.createElement('span');ring.className='clock-energy-ring';
    Object.assign(ring.style,{left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px'});
    $('#timer-particles').append(ring);
    const animation=ring.animate([{opacity:0,transform:'scale(.96)'},{opacity:.65,offset:.15},{opacity:0,transform:'scale(1.7)'}],{duration:1300,delay:i*230,easing:'ease-out',fill:'both'});
    timerEffects.push(animation);animation.finished.then(()=>ring.remove()).catch(()=>ring.remove());
  }
}
function timerExpired(){
  clearTimerEffects();const generation=expiryGeneration;
  const notice=$('#timer-expiry');
  const rect=clockElement().getBoundingClientRect();
  const visible=rect.width>0&&rect.height>0&&rect.bottom>0&&rect.top<innerHeight;
  const originX=visible?rect.left+rect.width/2:innerWidth-50;
  const originY=visible?rect.top+rect.height/2:60;
  const dx=originX-innerWidth/2,dy=originY-innerHeight/2;
  notice.hidden=false;
  if(motionEnabled())timerEffects.push(notice.animate([
    {opacity:0,transform:`translate(${dx}px,${dy}px) scale(.12)`},
    {opacity:1,transform:'translate(0,0) scale(1.04)',offset:.8},
    {opacity:1,transform:'translate(0,0) scale(1)'}
  ],{duration:600,easing:'cubic-bezier(.16,1,.3,1)',fill:'both'}));
  expiryTimeout=setTimeout(()=>{
    if(generation!==expiryGeneration)return;
    if(!motionEnabled()){notice.hidden=true;return;}
    burstParticles(innerWidth/2,innerHeight/2);
    const returning=notice.animate([
      {opacity:1,transform:'translate(0,0) scale(1)'},
      {opacity:.7,transform:'translate(0,0) scale(1.12)',offset:.15},
      {opacity:0,transform:`translate(${dx}px,${dy}px) scale(.05)`}
    ],{duration:650,easing:'cubic-bezier(.6,0,.4,1)',fill:'forwards'});
    timerEffects.push(returning);
    returning.finished.then(()=>{if(generation===expiryGeneration)notice.hidden=true;}).catch(()=>{});
  },3000);
}
function burstParticles(x,y){
  const colors=['#9dc5ac','#dfefc7','#a0cddd','#d9baf0'];
  for(let i=0;i<44;i++){
    const particle=document.createElement('span');particle.className='timer-particle';
    const angle=Math.random()*Math.PI*2,distance=70+Math.random()*160,size=2+Math.random()*5;
    Object.assign(particle.style,{left:x+'px',top:y+'px',width:size+'px',height:size+'px',background:colors[i%colors.length]});
    $('#timer-particles').append(particle);
    const animation=particle.animate([
      {opacity:1,transform:'translate(0,0) scale(1)'},
      {opacity:0,transform:`translate(${Math.cos(angle)*distance}px,${Math.sin(angle)*distance}px) scale(0)`}
    ],{duration:650+Math.random()*300,easing:'cubic-bezier(.1,.7,.3,1)',fill:'forwards'});
    timerEffects.push(animation);animation.finished.then(()=>particle.remove()).catch(()=>particle.remove());
  }
}

// Deliberately a UI demo: credentials are validated for form UX, never persisted or sent.
let authMode='login';
function renderAuth(mode){
  authMode=mode;const registering=mode==='register';
  $('#auth-form').reset();$('#auth-error').textContent='';
  $('#auth-title').textContent=registering?'A fresh start.':'Welcome back.';
  $('#auth-subtitle').textContent=registering?'Make a little room for what comes next.':'Your notes. Your pace. Your next small win.';
  $('#register-name-field').hidden=!registering;$('#auth-name').required=registering;
  $('#confirm-password-field').hidden=!registering;$('#auth-confirm').required=registering;
  $('#auth-password').autocomplete=registering?'new-password':'current-password';
  $('#auth-submit').innerHTML=(registering?'Create demo profile':'Sign in to demo')+' '+icon('arrow');
  ['login','register'].forEach(tab=>{const link=$('#'+tab+'-tab');link.classList.toggle('active',tab===mode);if(tab===mode)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  $('#auth-theme').textContent=document.documentElement.dataset.theme==='cs'?'Switch to acrylic':'Switch light / dark';
}
function updateUsername(username){
  $('#account-name').textContent=username;
  $('.workspace-icon').textContent=username.slice(0,1).toUpperCase();
}
$('#auth-form').onsubmit=event=>{
  event.preventDefault();
  const name=authMode==='register'?$('#auth-name').value.trim():$('#auth-email').value.split('@')[0];
  if(!name){$('#auth-error').textContent='Please enter a username.';return;}
  if(authMode==='register'&&$('#auth-password').value!==$('#auth-confirm').value){$('#auth-error').textContent='The passwords don’t match yet.';$('#auth-confirm').focus();return;}
  demoSession={username:name};
  try{localStorage.setItem('studyflow.demoSession',JSON.stringify(demoSession));}catch{toast('Browser storage is unavailable. Login is remembered only in this tab.');}
  updateUsername(name);$('#auth-form').reset();location.hash='dashboard';navigate();
};
function logout(){
  demoSession=null;
  try{localStorage.removeItem('studyflow.demoSession');}catch{}
  clearTimerEffects();$('#focus-reset').onclick();setMobileMenu(false);updateUsername('Student');
  location.hash='login';navigate();
}
document.addEventListener('click',event=>{if(event.target.closest('[data-logout]'))logout();});
const mobileLogout=document.createElement('button');
mobileLogout.id='mobile-logout';mobileLogout.className='theme-switch';mobileLogout.setAttribute('data-logout','');
mobileLogout.innerHTML=icon('logout')+'<span>Log out</span>';
$('#appearance-panel').append(mobileLogout);
$('#auth-theme').onclick=()=>{rememberTheme(document.documentElement.dataset.theme==='dark'?'glass':'dark');$('#auth-theme').textContent='Switch light / dark';};
if(demoSession)updateUsername(demoSession.username);
window.addEventListener('storage',event=>{
  if(event.key!=='studyflow.demoSession'&&event.key!==null)return;
  demoSession=readDemoSession();
  if(!demoSession){
    clearTimerEffects();$('#focus-reset').onclick();
    $$('dialog[open]').forEach(dialog=>dialog.close());
    setMobileMenu(false);updateUsername('Student');
  }else updateUsername(demoSession.username);
  navigate();
});
if(['login','register'].includes(location.hash.slice(1)))renderAuth(location.hash.slice(1));
