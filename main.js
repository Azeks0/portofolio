/* Drives the cuneiform -> transliteration -> translation sequence
   continuously off scroll position (not discrete steps). The visible
   stage sits pinned (position: sticky) inside a tall `.paper-feature__
   scrollytelling` wrapper — the extra height above 100vh is scroll
   "runway": the taller that wrapper, the more scrolling it takes to
   move through the sequence. We compute one 0..1 progress value from
   how far we've scrolled through that runway, then split it into three
   overlapping phases, each written to a CSS custom property the
   stylesheet reads directly. */

const stage = document.querySelector('.reconstruction__stage');
const scroller = document.getElementById('reconstruction-scroller');
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (stage && scroller && !prefersReducedMotion) {
  let ticking = false;

  function clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }

  function updateProgress() {
    ticking = false;
    const rect = scroller.getBoundingClientRect();
    const vh = window.innerHeight;
    const runway = rect.height - vh; // scrollable distance while the stage stays pinned

    let progress;
    if (runway > 0) {
      // pinned desktop layout: progress = how far we've scrolled into the runway
      progress = clamp01(-rect.top / runway);
    } else {
      // narrow-screen fallback (sticky disabled, wrapper is its natural height):
      // just track the stage's own pass through the viewport
      progress = clamp01((vh - rect.top) / (vh + rect.height));
    }

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