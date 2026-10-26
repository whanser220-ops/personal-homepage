// Lieflat Charts PORCELAIN, ed436ba56b3cbeee20b9b9966b38a9a9689e239c.
// PolyForm Noncommercial 1.0.0: https://polyformproject.org/licenses/noncommercial/1.0.0/
// Color is centralized here; chart geometry and data remain independent.
export const MONITOR_PALETTE = Object.freeze({
  name: "porcelain", BG: "#F7F2EB", TXT: "#081F5C", DATA: "#334EAC", DATA2: "#7096D1", FAINTDATA: "#BAD6EB",
  LAB: "rgba(8,31,92,.72)", FAINT: "rgba(8,31,92,.32)", GRID: "rgba(8,31,92,.16)", TRACK: "rgba(8,31,92,.12)",
  strokeScale: 1.8, opacityFloor: .85,
});

export const MONITOR_PALETTE_CSS = Object.freeze({
  "--paper": MONITOR_PALETTE.BG, "--ink": MONITOR_PALETTE.TXT, "--secondary": MONITOR_PALETTE.DATA,
  "--muted": MONITOR_PALETTE.LAB, "--soft": MONITOR_PALETTE.LAB, "--faint": MONITOR_PALETTE.FAINT,
  "--grid": MONITOR_PALETTE.GRID, "--data": MONITOR_PALETTE.DATA, "--data-mid": MONITOR_PALETTE.DATA2,
  "--data-light": MONITOR_PALETTE.FAINTDATA, "--track": MONITOR_PALETTE.TRACK,
});
const SERIES = Object.freeze([MONITOR_PALETTE.DATA, MONITOR_PALETTE.TXT, MONITOR_PALETTE.DATA2, MONITOR_PALETTE.FAINTDATA]);
export function monitorSeriesColor(index) { return SERIES[index % SERIES.length]; }
export function monitorSeriesNeedsOutline(index) { return index % SERIES.length > 1; }
export function monitorPercentageInk(percentPosition) {
  return percentPosition < 100 / 3 ? MONITOR_PALETTE.DATA2 : percentPosition < 200 / 3 ? MONITOR_PALETTE.DATA : MONITOR_PALETTE.TXT;
}
export function monitorColorStroke(width) { return width * MONITOR_PALETTE.strokeScale; }
