/* Drives the cuneiform -> transliteration -> translation sequence
   continuously off scroll position (not discrete steps). As the
   `.reconstruction__stage` element travels through the viewport,
   we compute a single 0..1 progress value and split it into three
   overlapping phases, each written to a CSS custom property that
   the stylesheet reads directly. */

const stage = document.querySelector('.reconstruction__stage');
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (stage && !prefersReducedMotion) {
  let ticking = false;

  function clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }

  function updateProgress() {
    ticking = false;
    const rect = stage.getBoundingClientRect();
    const vh = window.innerHeight;

    // 0 as the stage enters from the bottom of the viewport,
    // 1 once it has fully scrolled past the top.
    const raw = (vh - rect.top) / (vh + rect.height);
    const progress = clamp01(raw);

    // three sequential phases, each covering a third of the scroll range,
    // driven off the same continuous progress value
    const p1 = clamp01(progress * 3);       // gaps fill in
    const p2 = clamp01(progress * 3 - 1);   // crossfade to transliteration
    const p3 = clamp01(progress * 3 - 2);   // translation fades in

    stage.style.setProperty('--p1', p1.toFixed(3));
    stage.style.setProperty('--p2', p2.toFixed(3));
    stage.style.setProperty('--p3', p3.toFixed(3));
  }

  function onScroll() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(updateProgress);
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  updateProgress();
}