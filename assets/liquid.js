'use strict';

// Liquid glass motion layer. Purely presentational: it reads the DOM that app.js renders
// and only writes state in one place (saving a new subject order after a drag).
// Disabled for the Counter-Strike theme and reduced-motion via motionEnabled().
(()=>{
  const root=document.documentElement;
  const linearEasing=window.CSS?.supports?.('animation-timing-function','linear(0,1)');
  const cssEasing=name=>linearEasing&&getComputedStyle(root).getPropertyValue(name).trim();
  const SPRING=cssEasing('--spring')||'cubic-bezier(.34,1.56,.64,1)';
  const SPRING_SOFT=cssEasing('--spring-soft')||'cubic-bezier(.22,1.2,.36,1)';
  const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));

  /* ---------- Selection pill that stretches as it flows between items ---------- */
  const indicators=[];
  function addIndicator(container,activeSelector,line=false){
    if(!container)return;
    const pill=document.createElement('span');
    pill.className='liquid-indicator'+(line?' liquid-line':'');pill.setAttribute('aria-hidden','true');
    container.prepend(pill);
    indicators.push({container,activeSelector,line,pill,rect:null,animation:null});
  }
  function placeIndicator(indicator,animate=true){
    const {container,pill,line}=indicator;
    const active=container.querySelector(indicator.activeSelector);
    const box=container.getBoundingClientRect(),r=active?.getBoundingClientRect();
    if(!r||!r.width||!box.width||root.dataset.theme==='cs'){pill.style.opacity='0';indicator.rect=null;return;}
    const next={left:r.left-box.left-container.clientLeft,top:(line?r.bottom-2:r.top)-box.top-container.clientTop,width:r.width,height:line?2:r.height};
    const prev=indicator.rect;indicator.rect=next;
    const px=rect=>({left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px'});
    Object.assign(pill.style,px(next),{opacity:'1'});
    if(!prev||!animate||!motionEnabled())return;
    const dx=next.left-prev.left,dy=next.top-prev.top,distance=Math.hypot(dx,dy);
    if(distance<1&&Math.abs(next.width-prev.width)<1)return;
    // Halfway there the pill is longer along its direction of travel and thinner across it.
    const horizontal=Math.abs(dx)>=Math.abs(dy),stretch=Math.min(distance*.4,46),squeeze=line?0:6;
    const width=(prev.width+next.width)/2+(horizontal?stretch:-squeeze),height=(prev.height+next.height)/2+(horizontal?-squeeze:stretch);
    const mid={left:(prev.left+prev.width/2+next.left+next.width/2)/2-width/2,top:(prev.top+prev.height/2+next.top+next.height/2)/2-height/2,width,height};
    indicator.animation?.cancel();
    indicator.animation=pill.animate([{...px(prev),easing:'cubic-bezier(.5,0,.8,.6)'},{...px(mid),offset:.3,easing:SPRING},px(next)],{duration:640});
  }
  const placeAll=animate=>indicators.forEach(indicator=>placeIndicator(indicator,animate));

  /* ---------- Views arrive as a staggered, springy cascade ---------- */
  function cascade(){
    if(!motionEnabled()||document.body.classList.contains('auth-active'))return;
    const view=$('.view:not([hidden])');if(!view)return;
    const items=[$('.page-heading>div'),...view.querySelectorAll('.glass,.task-row,.library-toolbar,.subjects-toolbar')].filter(Boolean);
    items.forEach((item,index)=>item.animate([{opacity:0,transform:'translateY(20px) scale(.96)'},{opacity:1,transform:'none'}],{duration:700,delay:Math.min(index,9)*45,easing:SPRING_SOFT,fill:'backwards'}));
  }

  /* ---------- Glass catches the light under the pointer ---------- */
  let glowTarget=null,glowEvent=null,glowFrame=0;
  function clearGlow(){glowTarget?.style.removeProperty('--glow');glowTarget=null;}
  document.addEventListener('pointermove',event=>{
    if(event.pointerType==='touch')return;
    glowEvent=event;
    if(glowFrame)return;
    glowFrame=requestAnimationFrame(()=>{
      glowFrame=0;
      const glass=root.dataset.theme==='cs'?null:glowEvent.target.closest?.('.glass');
      if(glass!==glowTarget){clearGlow();glowTarget=glass;glass?.style.setProperty('--glow','1');}
      if(!glass)return;
      const r=glass.getBoundingClientRect();
      glass.style.setProperty('--mx',(glowEvent.clientX-r.left)+'px');glass.style.setProperty('--my',(glowEvent.clientY-r.top)+'px');
    });
  },{passive:true});
  root.addEventListener('pointerleave',clearGlow);

  /* ---------- Cards you can pick up ----------
     Each dragged card is three damped springs (x, y, scale) stepped every frame. Its speed
     stretches and tilts it, so it behaves like a soft blob instead of a rigid box.
     Subject cards move freely and reorder their neighbours; note cards are held back by a
     rubber band and snap home. */
  const DRAGGABLE='.note-card,.subject-card';
  const simulations=new WeakMap(),flips=new WeakMap();
  let drag=null;
  const spring=value=>({x:value,v:0,target:value});
  function step(s,stiffness,damping,dt){s.v+=(-stiffness*(s.x-s.target)-damping*s.v)*dt;s.x+=s.v*dt;}
  const rubber=distance=>Math.sign(distance)*130*(1-1/(Math.abs(distance)*.55/130+1));

  function beginDrag(){
    const {card}=drag;clearTimeout(drag.timer);
    const sim={card,slot:card.closest('#subject-list>*'),free:card.matches('.subject-card'),held:true,moved:false,originX:drag.startX,originY:drag.startY,pointerX:drag.x,pointerY:drag.y,x:spring(0),y:spring(0),scale:spring(1)};
    sim.scale.target=1.05;drag.active=true;drag.sim=sim;simulations.set(card,sim);
    card.classList.add('liquid-dragging');sim.slot?.classList.add('liquid-slot');document.body.classList.add('liquid-grabbing');
    getSelection()?.removeAllRanges();
    if(drag.type==='touch')navigator.vibrate?.(8);
    let last=performance.now();
    const frame=now=>{
      if(!card.isConnected){endSimulation(sim);return;}
      const dt=Math.min((now-last)/1000,.032)/2;last=now;
      if(sim.held){
        const dx=sim.pointerX-sim.originX,dy=sim.pointerY-sim.originY;
        sim.x.target=sim.free?dx:rubber(dx);sim.y.target=sim.free?dy:rubber(dy);
        if(sim.free)reorder(sim);
      }
      // Tight while held so it tracks the pointer; loose after release so it wobbles home.
      const stiffness=sim.held?520:230,damping=sim.held?34:15;
      for(let i=0;i<2;i++){step(sim.x,stiffness,damping,dt);step(sim.y,stiffness,damping,dt);step(sim.scale,300,sim.held?22:15,dt);}
      const stretch=clamp((Math.abs(sim.x.v)-Math.abs(sim.y.v))/9000,-.08,.08),tilt=clamp(sim.x.v/170,-6,6);
      card.style.transform=`translate3d(${sim.x.x.toFixed(2)}px,${sim.y.x.toFixed(2)}px,0) rotate(${tilt.toFixed(2)}deg) scale(${(sim.scale.x*(1+stretch)).toFixed(4)},${(sim.scale.x*(1-stretch)).toFixed(4)})`;
      const resting=!sim.held&&Math.abs(sim.x.x)<.3&&Math.abs(sim.y.x)<.3&&Math.abs(sim.x.v)<5&&Math.abs(sim.y.v)<5&&Math.abs(sim.scale.x-1)<.003;
      if(resting)endSimulation(sim);else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
  function endSimulation(sim){
    sim.card.style.transform='';sim.card.classList.remove('liquid-dragging');sim.slot?.classList.remove('liquid-slot');
    simulations.delete(sim.card);
  }
  // When the dragged card's centre enters a neighbour's slot, take that slot and let the
  // neighbours spring into their new places (FLIP).
  function reorder(sim){
    const {slot}=sim,list=slot?.parentElement,parent=slot?.offsetParent;if(!list||!parent)return;
    const parentBox=parent.getBoundingClientRect(),left=parentBox.left+parent.clientLeft,top=parentBox.top+parent.clientTop;
    const cardBox=sim.card.getBoundingClientRect(),cx=cardBox.left+cardBox.width/2,cy=cardBox.top+cardBox.height/2;
    const target=[...list.children].find(other=>other!==slot&&other.querySelector('.subject-card')&&cx>left+other.offsetLeft&&cx<left+other.offsetLeft+other.offsetWidth&&cy>top+other.offsetTop&&cy<top+other.offsetTop+other.offsetHeight);
    if(!target)return;
    const others=[...list.children].filter(other=>other!==slot);
    const before=new Map(others.map(other=>[other,other.getBoundingClientRect()]));
    const oldLeft=slot.offsetLeft,oldTop=slot.offsetTop;
    const reference=slot.compareDocumentPosition(target)&Node.DOCUMENT_POSITION_FOLLOWING?target.nextSibling:target;
    if(list.moveBefore)list.moveBefore(slot,reference);else list.insertBefore(slot,reference);
    // The slot's layout position changed: shift the spring so the card stays under the pointer.
    const shiftX=slot.offsetLeft-oldLeft,shiftY=slot.offsetTop-oldTop;
    sim.originX+=shiftX;sim.originY+=shiftY;sim.x.x-=shiftX;sim.y.x-=shiftY;sim.moved=true;
    others.forEach(other=>{
      flips.get(other)?.cancel();
      const from=before.get(other),to=other.getBoundingClientRect(),dx=from.left-to.left,dy=from.top-to.top;
      if(dx||dy)flips.set(other,other.animate([{transform:`translate(${dx}px,${dy}px)`},{transform:'none'}],{duration:560,easing:SPRING_SOFT}));
    });
  }
  function saveSubjectOrder(list){
    const ids=[...list.querySelectorAll('[data-subject-settings]')].map(button=>button.dataset.subjectSettings);
    const moved=ids.map(id=>state.subjects.find(subject=>subject.id===id));
    if(moved.includes(undefined))return;
    let next=0;
    state.subjects=state.subjects.map(subject=>ids.includes(subject.id)?moved[next++]:subject);
    save();updateSubjectOptions();
  }
  function endDrag(event){
    if(!drag||event.pointerId!==drag.id)return;
    clearTimeout(drag.timer);
    const {sim}=drag;drag=null;
    if(!sim)return;
    sim.held=false;sim.x.target=sim.y.target=0;sim.scale.target=1;
    document.body.classList.remove('liquid-grabbing');
    if(sim.moved&&sim.slot?.parentElement)saveSubjectOrder(sim.slot.parentElement);
    // The release must not also count as a click on the card.
    const swallow=click=>{click.stopPropagation();click.preventDefault();};
    window.addEventListener('click',swallow,true);setTimeout(()=>window.removeEventListener('click',swallow,true),60);
  }
  document.addEventListener('pointerdown',event=>{
    if(drag||!event.isPrimary||(event.pointerType==='mouse'&&event.button!==0)||!motionEnabled())return;
    const card=event.target.closest?.(DRAGGABLE);
    if(!card||simulations.has(card))return;
    drag={card,id:event.pointerId,type:event.pointerType,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,active:false,sim:null,timer:0};
    // Touch uses press-and-hold, like rearranging a home screen, so scrolling still works.
    if(event.pointerType==='touch')drag.timer=setTimeout(()=>{if(drag&&!drag.active)beginDrag();},260);
  });
  document.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.id)return;
    drag.x=event.clientX;drag.y=event.clientY;
    if(drag.active){drag.sim.pointerX=drag.x;drag.sim.pointerY=drag.y;return;}
    const distance=Math.hypot(drag.x-drag.startX,drag.y-drag.startY);
    if(drag.type==='touch'){if(distance>10){clearTimeout(drag.timer);drag=null;}}
    else if(distance>6)beginDrag();
  });
  document.addEventListener('pointerup',endDrag);
  document.addEventListener('pointercancel',endDrag);
  document.addEventListener('touchmove',event=>{if(drag?.active&&event.cancelable)event.preventDefault();},{passive:false});
  document.addEventListener('contextmenu',event=>{if(drag?.type==='touch')event.preventDefault();});
  document.addEventListener('dragstart',event=>{if(event.target.closest?.(DRAGGABLE))event.preventDefault();});

  /* ---------- Small moments ---------- */
  // A completed task's checkbox pops (app.js has already re-rendered the list by now).
  document.addEventListener('change',event=>{
    const id=event.target.dataset?.complete;
    if(id&&event.target.checked&&motionEnabled())document.querySelector(`#all-tasks [data-complete="${CSS.escape(id)}"]`)?.classList.add('liquid-pop');
  });
  // Calendar months slide in from the direction you are heading.
  [['#calendar-prev',-1],['#calendar-next',1]].forEach(([selector,direction])=>$(selector).addEventListener('click',()=>{
    if(motionEnabled())$('#calendar-grid').animate([{opacity:0,transform:`translateX(${direction*30}px)`},{opacity:1,transform:'none'}],{duration:560,easing:SPRING_SOFT});
  }));
  // Light and dark pour into each other from the switch that was pressed.
  ['#dark-switch','#auth-theme'].forEach(selector=>{
    const button=$(selector),original=button.onclick;if(!original)return;
    button.onclick=function(event){
      if(!document.startViewTransition||!motionEnabled())return original.call(this,event);
      const r=button.getBoundingClientRect();
      root.style.setProperty('--vt-x',(r.left+r.width/2)+'px');root.style.setProperty('--vt-y',(r.top+r.height/2)+'px');
      document.startViewTransition(()=>original.call(this,event));
    };
  });

  /* ---------- Wiring ---------- */
  addIndicator($('.sidebar nav'),'a.active');
  addIndicator($('.subjects-toolbar .tabs'),'button.active',true);
  addIndicator($('.auth-tabs'),'a.active',true);
  root.classList.add('liquid-ready');
  placeAll(false);cascade();
  window.addEventListener('hashchange',()=>{placeAll(true);cascade();});
  window.addEventListener('resize',()=>placeAll(false));
  document.addEventListener('click',event=>{if(event.target.closest('.tabs,.auth-tabs,.theme-switch'))requestAnimationFrame(()=>placeAll(true));});
  if(window.ResizeObserver){const observer=new ResizeObserver(()=>placeAll(false));indicators.forEach(indicator=>observer.observe(indicator.container));}
  new MutationObserver(()=>placeAll(false)).observe(root,{attributes:true,attributeFilter:['data-theme','style']});
})();
