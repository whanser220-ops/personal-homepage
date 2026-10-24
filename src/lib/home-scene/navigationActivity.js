// Let the navigation animate over the last full-resolution scene frame.
// Resume after its 200ms closing transition, without changing canvas size.
export function observeNavigationActivity(nav, onChange, {
  Observer = globalThis.MutationObserver,
  setTimer = globalThis.setTimeout,
  clearTimer = globalThis.clearTimeout,
} = {}) {
  if (!nav) return () => {};
  let active = false, resumeTimer;
  function setActive(next) {
    clearTimer(resumeTimer);
    resumeTimer = undefined;
    if (next) {
      if (!active) { active = true; onChange(true); }
    } else if (active) {
      resumeTimer = setTimer(() => {
        resumeTimer = undefined;
        active = false;
        onChange(false);
      }, 220);
    }
  }
  const sync = () => setActive(nav.dataset.expanded === "true");
  const enter = event => { if (event.pointerType === "mouse") setActive(true); };
  const focus = () => setActive(true);
  const observer = new Observer(sync);
  observer.observe(nav, { attributes: true, attributeFilter: ["data-expanded"] });
  nav.addEventListener("pointerenter", enter);
  nav.addEventListener("pointerleave", sync);
  nav.addEventListener("focusin", focus);
  nav.addEventListener("focusout", sync);
  sync();
  return () => {
    clearTimer(resumeTimer);
    observer.disconnect();
    nav.removeEventListener("pointerenter", enter);
    nav.removeEventListener("pointerleave", sync);
    nav.removeEventListener("focusin", focus);
    nav.removeEventListener("focusout", sync);
  };
}
