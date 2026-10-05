import { HEROES } from './characters.js';
import { loadProfile, saveProfile, isOnboarded, loadDraft, saveDraft, clearDraft } from './profile.js';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const STEPS = 5;
let currentStep = 1;
let selectedHero = null;
let selectedTopics = [];
let heroName = '';

const howItWorksConfig = [
  { title: 'Difficulty modes', body: 'Easy, Normal and Hard. The data value is "neutral"; the label shown to users is "Normal".' },
  { title: 'Question types', body: 'Knowledge, Logical/Situational, and Behavioral.' },
  { title: 'Answering', body: 'Type or say your answer, check it, rate yourself honestly. "I don\'t know" shows the teaching content.' },
  { title: 'Battle', body: 'Skips and wrong answers hurt your hero. Correct answers damage the villain. The Hard villain needs the most correct answers.' },
];

const heroLoader = new GLTFLoader();

function renderHeroPreview(hero, media){
  if(hero.thumbnail){
    const img=document.createElement('img');
    img.src=hero.thumbnail; img.alt=`${hero.defaultName} preview`;
    img.style.maxWidth='100%'; img.style.maxHeight='100%';
    media.appendChild(img);
    return;
  }

  const canvas=document.createElement('canvas');
  canvas.className='hero-canvas';
  canvas.setAttribute('role','img');
  canvas.setAttribute('aria-label',`${hero.defaultName} 3D preview`);
  media.appendChild(canvas);

  try{
    const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    renderer.setSize(media.clientWidth||320,media.clientHeight||180,false);

    const scene=new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xdfe8ff,0x5a6472,1.8));
    const key=new THREE.DirectionalLight(0xffffff,2.2);
    key.position.set(2.6,4.5,3.2); scene.add(key);
    const fill=new THREE.DirectionalLight(0xffffff,0.6);
    fill.position.set(-2.4,2.2,-2.6); scene.add(fill);

    const camera=new THREE.PerspectiveCamera(32,(media.clientWidth||320)/(media.clientHeight||180),0.1,50);
    camera.position.set(0,1,4.3); camera.lookAt(0,0.95,0);

    heroLoader.load(hero.modelPath||hero.model,(gltf)=>{
      const model=gltf.scene;
      model.traverse((node)=>{
        if(!node.isMesh) return;
        const materials=Array.isArray(node.material)?node.material:[node.material];
        const previewMaterials=materials.map((material)=>{
          if(!material) return material;
          if(material.emissiveMap&&!material.map){
            const texture=material.emissiveMap;
            texture.colorSpace=THREE.SRGBColorSpace;
            return new THREE.MeshStandardMaterial({
              map:texture, color:0xffffff, roughness:0.85,
              emissive:0xffffff, emissiveMap:texture, emissiveIntensity:0.5,
              side:material.side,
            });
          }
          if(material.map) material.map.colorSpace=THREE.SRGBColorSpace;
          return material;
        });
        node.material=Array.isArray(node.material)?previewMaterials:previewMaterials[0];
      });
      const box=new THREE.Box3().setFromObject(model);
      const size=box.getSize(new THREE.Vector3());
      const center=box.getCenter(new THREE.Vector3());
      model.scale.setScalar(1.8/(size.y||1));
      model.position.set(-center.x*model.scale.x,-box.min.y*model.scale.y,-center.z*model.scale.z);
      scene.add(model);
      renderer.render(scene,camera);
    },undefined,(error)=>{
      console.error(`[onboarding] Could not load hero preview "${hero.modelPath||hero.model}"`,error);
      canvas.remove();
      const note=document.createElement('span');
      note.className='hero-preview-fallback';
      note.textContent=hero.defaultName;
      media.appendChild(note);
    });
  }catch(error){
    console.error('[onboarding] WebGL preview could not start:',error);
    canvas.remove();
    const note=document.createElement('span');
    note.className='hero-preview-fallback';
    note.textContent=hero.defaultName;
    media.appendChild(note);
  }
}

