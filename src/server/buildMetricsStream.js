import { EventEmitter } from "node:events";

const globalKey = "__personalHomepageBuildMetricsEmitter";

function getEmitter() {
  if (!globalThis[globalKey]) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(200);
    globalThis[globalKey] = emitter;
  }

  return globalThis[globalKey];
}

export function publishBuildMetricsSnapshot(snapshot) {
  getEmitter().emit("snapshot", snapshot);
}

export function subscribeBuildMetricsSnapshots(listener) {
  const emitter = getEmitter();
  emitter.on("snapshot", listener);
  return () => emitter.off("snapshot", listener);
}
