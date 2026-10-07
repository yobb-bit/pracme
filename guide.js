import { GUIDE_STEPS, GUIDE_HERO_OVERRIDES } from './guide-config.js';
import { HEROES } from './characters.js';
import { loadProfile, saveProfile } from './profile.js';
import { VILLAINS } from './characters.js';

let activeGuide = null;

function heroDetails() {
  const hero = loadProfile()?.hero;
  const definition = HEROES.find((item) => item.id === hero?.id) || HEROES[0];
  return {
    name: hero?.name || definition?.defaultName || 'Hero',
    trait: definition?.trait || 'I stay ready.',
    portrait: '🦇',
    thumbnail: definition?.thumbnail || '',
    id: definition?.id || '',
  };
}

function setHeroPortrait(element, hero) {
  if (hero.thumbnail) {
    const image = document.createElement('img');
    image.src = hero.thumbnail;
    image.alt = '';
    image.className = 'guide-bubble__portrait-image';
    element.replaceChildren(image);
  } else {
    element.textContent = hero.portrait;
  }
}

function makeOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'guide-overlay';
  overlay.innerHTML = `
    <div class="guide-overlay__shade" aria-hidden="true"></div>
    <section class="guide-bubble" role="dialog" aria-modal="false" aria-labelledby="guide-title" aria-describedby="guide-text" tabindex="-1">
      <div class="guide-bubble__speaker">
        <span class="guide-bubble__portrait" aria-hidden="true"></span>
        <span class="guide-bubble__name"></span>
      </div>
      <p class="guide-bubble__count"></p>
      <h2 id="guide-title"></h2>
      <p id="guide-text" aria-live="polite"></p>
      <div class="guide-bubble__actions">
        <button type="button" data-guide="back">Back</button>
        <button type="button" data-guide="next">Next</button>
        <button type="button" data-guide="start" hidden>Start</button>
        <button type="button" data-guide="not-yet" hidden>Not yet</button>
        <button type="button" data-guide="skip">Skip tour</button>
      </div>
    </section>`;
  document.body.append(overlay);
  return overlay;
}

function replaceTokens(text, hero) {
  return text.replaceAll('{heroName}', hero.name).replaceAll('{trait}', hero.trait);
}

export function startGuide(options = {}) {
  if (activeGuide) return activeGuide;
  const hero = heroDetails();
  const shouldPersist = options.persist !== false;
  const steps = GUIDE_STEPS.map((step) => {
    const override = GUIDE_HERO_OVERRIDES[hero.id]?.[step.id];
    return { ...step, title: override?.title || step.title, text: replaceTokens(override?.text || step.text, hero) };
  }).filter((step) => !step.target || document.querySelector(step.target));
  if (!steps.length) return null;

  const previousFocus = document.activeElement;
  const overlay = makeOverlay();
  const bubble = overlay.querySelector('.guide-bubble');
  const shade = overlay.querySelector('.guide-overlay__shade');
  setHeroPortrait(overlay.querySelector('.guide-bubble__portrait'), hero);
  overlay.querySelector('.guide-bubble__name').textContent = hero.name;
  let index = 0;
  let target = null;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function reposition() {
    if (!target) {
      shade.style.clipPath = 'none';
      return;
    }
    const r = target.getBoundingClientRect();
    const pad = 10;
    const x = Math.max(0, r.left - pad);
    const y = Math.max(0, r.top - pad);
    const right = Math.min(innerWidth, r.right + pad);
    const bottom = Math.min(innerHeight, r.bottom + pad);
    shade.style.clipPath = `polygon(0 0, 0 100%, ${x}px 100%, ${x}px ${y}px, ${right}px ${y}px, ${right}px ${bottom}px, ${x}px ${bottom}px, ${x}px 100%, 100% 100%, 100% 0)`;
    overlay.style.setProperty('--spot-x', `${x}px`);
    overlay.style.setProperty('--spot-y', `${y}px`);
    overlay.style.setProperty('--spot-w', `${right - x}px`);
    overlay.style.setProperty('--spot-h', `${bottom - y}px`);
  }

  function close(markSeen = true) {
    window.removeEventListener('scroll', reposition, true);
    window.removeEventListener('resize', reposition);
    document.removeEventListener('keydown', onKeydown);
    overlay.remove();
    activeGuide = null;
    if (markSeen && shouldPersist) saveGuideSeen();
    if (previousFocus?.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus();
  }

  function render() {
    const step = steps[index];
    target = step.target ? document.querySelector(step.target) : null;
    if (target) target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center', inline: 'nearest' });
    overlay.querySelector('.guide-bubble__count').textContent = `${index + 1} of ${steps.length}`;
    overlay.querySelector('#guide-title').textContent = step.title;
    overlay.querySelector('#guide-text').textContent = step.text;
    overlay.querySelector('[data-guide="back"]').hidden = index === 0;
    const isReady = step.kind === 'ready';
    overlay.querySelector('[data-guide="next"]').hidden = isReady;
    overlay.querySelector('[data-guide="start"]').hidden = !isReady;
    overlay.querySelector('[data-guide="not-yet"]').hidden = !isReady;
    reposition();
    requestAnimationFrame(reposition);
    bubble.focus();
  }

  function onKeydown(event) {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'ArrowRight' && index < steps.length - 1) { event.preventDefault(); index += 1; render(); }
    else if (event.key === 'ArrowLeft' && index > 0) { event.preventDefault(); index -= 1; render(); }
  }

  overlay.addEventListener('click', (event) => {
    const action = event.target.closest('[data-guide]')?.dataset.guide;
    if (action === 'skip') close();
    if (action === 'not-yet') close();
    if (action === 'start') {
      close(false);
      window.setTimeout(() => showVillainIntro({ persist: shouldPersist }), 0);
    }
    if (action === 'back' && index > 0) { index -= 1; render(); }
    if (action === 'next') {
      if (index < steps.length - 1) { index += 1; render(); }
      else close();
    }
  });
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('resize', reposition);
  document.addEventListener('keydown', onKeydown);
  activeGuide = { close };
  render();
  return activeGuide;
}

