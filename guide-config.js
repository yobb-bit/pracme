/* Editable dialogue and spotlight targets for the landing page tour. */
export const GUIDE_STEPS = [
  {
    id: 'welcome',
    target: null,
    title: 'Welcome',
    text: "I'm {heroName}. {trait} Let me show you around.",
  },
  {
    id: 'quiz',
    target: '.feature-card[href="quiz.html"]',
    title: 'Interview Quiz',
    text: 'Take on boss battles as you answer interview questions. Strong answers deal hits, and your HP shows how much stamina you have left.',
  },
  {
    id: 'practice',
    target: '.feature-card[href="practice.html"]',
    title: 'Free Practice',
    text: 'Practice with no pressure. Pick the topics and difficulty you want to work on, then take your time shaping an answer.',
  },
  {
    id: 'review',
    target: '.feature-card[href="review.html"]',
    title: 'Review',
    text: 'Come back to questions you missed or want to strengthen. Reviewing them helps turn a shaky answer into a confident one.',
  },
  {
    id: 'hero-settings',
    target: '.site-nav a[href="hero.html"]:not([hidden]), .site-nav a[href="settings.html"]:not([hidden])',
    title: 'Hero and Settings',
    text: 'Your Hero and Settings are in the navigation when those pages are available. Use them to revisit your hero and adjust your setup.',
  },
  {
    id: 'ready',
    target: null,
    kind: 'ready',
    title: 'Ready to start your interview quiz?',
    text: 'Your first boss battle is waiting whenever you are.',
  },
];

export const GUIDE_HERO_OVERRIDES = {};
