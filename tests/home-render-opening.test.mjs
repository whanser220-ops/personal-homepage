import test from "node:test";
import assert from "node:assert/strict";
import { homeOpeningReducer, initialHomeOpening } from "../src/lib/home-scene/homeOpening.js";

const run = (...events) => events.reduce(homeOpeningReducer, initialHomeOpening);
const complete = { type: "animation-complete" };
const ready = { type: "scene-ready", ready: true };
const lost = { type: "scene-ready", ready: false };
const poster = { type: "poster-ready" };
const failed = { type: "scene-unavailable" };
const ended = { type: "transition-complete" };

test("a warm 3D scene waits for the full opening, including a decoded poster", () => {
  assert.equal(run(ready).phase, "intro");
  assert.equal(run(poster, ready).phase, "intro");
  assert.equal(run(ready, complete).phase, "revealing");
});

test("a cold scene keeps the finished coffee illustration until a rendered frame", () => {
  assert.equal(run(complete).phase, "waiting");
  assert.equal(run(complete, poster).phase, "waiting", "a poster alone is not renderer readiness");
  assert.equal(run(complete, poster, ready).phase, "revealing");
});

test("loss of an early frame before the animation ends cannot reveal a broken renderer", () => {
  assert.equal(run(ready, lost, complete).phase, "waiting");
  assert.equal(run(ready, lost, complete, ready).phase, "revealing");
});

test("renderer failure or timeout needs both the finished intro and decoded fallback", () => {
  for (const events of [[failed, poster], [poster, failed]]) {
    assert.equal(run(...events).phase, "intro");
    assert.equal(run(...events, complete).phase, "revealing");
  }
  assert.equal(run(complete, failed).phase, "waiting");
  assert.equal(run(complete, failed, poster).phase, "revealing");
  assert.equal(run(complete, poster, failed).phase, "revealing");
});

test("context recovery and duplicate callbacks never replay an already revealed intro", () => {
  const shown = run(complete, ready, ended);
  assert.equal(shown.phase, "shown");
  assert.equal(homeOpeningReducer(shown, lost).phase, "shown");
  assert.equal(run(complete, failed, poster, ended, ready).phase, "shown");
  assert.equal(homeOpeningReducer(shown, complete), shown);
  assert.equal(homeOpeningReducer(shown, ended), shown);
});

test("context loss during the fade waits for recovery or a decoded poster", () => {
  assert.equal(run(complete, ready, lost).phase, "waiting");
  assert.equal(run(complete, ready, lost, ended).phase, "waiting");
  assert.equal(run(complete, ready, lost, poster).phase, "revealing");
  assert.equal(run(complete, ready, lost, ready).phase, "revealing");
  assert.equal(run(complete, ready, poster, lost).phase, "revealing");
});

test("a failed illustration can yield to a decoded poster while 3D keeps loading", () => {
  const brokenIntro = { type: "intro-failed" };
  assert.equal(run(brokenIntro).phase, "waiting");
  assert.equal(run(brokenIntro, poster).phase, "revealing");
  assert.equal(run(poster, brokenIntro).phase, "revealing");
  assert.equal(run(brokenIntro, ready).phase, "revealing");
  assert.equal(run(brokenIntro, poster, ended, ready).phase, "shown");
});

test("an early or bubbled transition event cannot remove the opening", () => {
  assert.equal(run(ended).phase, "intro");
  assert.equal(run(complete, ended).phase, "waiting");
  assert.equal(run(complete, ready, ended).phase, "shown");
});
