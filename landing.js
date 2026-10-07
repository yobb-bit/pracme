/* Landing page setup: fill in profile details and offer the future guide hook. */
import './nav.js';
import { SITE_NAME } from './config.js';
import { loadProfile } from './profile.js';
import { CHARACTERS } from './characters.js';
import { startGuide } from './guide.js';

const profile = loadProfile();
const heroName = profile?.hero?.name || CHARACTERS.player.name;

document.title = SITE_NAME;
document.getElementById('site-title').textContent = SITE_NAME;
document.getElementById('landing-hero-name').textContent = heroName;

// ?guide=1 is a non-persistent preview hook; normal visits run only once.
const guidePreview = new URLSearchParams(location.search).get('guide') === '1';
if (guidePreview || !profile?.guideSeen) {
  window.startGuide({ persist: !guidePreview });
}
