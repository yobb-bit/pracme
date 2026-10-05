/* Landing page setup: fill in profile details and offer the future guide hook. */
import './nav.js';
import { SITE_NAME } from './config.js';
import { loadProfile } from './profile.js';
import { CHARACTERS } from './characters.js';

const profile = loadProfile();
const heroName = profile?.hero?.name || CHARACTERS.player.name;

document.title = SITE_NAME;
document.getElementById('site-title').textContent = SITE_NAME;
document.getElementById('landing-hero-name').textContent = heroName;

// The tour can be added later without changing the landing page flow.
if (!profile?.guideSeen && typeof window.startGuide === 'function') {
  window.startGuide();
}
