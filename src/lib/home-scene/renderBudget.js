export const SCENE_FPS = 30;

export function createFrameClock(fps = SCENE_FPS) {
  const interval = 1000 / fps;
  let previous;
  return {
    reset() { previous = undefined; },
    due(time) {
      if (previous === undefined) { previous = time; return true; }
      const elapsed = time - previous;
      if (elapsed + 0.5 < interval) return false;
      // Keep the remainder so a 60Hz display does not accidentally become 20fps.
      previous += Math.max(1, Math.floor((elapsed + 0.5) / interval)) * interval;
      return true;
    },
  };
}

export function maximumPixelRatio(width, height, deviceRatio = 1) {
  const mobile = width < 700;
  const pixelBudget = mobile ? 1_000_000 : 2_500_000;
  return Math.min(deviceRatio, mobile ? 1.25 : 1.5, Math.sqrt(pixelBudget / Math.max(1, width * height)));
}

// Small, hysteretic steps avoid reallocating every render target on a slow frame.
export function createResolutionBudget(maximum) {
  let levels, index, warmup = 6, started, samples = [], stable = 0, changedAt = -Infinity;
  function resetSamples() { warmup = 6; started = undefined; samples = []; stable = 0; }
  function setMaximum(value) {
    const current = levels ? levels[index] : 1;
    const floor = Math.min(0.7, value);
    levels = [...new Set([floor, 0.85, 1, 1.25, value].filter(v => v <= value))].sort((a, b) => a - b);
    index = Math.max(0, levels.findLastIndex(v => v <= current + 0.001));
    resetSamples();
    return levels[index];
  }
  setMaximum(maximum);
  return {
    get pixelRatio() { return levels[index]; },
    setMaximum,
    reset: resetSamples,
    sample({ time, frameMs, renderMs, gpuMs }) {
      // Occluded/background tabs can be throttled to 1fps; that is not GPU load.
      if (frameMs <= 0 || (frameMs > 250 && !(gpuMs > 22 || renderMs > 16))) { resetSamples(); return null; }
      // Keep genuinely expensive visible frames even below 4fps. A throttled
      // tab has a long interval but little measured CPU/GPU work.
      frameMs = Math.min(frameMs, 250);
      if (warmup > 0) { warmup--; return null; }
      started ??= time;
      samples.push({ frameMs, renderMs, gpuMs });
      if (time - started < 2000 || samples.length < 20) return null;
      const average = key => {
        const values = samples.map(s => s[key]).filter(Number.isFinite);
        return values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined;
      };
      const gpu = average('gpuMs'), cpu = average('renderMs'), cadence = average('frameMs');
      const late = samples.filter(s => s.frameMs > 45).length / samples.length;
      const overloaded = (gpu !== undefined && gpu > 22) || cpu > 16 || late > 0.2;
      const comfortable = (gpu === undefined || gpu < 12) && cpu < 9 && cadence < 40;
      stable = comfortable ? stable + 1 : 0;
      started = undefined;
      samples = [];
      if (time - changedAt < 5000) return null;
      const next = overloaded ? Math.max(0, index - 1) : stable >= 4 ? Math.min(levels.length - 1, index + 1) : index;
      if (next === index) return null;
      index = next;
      changedAt = time;
      resetSamples();
      return levels[index];
    },
  };
}

// GPU queries are asynchronous: never wait for the driver or call gl.finish().
export function createGpuTimer(gl) {
  const extension = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const pending = [];
  let active;
  return {
    begin() {
      if (!extension || active || pending.length >= 4) return;
      active = gl.createQuery();
      if (active) gl.beginQuery(extension.TIME_ELAPSED_EXT, active);
    },
    end() {
      if (!active) return;
      gl.endQuery(extension.TIME_ELAPSED_EXT);
      pending.push(active);
      active = undefined;
    },
    poll() {
      if (!extension) return undefined;
      const disjoint = gl.getParameter(extension.GPU_DISJOINT_EXT);
      let milliseconds;
      while (pending.length && (disjoint || gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE))) {
        const query = pending.shift();
        if (!disjoint) milliseconds = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
        gl.deleteQuery(query);
      }
      return milliseconds;
    },
    clear() {
      if (active) { gl.endQuery(extension.TIME_ELAPSED_EXT); gl.deleteQuery(active); active = undefined; }
      pending.splice(0).forEach(query => gl.deleteQuery(query));
    },
  };
}
