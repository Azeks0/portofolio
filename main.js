/* Drives the cuneiform -> transliteration -> translation sequence as a
   continuous, self-running loop (not tied to scroll). One progress value
   cycles through: rise 0->1 (reveal), hold at 1 (read time), fall 1->0
   (reverse), hold at 0 (pause) — then repeats. That single value is split
   into three overlapping phases exactly as before, each written to a CSS
   custom property the stylesheet reads directly. */

const stage = document.querySelector('.reconstruction__stage');
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (stage) {
  function clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }

  if (prefersReducedMotion) {
    stage.style.setProperty('--p1', '1');
    stage.style.setProperty('--p2', '1');
    stage.style.setProperty('--p3', '1');
    stage.style.setProperty('--pe', '0');
  } else {
    const RISE_TIME = 5.5;   // seconds to reveal
    const HOLD_FULL = 1.8;   // pause once fully resolved
    const HOLD_EMPTY = 1.2;  // pause once back at the start
    const CYCLE = RISE_TIME * 2 + HOLD_FULL + HOLD_EMPTY;

    const start = performance.now();

    function loopProgress(elapsed) {
      const t = elapsed % CYCLE;
      if (t < RISE_TIME) return t / RISE_TIME;
      if (t < RISE_TIME + HOLD_FULL) return 1;
      if (t < RISE_TIME * 2 + HOLD_FULL) return 1 - (t - RISE_TIME - HOLD_FULL) / RISE_TIME;
      return 0;
    }

    function tick() {
      const elapsed = (performance.now() - start) / 1000;
      const progress = loopProgress(elapsed);

      const p1 = clamp01(progress * 3);
      const p2 = clamp01(progress * 3 - 1);
      const p3 = clamp01(progress * 3 - 2);
      const pe = p1 * (1 - p2);

      stage.style.setProperty('--p1', p1.toFixed(3));
      stage.style.setProperty('--p2', p2.toFixed(3));
      stage.style.setProperty('--p3', p3.toFixed(3));
      stage.style.setProperty('--pe', pe.toFixed(3));

      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }
}