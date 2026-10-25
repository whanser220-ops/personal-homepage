export const initialHomeOpening = {
  phase: "intro",
  animationComplete: false,
  introFailed: false,
  sceneReady: false,
  sceneUnavailable: false,
  posterReady: false,
};

// Readiness and the illustration's ending arrive independently. Once revealed,
// context recovery must use the scene's poster rather than replaying the intro.
export function homeOpeningReducer(state, event) {
  let next;
  switch (event.type) {
    case "animation-complete":
      if (state.animationComplete) return state;
      next = { ...state, animationComplete: true };
      break;
    case "scene-ready":
      if (state.sceneReady === event.ready) return state;
      next = {
        ...state,
        sceneReady: event.ready,
        sceneUnavailable: state.sceneUnavailable || (state.sceneReady && !event.ready),
      };
      break;
    case "intro-failed":
      if (state.introFailed) return state;
      next = { ...state, introFailed: true, animationComplete: true };
      break;
    case "scene-unavailable":
      if (state.sceneUnavailable) return state;
      next = { ...state, sceneUnavailable: true };
      break;
    case "poster-ready":
      if (state.posterReady) return state;
      next = { ...state, posterReady: true };
      break;
    case "transition-complete":
      return state.phase === "revealing" ? { ...state, phase: "shown" } : state;
    default:
      return state;
  }
  if (state.phase === "shown") return next;
  const contentReady = next.sceneReady || ((next.sceneUnavailable || next.introFailed) && next.posterReady);
  next.phase = next.animationComplete
    ? contentReady ? "revealing" : "waiting"
    : "intro";
  return next;
}