function saveGuideSeen() {
  const profile = loadProfile();
  if (profile) saveProfile({ ...profile, guideSeen: true });
}

export function showVillainIntro(options = {}) {
  if (activeGuide) activeGuide.close(false);
  const shouldPersist = options.persist !== false;
  const villain = VILLAINS[0];
  const overlay = makeOverlay();
  const bubble = overlay.querySelector('.guide-bubble');
  const hero = heroDetails();
  bubble.innerHTML = `
    <div class="guide-bubble__speaker">
      <span class="guide-bubble__portrait" aria-hidden="true"></span>
      <span class="guide-bubble__name"></span>
    </div>
    <p class="guide-bubble__count">Your first boss</p>
    <h2 id="guide-title"></h2>
    <div class="guide-villain-preview" role="img"></div>
    <p class="guide-villain__stats"></p>
    <p id="guide-text" aria-live="polite"></p>
    <div class="guide-bubble__actions">
      <button type="button" data-guide="fight">Fight!</button>
      <button type="button" data-guide="skip">Skip tour</button>
    </div>`;
  setHeroPortrait(bubble.querySelector('.guide-bubble__portrait'), hero);
  bubble.querySelector('.guide-bubble__name').textContent = hero.name;
  bubble.querySelector('#guide-title').textContent = villain.name;
  const villainPortrait = bubble.querySelector('.guide-villain-preview');
  villainPortrait.textContent = villain.portrait || '👹';
  villainPortrait.setAttribute('aria-label', `${villain.name} portrait`);
  bubble.querySelector('.guide-villain__stats').textContent = `Difficulty: ${villain.difficulty}. ${villain.hitsToDefeat} correct answers to defeat it.`;
  bubble.querySelector('#guide-text').textContent = villain.purpose || 'Your first interview practice challenge.';
  const previousFocus = document.activeElement;
  function finish() {
    window.removeEventListener('keydown', onKeydown);
    overlay.remove();
    activeGuide = null;
    if (shouldPersist) saveGuideSeen();
    if (previousFocus?.isConnected && typeof previousFocus.focus === 'function') previousFocus.focus();
  }
  function onKeydown(event) {
    if (event.key === 'Escape') { event.preventDefault(); finish(); }
  }
  overlay.addEventListener('click', (event) => {
    const action = event.target.closest('[data-guide]')?.dataset.guide;
    if (action === 'skip') finish();
    if (action === 'fight') {
      finish();
      location.href = 'quiz.html?guideFight=1';
    }
  });
  window.addEventListener('keydown', onKeydown);
  activeGuide = { close: finish };
  bubble.focus();
  return activeGuide;
}

window.startGuide = startGuide;
