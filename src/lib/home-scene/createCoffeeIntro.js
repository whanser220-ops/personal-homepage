export const COFFEE_INTRO_DURATION_MS = 4800;

const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const between = (value, start, end) => smooth((value - start) / (end - start));
const mix = (start, end, amount) => start + (end - start) * amount;
const art = { line: "#4b6559", green: "#91b19a", light: "#b9cbb1", shadow: "#638776", cream: "#f3e8cd", coffee: "#654638", crema: "#bb9367" };
const bounds = { x: 260, y: 230, width: 390, height: 270 };

// The introduction owns only this decorative 2D canvas. Its completion does
// not fade or reveal anything; the parent coordinates the live 3D handoff.
export function createCoffeeIntro(canvas, { onComplete, onError } = {}) {
  const ctx = canvas?.getContext("2d");
  if (!ctx) throw new Error("Coffee introduction canvas is unavailable.");
  const doc = canvas.ownerDocument || document;
  const view = doc.defaultView || window;
  const host = canvas.parentElement || canvas;
  const reduced = view.matchMedia("(prefers-reduced-motion: reduce)");
  const requestFrame = callback => view.requestAnimationFrame(callback);
  const cancelFrame = id => view.cancelAnimationFrame(id);
  let disposed = false, failed = false, complete = false;
  let frame = 0, elapsed = 0, lastTick, lastPaint = -Infinity;
  let width = 0, height = 0, ratio = 1, scale = 1, originY = 0;
  let sized = false, paper, palette, backdrop, backCup, frontCup, jugArtwork, settledCup, grainPattern, grainTexture;
  let sizeObserver, themeObserver;
  const cachedCanvases = new Set();
  const ellipse = (context, x, y, rx, ry) => {
    context.beginPath();
    context.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  };
  function layer(w, h) {
    const value = doc.createElement("canvas");
    value.width = Math.max(1, Math.ceil(w));
    value.height = Math.max(1, Math.ceil(h));
    cachedCanvases.add(value);
    return value;
  }
  function release(value) {
    if (!value) return;
    value.width = value.height = 0;
    cachedCanvases.delete(value);
  }
  function gradient(context, x0, y0, x1, y1, stops) {
    const result = context.createLinearGradient(x0, y0, x1, y1);
    stops.forEach(([position, color]) => result.addColorStop(position, color));
    return result;
  }
  function radial(context, x, y, radius, stops) {
    const result = context.createRadialGradient(x, y, 0, x, y, radius);
    stops.forEach(([position, color]) => result.addColorStop(position, color));
    return result;
  }
  let seed = 17;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  function flecks(c, count, box, light, dark) {
        for (let i = 0; i < count; i++) {
          c.fillStyle = i % 3 ? light : dark;
          const x = box[0] + random() * box[2], y = box[1] + random() * box[3];
          c.fillRect(x, y, .3 + random() * 1.1, .3 + random() * .8);
        }
      }
      function fillStroke(c, fill, line = art.line, weight = 2) {
        c.fillStyle = fill; c.fill(); c.strokeStyle = line; c.lineWidth = weight; c.lineJoin = 'round'; c.stroke();
      }

      function cupPath(c) {
        c.beginPath(); c.moveTo(326, 280);
        c.bezierCurveTo(329, 335, 339, 398, 366, 420);
        c.bezierCurveTo(398, 447, 478, 447, 510, 420);
        c.bezierCurveTo(537, 397, 547, 333, 550, 280);
        c.bezierCurveTo(523, 313, 353, 313, 326, 280); c.closePath();
      }
      function makeCupLayers() {
        const res = Math.max(1, Math.min(4, ratio * scale));
        release(backCup); release(frontCup); release(jugArtwork); release(grainTexture);
        backCup = layer(bounds.width * res, bounds.height * res);
        let c = backCup.getContext('2d'); c.scale(res, res); c.translate(-bounds.x, -bounds.y);
        seed = 803;
        // A painted contact shadow and two flat saucer faces share one light direction.
        ellipse(c, 459, 461, 171, 28); c.fillStyle = 'rgba(93,106,81,.10)'; c.fill();
        ellipse(c, 451, 446, 171, 38); fillStroke(c, '#c7cbb1', '#748877', 1.8);
        ellipse(c, 448, 438, 174, 37); fillStroke(c, art.cream, '#748877', 1.8);
        c.save(); ellipse(c, 448, 438, 173, 36); c.clip();
        c.beginPath(); c.moveTo(465, 400); c.bezierCurveTo(512, 415, 552, 424, 614, 421); c.lineTo(630, 470); c.lineTo(418, 484); c.bezierCurveTo(470, 463, 500, 436, 465, 400); c.fillStyle = '#d8d6b9'; c.fill();
        flecks(c, 1400, [270, 399, 360, 80], 'rgba(255,251,224,.32)', 'rgba(109,120,91,.09)'); c.restore();
        c.beginPath(); c.ellipse(447, 435, 154, 29, 0, 3.4, 6.04); c.lineWidth = 2.2; c.strokeStyle = '#fff7dc'; c.stroke();
        c.beginPath(); c.ellipse(448, 438, 114, 20, 0, .11, 2.75); c.lineWidth = 1.2; c.strokeStyle = '#aab398'; c.stroke();
        // The handle is drawn in the same cel-shaded palette as the cup, with no metallic reflection.
        c.beginPath(); c.moveTo(541, 310); c.bezierCurveTo(617, 283, 635, 339, 597, 365); c.bezierCurveTo(575, 381, 551, 382, 537, 376);
        c.lineCap = 'round'; c.lineWidth = 25; c.strokeStyle = art.line; c.stroke();
        c.lineWidth = 20; c.strokeStyle = art.shadow; c.stroke();
        c.beginPath(); c.moveTo(548, 311); c.bezierCurveTo(602, 291, 620, 321, 605, 343); c.lineWidth = 15; c.strokeStyle = art.green; c.stroke();
        c.beginPath(); c.moveTo(552, 308); c.bezierCurveTo(573, 301, 590, 302, 600, 311); c.lineWidth = 3; c.strokeStyle = art.light; c.stroke();
        ellipse(c, 438, 280, 112, 43); fillStroke(c, art.cream, art.line, 2.3);
        ellipse(c, 438, 279, 101, 34); fillStroke(c, '#d1cfb2', '#6b7e68', 1.8);
        c.save(); ellipse(c, 438, 279, 100, 33); c.clip();
        c.beginPath(); c.moveTo(333, 269); c.bezierCurveTo(372, 283, 463, 298, 542, 271); c.lineTo(545, 314); c.lineTo(333, 313); c.closePath(); c.fillStyle = '#e8ddbd'; c.fill();
        flecks(c, 330, [334, 246, 207, 69], 'rgba(250,243,212,.25)', 'rgba(114,120,87,.08)'); c.restore();

        frontCup = layer(bounds.width * res, bounds.height * res); c = frontCup.getContext('2d'); c.scale(res, res); c.translate(-bounds.x, -bounds.y);
        cupPath(c); fillStroke(c, art.green, art.line, 2.6);
        c.save(); cupPath(c); c.clip();
        c.beginPath(); c.moveTo(491, 294); c.bezierCurveTo(515, 342, 501, 397, 458, 439); c.lineTo(554, 444); c.lineTo(565, 280); c.closePath(); c.fillStyle = art.shadow; c.fill();
        c.beginPath(); c.moveTo(338, 292); c.bezierCurveTo(359, 306, 370, 309, 385, 311); c.bezierCurveTo(372, 350, 380, 391, 397, 420); c.bezierCurveTo(366, 411, 350, 373, 338, 292); c.fillStyle = art.light; c.fill();
        c.beginPath(); c.moveTo(348, 321); c.bezierCurveTo(351, 344, 355, 362, 360, 375); c.lineWidth = 3; c.lineCap = 'round'; c.strokeStyle = '#d0d9bb'; c.stroke();
        seed = 741; flecks(c, 3100, [325, 285, 230, 160], 'rgba(239,238,199,.16)', 'rgba(39,72,56,.09)');
        c.restore();
        // The front lip covers the liquid, preserving a consistent painted perspective.
        c.beginPath(); c.ellipse(438, 280, 111, 42, 0, .015, Math.PI - .015); c.strokeStyle = art.line; c.lineWidth = 9; c.stroke();
        c.beginPath(); c.ellipse(438, 279, 110, 41, 0, .025, Math.PI - .025); c.strokeStyle = art.cream; c.lineWidth = 6.5; c.stroke();
        c.beginPath(); c.ellipse(438, 277.5, 105, 36.5, 0, .08, 2.99); c.strokeStyle = '#adba97'; c.lineWidth = 1.2; c.stroke();
        c.beginPath(); c.moveTo(389, 434); c.bezierCurveTo(418, 444, 463, 444, 490, 435); c.strokeStyle = '#465f50'; c.lineWidth = 2.2; c.lineCap = 'round'; c.stroke();
        const texture = grainTexture = layer(96, 96), tc = texture.getContext('2d');
        seed = 918; flecks(tc, 560, [0, 0, 96, 96], 'rgba(250,222,171,.09)', 'rgba(28,30,18,.035)');
        grainPattern = ctx.createPattern(texture, 'repeat');
        jugArtwork = layer(200 * res, 120 * res);
        c = jugArtwork.getContext('2d'); c.scale(res, res); c.translate(90, 45);
        c.beginPath(); c.moveTo(-49, -24); c.bezierCurveTo(-18, -37, 27, -35, 47, -23); c.lineTo(37, 46); c.bezierCurveTo(11, 62, -20, 59, -39, 42); c.lineTo(-52, 8); c.lineTo(-79, 4); c.lineTo(-53, -9); c.closePath();
        fillStroke(c, '#c68f6b', '#775e48', 2);
        c.save(); c.clip();
        c.beginPath(); c.moveTo(12, -29); c.bezierCurveTo(26, 6, 19, 37, -2, 57); c.lineTo(53, 60); c.lineTo(53, -30); c.closePath(); c.fillStyle = '#a16f52'; c.fill();
        c.beginPath(); c.moveTo(-43, -10); c.bezierCurveTo(-39, 5, -35, 24, -28, 32); c.lineWidth = 4; c.strokeStyle = '#dbb18a'; c.stroke();
        seed = 812; flecks(c, 400, [-50, -30, 100, 90], 'rgba(255,228,180,.15)', 'rgba(75,54,31,.07)'); c.restore();
        ellipse(c, -1, -25, 46, 12); fillStroke(c, '#765642', '#e4c79f', 2);
        c.beginPath(); c.moveTo(46, -9); c.bezierCurveTo(85, -17, 86, 34, 41, 36);
        c.strokeStyle = '#775e48'; c.lineWidth = 12; c.stroke(); c.strokeStyle = '#c18c67'; c.lineWidth = 8; c.stroke();
      }

  function makeBackdrop() {
    release(backdrop);
    const rgb = paper.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [250, 249, 245];
    const dark = rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722 < 128;
    palette = { steam: dark ? "203,194,166" : "133,133,112" };
    backdrop = layer(width * ratio, height * ratio);
    const context = backdrop.getContext("2d");
    context.scale(ratio, ratio);
    context.fillStyle = paper;
    context.fillRect(0, 0, width, height);
    context.save();
    context.translate(width * .45, height * .42);
    context.scale(1.25, .85);
    context.fillStyle = radial(context, 0, 0, width * .62, [
      [0, dark ? "rgba(208,168,97,.10)" : "rgba(240,217,171,.28)"],
      [.7, "rgba(233,211,166,.035)"], [1, "rgba(233,211,166,0)"],
    ]);
    context.fillRect(-width, -height, width * 2, height * 2);
    context.restore();
    seed = 115;
    for (let i = 0, count = Math.min(60000, width * height / 20); i < count; i++) {
      context.fillStyle = dark ? "rgba(231,208,155,.028)" : "rgba(132,111,78,.035)";
      context.fillRect(random() * width, random() * height, .5, .5);
    }
  }

  function drawLiquid(p, c = ctx) {
        const fill = between(p, .10, .43);
        if (fill < .001) return;
        const y = mix(302, 284, fill);
        const settle = 1 - between(p, .43, .63);
        const sway = Math.sin((p - .1) * 20) * 1.1 * settle * fill;
        c.save(); ellipse(c, 438, 279, 101, 34); c.clip();
        c.translate(438, y + sway); c.rotate(Math.sin(p * 18) * .009 * settle);
        ellipse(c, 0, 0, 101, 34); c.clip();
        c.fillStyle = art.coffee; c.fillRect(-104, -37, 208, 74);
        // One low-contrast painted light plane replaces glossy, metallic liquid shading.
        c.beginPath(); c.moveTo(-105, -12); c.bezierCurveTo(-55, -32, 30, -31, 100, -12); c.bezierCurveTo(77, 12, 49, 14, 8, 11); c.bezierCurveTo(-52, 8, -78, 4, -105, -12); c.fillStyle = '#825e46'; c.fill();
        c.beginPath(); c.ellipse(0, -1, 97, 31, 0, 3.34, 5.7); c.strokeStyle = '#ac875e'; c.lineWidth = 2.7; c.lineCap = 'round'; c.stroke();
        const cream = between(p, .32, .56);
        c.save(); c.globalAlpha *= cream;
        c.beginPath(); c.moveTo(-66, -6); c.bezierCurveTo(-45, -14, -4, -13, 19, -5); c.bezierCurveTo(29, -1, 25, 3, 10, 5);
        c.strokeStyle = '#c9a477'; c.lineWidth = 2.5; c.stroke();
        c.beginPath(); c.moveTo(-48, 9); c.bezierCurveTo(-31, 15, -4, 16, 13, 12); c.strokeStyle = '#bc956b'; c.lineWidth = 1.8; c.stroke();
        ellipse(c, 66, -3, 2.3, .95); c.fillStyle = '#c8a576'; c.fill();
        ellipse(c, 73, 1, 1.1, .65); c.fill(); c.restore();
        // The single settling wave is anchored to the pour; it does not loop like a spinner.
        const wave = clamp((p - .445) / .16);
        if (wave > 0 && wave < 1) {
          c.save(); c.globalAlpha *= Math.sin(wave * Math.PI) * .42;
          c.beginPath(); c.ellipse(11, 2, 9 + wave * 68, 3 + wave * 19, 0, .13, 2.86);
          c.strokeStyle = '#c6a174'; c.lineWidth = 1.5; c.stroke(); c.restore();
        }
        const impact = between(p, .12, .16) * (1 - between(p, .43, .48));
        if (impact > 0) {
          c.save(); c.globalAlpha *= impact * .5;
          ellipse(c, 14, 0, 7, 2.3); c.strokeStyle = '#c29b6a'; c.lineWidth = 1.7; c.stroke(); c.restore();
        }
        c.fillStyle = grainPattern; c.fillRect(-104, -37, 208, 74);
        c.restore();
      }

  function drawPour(p) {
        const enter = between(p, .045, .13), leave = between(p, .45, .54);
        const presence = enter * (1 - leave);
        if (presence < .001) return;
        const bodyX = 595 + (1 - enter) * 40 + leave * 36;
        const bodyY = 119 - (1 - enter) * 25 - leave * 30;
        ctx.save(); ctx.globalAlpha *= presence;
        // The small earthenware jug uses the same limited palette and brush outline.
        ctx.save(); ctx.translate(bodyX, bodyY); ctx.rotate(-.27 - .07 * enter + leave * .25);
        ctx.drawImage(jugArtwork, -90, -45, 200, 120);
        ctx.restore();
        const flow = between(p, .105, .15) * (1 - between(p, .435, .48));
        const fill = between(p, .1, .43), endY = mix(302, 284, fill);
        const angle = -.27 - .07 * enter + leave * .25;
        const startX = bodyX - 79 * Math.cos(angle) - 4 * Math.sin(angle), startY = bodyY - 79 * Math.sin(angle) + 4 * Math.cos(angle);
        if (flow > .001) {
          ctx.beginPath(); ctx.moveTo(startX, startY); ctx.bezierCurveTo(startX - 31, startY + 20, 453, 237, 452, endY);
          ctx.lineWidth = 5.3 * flow; ctx.lineCap = 'round'; ctx.strokeStyle = '#71503a'; ctx.stroke();
          ctx.lineWidth = 2 * flow; ctx.strokeStyle = '#b48b5d'; ctx.stroke();
        }
        ctx.restore();
        const drop = clamp((p - .48) / .045);
        if (drop > 0 && drop < 1) {
          ellipse(ctx, 452, mix(207, endY, drop * drop), 1.9, 3.1); ctx.fillStyle = '#946b47'; ctx.fill();
        }
      }

  function drawSteam(progress, seconds) {
    const fade = between(progress, .35, .5);
    if (fade < .001) return;
    ctx.save();
    for (let strand = 0; strand < 3; strand++) {
      const rise = between(progress, .36 + strand * .025, .79 + strand * .025);
      const x = 403 + strand * 35;
      const y = 263 - rise * 12;
      const h = 103 + strand % 2 * 29 + rise * 13;
      const drift = Math.sin(seconds * .75 + strand * 1.7) * 6;
      const stroke = gradient(ctx, 0, y, 0, y - h, [
        [0, `rgba(${palette.steam},0)`],
        [.15, `rgba(${palette.steam},${fade * .55})`],
        [.75, `rgba(${palette.steam},${fade * .36})`],
        [1, `rgba(${palette.steam},0)`],
      ]);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x - 15 + drift, y - h * .24, x + 20 + drift, y - h * .32, x + 11, y - h * .5);
      ctx.bezierCurveTo(x - 3 - drift, y - h * .7, x - 18 - drift, y - h * .78, x + 2 + drift, y - h);
      ctx.lineCap = "round";
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 3.2 - strand * .3;
      ctx.stroke();
      ctx.globalAlpha = .2;
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawCached(context, image) {
    context.drawImage(image, bounds.x, bounds.y, bounds.width, bounds.height);
  }
  function makeSettledCup() {
    release(settledCup);
    settledCup = layer(backCup.width, backCup.height);
    const context = settledCup.getContext("2d");
    const resolution = backCup.width / bounds.width;
    context.scale(resolution, resolution);
    context.translate(-bounds.x, -bounds.y);
    drawCached(context, backCup);
    drawLiquid(1, context);
    drawCached(context, frontCup);
  }
  function draw() {
    if (!sized || !backdrop || disposed || failed) return;
    const progress = reduced.matches ? 1 : Math.min(1, elapsed / COFFEE_INTRO_DURATION_MS);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(backdrop, 0, 0, width, height);
    const entry = between(progress, 0, .12);
    ctx.save();
    ctx.translate(width / 2, originY + (1 - entry) * 9);
    ctx.scale(scale, scale);
    ctx.translate(-438, -279);
    if (progress >= 1) {
      drawCached(ctx, settledCup);
    } else {
      ctx.globalAlpha = .88 + entry * .12;
      drawCached(ctx, backCup);
      drawLiquid(progress);
      drawCached(ctx, frontCup);
      drawPour(progress);
    }
    ctx.globalAlpha = 1;
    drawSteam(progress, reduced.matches ? 0 : elapsed / 1000);
    ctx.restore();
  }
  function notifyComplete() {
    if (complete || disposed || failed) return;
    complete = true;
    onComplete?.();
  }
  function fail(error) {
    if (disposed || failed) return;
    failed = true;
    cleanup();
    onError?.(error);
  }
  function paint() {
    try { draw(); } catch (error) { fail(error); }
  }
  function schedule() {
    if (!frame && !disposed && !failed && sized && !doc.hidden && !reduced.matches) {
      frame = requestFrame(tick);
    }
  }
  function tick(time) {
    frame = 0;
    if (disposed || failed || doc.hidden || !sized || reduced.matches) return;
    if (lastTick !== undefined) elapsed += Math.max(0, time - lastTick);
    lastTick = time;
    const cadence = 1000 / (complete ? 24 : 30);
    if (time - lastPaint >= cadence || (!complete && elapsed >= COFFEE_INTRO_DURATION_MS)) {
      lastPaint = time;
      paint();
    }
    if (elapsed >= COFFEE_INTRO_DURATION_MS) notifyComplete();
    schedule();
  }
  function resize() {
    if (disposed || failed) return;
    const box = host.getBoundingClientRect();
    if (!Number.isFinite(box.width) || !Number.isFinite(box.height) || box.width < 1 || box.height < 1) {
      sized = false;
      cancelFrame(frame);
      frame = 0;
      lastTick = undefined;
      return;
    }
    const nextRatio = Math.max(.5, Math.min(view.devicePixelRatio || 1, 2));
    const nextPaper = view.getComputedStyle(host).backgroundColor;
    if (sized && width === box.width && height === box.height && ratio === nextRatio) {
      if (paper !== nextPaper) { paper = nextPaper; makeBackdrop(); paint(); }
      return;
    }
    width = box.width;
    height = box.height;
    ratio = nextRatio;
    sized = true;
    paper = nextPaper;
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    // Leave room for the pourer's handle at the right edge on narrow phones.
    scale = width <= 520 ? Math.min(width / 500, height / 680) : Math.min(width / 900, height / 620);
    originY = height * .43;
    makeCupLayers();
    makeSettledCup();
    makeBackdrop();
    paint();
    if (lastTick === undefined) lastTick = view.performance.now();
    schedule();
  }
  function handleResize() {
    try { resize(); } catch (error) { fail(error); }
  }
  function onVisibility() {
    cancelFrame(frame);
    frame = 0;
    lastTick = undefined;
    if (!doc.hidden) {
      lastTick = view.performance.now();
      paint();
      schedule();
    }
  }
  function onMotion() {
    cancelFrame(frame);
    frame = 0;
    lastTick = undefined;
    if (reduced.matches) {
      elapsed = Math.max(elapsed, COFFEE_INTRO_DURATION_MS);
      paint();
      notifyComplete();
    } else {
      lastTick = view.performance.now();
      schedule();
    }
  }
  function cleanup() {
    if (disposed) return;
    disposed = true;
    cancelFrame(frame);
    frame = 0;
    sizeObserver?.disconnect();
    themeObserver?.disconnect();
    doc.removeEventListener("visibilitychange", onVisibility);
    reduced.removeEventListener("change", onMotion);
    view.removeEventListener("resize", handleResize);
    cachedCanvases.forEach(value => { value.width = value.height = 0; });
    cachedCanvases.clear();
    backdrop = backCup = frontCup = jugArtwork = settledCup = grainPattern = grainTexture = undefined;
    canvas.width = canvas.height = 0;
  }
  try {
    sizeObserver = new view.ResizeObserver(handleResize);
    sizeObserver.observe(host);
    themeObserver = new view.MutationObserver(handleResize);
    themeObserver.observe(doc.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    doc.addEventListener("visibilitychange", onVisibility);
    reduced.addEventListener("change", onMotion);
    view.addEventListener("resize", handleResize);
    resize();
    if (reduced.matches) onMotion();
  } catch (error) {
    fail(error);
  }
  return cleanup;
}