function getQueryParam(name){ try{ const u=new URL(window.location.href); return u.searchParams.get(name);}catch(e){return null;} }
function setVisible(el,v){ if(el) el.hidden=!v; }
function setText(el,t){ if(el) el.textContent=t; }
function showError(el,m){ if(el) el.textContent=m||''; }
function isForceRun(){ return getQueryParam('force')==='1'; }
function isStorageBlockedNotice(){ try{ const k='__t__'; localStorage.setItem(k,'1'); localStorage.removeItem(k); return false;}catch(e){return true;} }
function validateName(name){ const t=(name||'').trim(); if(t.length<2) return {ok:false,msg:'Name must be at least 2 characters.'}; if(t.length>16) return {ok:false,msg:'Name must be at most 16 characters.'}; const re=/^[\p{L}\p{N}\s'\-.]+$/u; if(!re.test(t)) return {ok:false,msg:'Only letters, numbers, spaces, hyphen, apostrophe, period allowed.'}; return {ok:true,value:t}; }
async function loadCategories(){ try{ const res=await fetch('questions.json',{cache:'no-store'}); if(!res.ok)return[]; const data=await res.json(); if(!Array.isArray(data))return[]; const s=new Set(); data.forEach(q=>{if(q&&q.category)s.add(q.category);}); return Array.from(s);}catch(e){return[];} }

function renderHeroes(){
  const list=document.getElementById('heroes-list'); if(!list)return;
  list.innerHTML='';
  (HEROES||[]).forEach(h=>{
    const card=document.createElement('div'); card.className='hero-card';
    const isUnlocked = h.unlock && h.unlock.type==='default';
    card.setAttribute('role','radio'); card.setAttribute('tabindex',isUnlocked?'0':'-1');
    card.dataset.id=h.id; card.dataset.unlocked=isUnlocked?'true':'false';
    if(selectedHero&&selectedHero.id===h.id){ card.setAttribute('aria-checked','true'); card.classList.add('is-selected'); }
    else card.setAttribute('aria-checked','false');
    if(!isUnlocked){ card.setAttribute('aria-disabled','true'); card.classList.add('is-locked'); }
    const media=document.createElement('div'); media.className='hero-media';
    renderHeroPreview(h,media);
    const title=document.createElement('h3'); title.textContent=h.defaultName;
    const trait=document.createElement('p'); trait.textContent=h.trait||'';
    const skill=document.createElement('p'); skill.textContent=h.skill||'';
    const lock=document.createElement('p'); lock.className='hero-lock';
    if(!isUnlocked){ const req=(h.unlock&&h.unlock.type==='defeat')?`Defeat ${h.unlock.villainId||'villain'} to unlock`:'Locked'; lock.textContent=`🔒 ${req}`;} else lock.textContent='';
    card.appendChild(media); card.appendChild(title); card.appendChild(trait); card.appendChild(skill); card.appendChild(lock);
    if(isUnlocked){
      card.addEventListener('click',()=>selectHero(h));
      card.addEventListener('keydown',e=>{ if(e.key===' '||e.key==='Enter'){ e.preventDefault(); selectHero(h); }});
    }
    list.appendChild(card);
  });
}

function selectHero(h){
  selectedHero=h;
  document.querySelectorAll('.hero-card').forEach(card=>{
    const selected=card.dataset.id===h.id;
    card.classList.toggle('is-selected',selected);
    card.setAttribute('aria-checked',String(selected));
  });
  showError(document.getElementById('hero-err'),'');
}

function renderTopics(categories){
  const wrap=document.getElementById('topics-wrap'); if(!wrap) return;
  wrap.innerHTML='';
  const allBtn=document.createElement('button'); allBtn.type='button'; allBtn.className='chip chip--all';
  allBtn.textContent='Select all';
  allBtn.addEventListener('click',()=>{
    if(selectedTopics.length===categories.length) selectedTopics=[];
    else selectedTopics=categories.slice();
    renderTopics(categories);
  });
  wrap.appendChild(allBtn);
  categories.forEach(cat=>{
    const btn=document.createElement('button'); btn.type='button'; btn.className='chip';
    if(selectedTopics.includes(cat)) btn.classList.add('is-selected');
    btn.textContent=cat; btn.setAttribute('aria-pressed', selectedTopics.includes(cat)?'true':'false');
    btn.addEventListener('click',()=>{
      if(selectedTopics.includes(cat)) selectedTopics=selectedTopics.filter(c=>c!==cat);
      else selectedTopics.push(cat);
      renderTopics(categories); showError(document.getElementById('topics-err'),'');
    });
    wrap.appendChild(btn);
  });
}
function renderHowItWorks(){
  const el=document.getElementById('howitworks'); if(!el)return; el.innerHTML='';
  howItWorksConfig.forEach(item=>{
    const card=document.createElement('div'); card.className='hiw-card';
    const h=document.createElement('h3'); h.textContent=item.title;
    const p=document.createElement('p'); p.textContent=item.body;
    card.appendChild(h); card.appendChild(p); el.appendChild(card);
  });
}
function updateProgress(){
  const p=document.getElementById('onboarding-progress'); if(p) p.textContent=`Step ${currentStep} of ${STEPS}`;
  document.querySelectorAll('.onboarding__step').forEach(stepEl=>{
    setVisible(stepEl, Number(stepEl.dataset.step)===currentStep);
  });
  const back=document.getElementById('btn-back'), next=document.getElementById('btn-next'), finish=document.getElementById('btn-finish');
  if(back) back.disabled=currentStep===1; if(finish) setVisible(finish,currentStep===STEPS); if(next) setVisible(next,currentStep<STEPS);
}
function updateSummary(){
  setText(document.getElementById('sum-hero'), selectedHero?selectedHero.defaultName:'');
  setText(document.getElementById('sum-name'), heroName);
  setText(document.getElementById('sum-topics'), selectedTopics.join(', '));
}
function canGoNext(){
  if(currentStep===1){ if(!selectedHero){ showError(document.getElementById('hero-err'),'Please select a hero.'); return false; } showError(document.getElementById('hero-err'),''); return true; }
  if(currentStep===2){ const v=validateName(heroName); if(!v.ok){ showError(document.getElementById('name-err'),v.msg); return false; } heroName=v.value; showError(document.getElementById('name-err'),''); return true; }
  if(currentStep===3){ if(selectedTopics.length<1){ showError(document.getElementById('topics-err'),'Select at least one topic.'); return false; } showError(document.getElementById('topics-err'),''); return true; }
  return true;
}
function saveDraftNow(){
  saveDraft({ step:currentStep, selectedHeroId:selectedHero?selectedHero.id:null, heroName, selectedTopics });
}
function loadDraftNow(){
  const d=loadDraft(); if(!d) return false;
  currentStep=d.step&&d.step>=1&&d.step<=STEPS?d.step:1;
  if(d.selectedHeroId){
    const h=(HEROES||[]).find(x=>x.id===d.selectedHeroId && x.unlock&&x.unlock.type==='default');
    if(h) selectedHero=h;
  }
  heroName=d.heroName||''; if(Array.isArray(d.selectedTopics)) selectedTopics=d.selectedTopics;
  return true;
}
async function init(){
  if(!isForceRun() && isOnboarded()){ location.replace('index.html'); return; }
  if(isStorageBlockedNotice()){ const n=document.getElementById('storage-notice'); if(n) n.hidden=false; }
  renderHeroes();
  const cats=await loadCategories(); renderTopics(cats); renderHowItWorks();
  const nameInput=document.getElementById('hero-name');
  if(nameInput){
    nameInput.value=heroName||(selectedHero?selectedHero.defaultName:'');
    nameInput.addEventListener('input',()=>{ heroName=nameInput.value; });
    nameInput.addEventListener('keydown',e=>{
      if(e.key==='Enter'){ e.preventDefault(); if(canGoNext()){ currentStep=Math.min(STEPS,currentStep+1); saveDraftNow(); updateProgress(); updateSummary(); } }
    });
  }
  loadDraftNow();
  if(nameInput && !heroName && selectedHero){ nameInput.value=selectedHero.defaultName; heroName=selectedHero.defaultName; }
  document.getElementById('btn-back').addEventListener('click',()=>{ if(currentStep>1){ currentStep-=1; saveDraftNow(); updateProgress(); } });
  document.getElementById('btn-next').addEventListener('click',()=>{ if(canGoNext()){ currentStep=Math.min(STEPS,currentStep+1); saveDraftNow(); updateProgress(); updateSummary(); } });
  document.getElementById('btn-finish').addEventListener('click',()=>{
    if(!canGoNext()) return;
    const v=validateName(heroName); const hn=v.ok?v.value:heroName;
    const profile={ version:1, onboardingComplete:true, createdAt:new Date().toISOString(), hero:{id:selectedHero?selectedHero.id:'batman',name:hn}, topics:selectedTopics.slice(), unlockedHeroes:selectedHero?[selectedHero.id]:['batman'], heroesUsed:selectedHero?[{id:selectedHero.id,name:hn,since:new Date().toISOString()}]:[], guideSeen:false };
    saveProfile(profile); clearDraft(); location.replace('index.html');
  });
  updateProgress(); updateSummary();
}
init();
