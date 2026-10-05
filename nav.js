/* Build the same accessible header wherever #site-header is included. */
import { FEATURES, SITE_NAME } from './config.js';
import { loadProfile } from './profile.js';
import { CHARACTERS } from './characters.js';

const mount = document.getElementById('site-header');

if (mount) {
  const profile = loadProfile();
  const heroName = profile?.hero?.name || CHARACTERS.player.name;
  const links = [
    { label: 'Quiz', href: 'quiz.html' },
    { label: 'Practice', href: 'practice.html' },
    { label: 'Review', href: 'review.html' },
    { label: 'Hero', href: 'hero.html', enabled: FEATURES.heroPage },
    { label: 'Settings', href: 'settings.html', enabled: FEATURES.settingsPage },
  ];
  const currentPage = location.pathname.split('/').pop() || 'index.html';

  const header = document.createElement('header');
  header.className = 'site-header';
  const inner = document.createElement('div');
  inner.className = 'site-header__inner';

  const brand = document.createElement('a');
  brand.className = 'site-header__brand';
  brand.href = 'index.html';
  brand.textContent = SITE_NAME;
  if (currentPage === 'index.html') brand.setAttribute('aria-current', 'page');
  inner.append(brand);

  const nav = document.createElement('nav');
  nav.className = 'site-nav';
  nav.setAttribute('aria-label', 'Main navigation');
  for (const item of links) {
    const link = document.createElement('a');
    link.href = item.href;
    link.textContent = item.label;
    if (item.enabled === false) link.hidden = true;
    if (item.href === currentPage) link.setAttribute('aria-current', 'page');
    nav.append(link);
  }
  inner.append(nav);

  const badge = document.createElement('span');
  badge.className = 'hero-badge';
  badge.setAttribute('aria-label', `Your hero: ${heroName}`);
  const portrait = document.createElement('span');
  portrait.className = 'hero-badge__portrait';
  portrait.setAttribute('aria-hidden', 'true');
  portrait.textContent = '🦇';
  const name = document.createElement('span');
  name.className = 'hero-badge__name';
  name.textContent = heroName;
  badge.append(portrait, name);
  inner.append(badge);

  header.append(inner);
  mount.replaceChildren(header);
}
