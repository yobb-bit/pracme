/* Redirect feature pages to onboarding until the profile is complete. */
import { isOnboarded } from './profile.js';

if (!isOnboarded()) location.replace('onboarding.html');
