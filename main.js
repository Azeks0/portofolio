/* Reveals the reconstructed (blue) portion of the tablet illustration
   with a staggered fade the first time it scrolls into view. */
const tabletFigure = document.querySelector('.tablet-figure');

if (tabletFigure) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          tabletFigure.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.35 }
  );
  observer.observe(tabletFigure);
}