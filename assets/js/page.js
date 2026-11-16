// Small page behaviours: solid header after the hero photo, and click-to-load YouTube players.

// The header sits white-on-photo over the hero; once the hero leaves the viewport it gets a paper background.
const header = document.querySelector('header.site');
const hero = document.querySelector('.hero');
if (header && hero) {
  new IntersectionObserver(([e]) => header.classList.toggle('solid', !e.isIntersecting), {
    rootMargin: '-56px 0px 0px 0px',
  }).observe(hero);
}

// Video cards show the YouTube thumbnail and only load the player when clicked.
for (const btn of document.querySelectorAll('button[data-youtube]')) {
  btn.addEventListener('click', () => {
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube-nocookie.com/embed/${btn.dataset.youtube}?autoplay=1&rel=0`;
    iframe.title = btn.getAttribute('aria-label') ?? 'YouTube video';
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
    iframe.allowFullscreen = true;
    btn.replaceChildren(iframe);
  }, { once: true });
}

// Side navigation: mark the section currently in the middle of the screen.
const sideLinks = new Map(
  [...document.querySelectorAll('.side nav a[href^="#"]')].map((a) => [a.getAttribute('href').slice(1), a]),
);
if (sideLinks.size) {
  const spy = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      for (const a of sideLinks.values()) a.removeAttribute('aria-current');
      sideLinks.get(e.target.id)?.setAttribute('aria-current', 'true');
    }
  }, { rootMargin: '-45% 0px -50% 0px' });
  for (const id of sideLinks.keys()) {
    const sec = document.getElementById(id);
    if (sec) spy.observe(sec);
  }
}

// Research clips: load and play only while on screen; reduced-motion users keep the poster frame.
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const clips = document.querySelectorAll('video[data-src]');
const clipObserver = new IntersectionObserver((entries) => {
  for (const { target: v, isIntersecting } of entries) {
    if (!isIntersecting || reduceMotion.matches) { v.pause(); continue; }
    if (!v.src) v.src = v.dataset.src;
    v.play().catch(() => {});
  }
}, { threshold: 0.25 });
for (const v of clips) clipObserver.observe(v);
reduceMotion.addEventListener('change', () => { if (reduceMotion.matches) for (const v of clips) v.pause(); });
