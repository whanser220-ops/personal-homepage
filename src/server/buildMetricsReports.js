import { readFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_JENKINS_JOBS_ROOT = "/srv/jenkins-jobs";
const REPORT_PATH_PARTS = ["archive", ".workspace", "artifacts", "bundle-report", "latest.json"];
const MAX_NAME_LENGTH = 256;
const MAX_TEXT_LENGTH = 2048;
const MAX_REPORT_BUNDLES = 250;
const MAX_REDUNDANT_ASSETS = 80;
const MAX_REDUNDANT_ASSET_BUNDLES = 16;
const SCENE_MODULE_LABEL = "\u573a\u666f\u6a21\u5757";
const BUNDLE_MODULE_DEFINITIONS = [
  { key: "summer", label: "\u590f" },
  { key: "autumn", label: "\u79cb" },
  { key: "winter", label: "\u51ac" },
  { key: "common", label: "\u516c\u5171" },
];

export async function enrichSnapshotWithArchivedBundleReport(snapshot) {
  if (!snapshot?.configured || !snapshot.jobName || !snapshot.buildNumber) {
    return snapshot;
  }

  const report = await readArchivedBundleReport(snapshot.jobName, snapshot.buildNumber);
  if (!report) {
    return snapshot;
  }

  return mergeSnapshotWithBundleReport(snapshot, report);
}

async function readArchivedBundleReport(jobName, buildNumber) {
  const jobsRoot = cleanRootPath(process.env.JENKINS_JOBS_ROOT || DEFAULT_JENKINS_JOBS_ROOT);
  const safeJobName = sanitizePathSegment(jobName);
  const safeBuildNumber = sanitizeBuildNumber(buildNumber);
  if (!jobsRoot || !safeJobName || !safeBuildNumber) {
    return null;
  }

  const reportPath = path.join(jobsRoot, safeJobName, "builds", safeBuildNumber, ...REPORT_PATH_PARTS);
  try {
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    return report && typeof report === "object" && !Array.isArray(report) ? report : null;
  } catch {
    return null;
  }
}

function mergeSnapshotWithBundleReport(snapshot, report) {
  const reportSummary = toObject(report.summary);
  const reportBundles = sanitizeReportBundles(report.bundles);
  const reportRedundantAssets = sanitizeReportRedundantAssets(report.duplicateAssets);
  const existingSummary = snapshot.summary || {};
  const useReportBundles = reportBundles.length > 0 && (snapshot.state !== "running" || (snapshot.bundles || []).length === 0);
  const bundles = useReportBundles ? reportBundles : snapshot.bundles || [];
  const redundantAssets = reportRedundantAssets.length > 0 ? reportRedundantAssets : snapshot.redundantAssets || [];
  const bundleModules = useReportBundles
    ? createBundleModuleTree(buildBundleModuleChildren(bundles))
    : snapshot.bundleModules || createBundleModuleTree([]);
  const totalBundles = toNonNegativeInteger(reportSummary.bundleCount) ?? bundles.length ?? existingSummary.totalBundles ?? 0;
  const completedBundles = snapshot.state === "running"
    ? Number(existingSummary.completedBundles || 0)
    : totalBundles;
  const buildTarget = cleanText(reportSummary.buildTarget || "", MAX_NAME_LENGTH);
  const packageName = cleanText(reportSummary.packageName || "", MAX_NAME_LENGTH);

  return {
    ...snapshot,
    source: appendSource(snapshot.source, "jenkins-artifact"),
    currentRun: enrichRun(snapshot.currentRun, buildTarget, packageName),
    recentRuns: Array.isArray(snapshot.recentRuns)
      ? snapshot.recentRuns.map((run) => enrichMatchingRun(run, snapshot, buildTarget, packageName))
      : [],
    bundles,
    bundleModules,
    redundantAssets,
    summary: {
      ...existingSummary,
      totalBundles,
      completedBundles,
      activeBundles: snapshot.state === "running" ? Number(existingSummary.activeBundles || 0) : 0,
      totalAssetBytes:
        toNonNegativeInteger(reportSummary.totalCompressedSizeBytes ?? reportSummary.totalUncompressedSizeBytes) ??
        Number(existingSummary.totalAssetBytes || 0),
      duplicateAssetCount:
        toNonNegativeInteger(reportSummary.duplicateAssetCount) ??
        redundantAssets.length ??
        Number(existingSummary.duplicateAssetCount || 0),
      totalRedundantSizeBytes:
        toNonNegativeInteger(reportSummary.totalRedundantSizeBytes) ??
        redundantAssets.reduce((total, item) => total + Number(item.redundantSizeBytes || 0), 0) ??
        Number(existingSummary.totalRedundantSizeBytes || 0),
    },
  };
}

function enrichMatchingRun(run, snapshot, buildTarget, packageName) {
  if (!run || run.runId !== snapshot.runId) {
    return run;
  }

  return enrichRun(run, buildTarget, packageName);
}

function enrichRun(run, buildTarget, packageName) {
  if (!run) {
    return run;
  }

  return {
    ...run,
    buildTarget: run.buildTarget || buildTarget,
    packageName: run.packageName || packageName,
  };
}

function sanitizeReportBundles(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, MAX_REPORT_BUNDLES)
    .map((item) => {
      const bundleName = cleanText(item?.bundleName || item?.name || "", MAX_NAME_LENGTH);
      return {
        bundleName,
        state: "success",
        startedAt: "",
        finishedAt: "",
        durationMs: 0,
        inputSizeBytes: toNonNegativeInteger(item?.uncompressedSizeBytes ?? item?.inputSizeBytes) || 0,
        sizeBytes: toNonNegativeInteger(item?.compressedSizeBytes ?? item?.sizeBytes) || 0,
        assetCount: toInteger(item?.assetCount) || 0,
        cached: false,
        completedBundles: null,
        totalBundles: null,
        metadata: sanitizeBundleMetadata(item),
      };
    })
    .filter((item) => item.bundleName)
    .sort((left, right) => right.sizeBytes - left.sizeBytes || left.bundleName.localeCompare(right.bundleName));
}

function sanitizeBundleMetadata(item) {
  return {
    fileName: cleanText(item?.fileName || "", MAX_NAME_LENGTH),
    moduleOwner: cleanText(item?.moduleOwner || "", MAX_NAME_LENGTH),
    directAssetCount: toInteger(item?.directAssetCount) || 0,
    dependencyAssetCount: toInteger(item?.dependencyAssetCount) || 0,
    isSmall: Boolean(item?.isSmall),
    isLarge: Boolean(item?.isLarge),
  };
}

function sanitizeReportRedundantAssets(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const assetPath = cleanText(item?.assetPath || item?.path || "", MAX_TEXT_LENGTH);
      return {
        assetPath,
        assetName: cleanText(item?.assetName || getAssetName(assetPath), MAX_NAME_LENGTH),
        assetType: cleanText(item?.assetType || "", MAX_NAME_LENGTH),
        duplicateCount: toNonNegativeInteger(item?.duplicateCount ?? item?.bundleCount) || 0,
        singleSizeBytes: toNonNegativeInteger(item?.singleSizeBytes ?? item?.buildSizeBytes) || 0,
        redundantSizeBytes: toNonNegativeInteger(item?.redundantSizeBytes) || 0,
        bundles: sanitizeRedundantAssetBundles(item?.bundles),
      };
    })
    .filter((item) => item.assetPath && item.duplicateCount > 1)
    .sort((left, right) => right.redundantSizeBytes - left.redundantSizeBytes || right.duplicateCount - left.duplicateCount)
    .slice(0, MAX_REDUNDANT_ASSETS);
}

function sanitizeRedundantAssetBundles(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, MAX_REDUNDANT_ASSET_BUNDLES)
    .map((item) => ({
      bundleName: cleanText(item?.bundleName || item?.name || "", MAX_NAME_LENGTH),
      copySizeBytes: toNonNegativeInteger(item?.copySizeBytes ?? item?.sizeBytes) || 0,
    }))
    .filter((item) => item.bundleName);
}

function createBundleModuleTree(children) {
  return [
    {
      key: "scene",
      label: SCENE_MODULE_LABEL,
      children: mergeBundleModuleChildren(children),
    },
  ];
}

function mergeBundleModuleChildren(children) {
  const byKey = new Map(
    BUNDLE_MODULE_DEFINITIONS.map((definition) => [
      definition.key,
      {
        key: definition.key,
        label: definition.label,
        bundleCount: 0,
        totalSizeBytes: 0,
        totalAssetCount: 0,
        bundles: [],
      },
    ]),
  );

  for (const child of children || []) {
    const key = normalizeBundleModuleKey(child?.key || child?.label || "");
    const current = byKey.get(key);
    if (!current) {
      continue;
    }

    current.label = bundleModuleLabel(key, child.label);
    current.bundleCount = toNonNegativeInteger(child.bundleCount) ?? current.bundleCount;
    current.totalSizeBytes = toNonNegativeInteger(child.totalSizeBytes) ?? current.totalSizeBytes;
    current.totalAssetCount = toNonNegativeInteger(child.totalAssetCount) ?? current.totalAssetCount;
    current.bundles = Array.isArray(child.bundles) ? child.bundles : current.bundles;
  }

  return BUNDLE_MODULE_DEFINITIONS.map((definition) => byKey.get(definition.key));
}

function buildBundleModuleChildren(bundles) {
  const byKey = new Map(
    BUNDLE_MODULE_DEFINITIONS.map((definition) => [
      definition.key,
      {
        key: definition.key,
        label: definition.label,
        bundleCount: 0,
        totalSizeBytes: 0,
        totalAssetCount: 0,
        bundles: [],
      },
    ]),
  );

  for (const bundle of bundles || []) {
    const key = classifyBundleModule(bundle.bundleName);
    const module = byKey.get(key) || byKey.get("common");
    const sizeBytes = Number(bundle.sizeBytes || bundle.inputSizeBytes || 0);
    const assetCount = Number(bundle.assetCount || 0);
    module.bundles.push({
      bundleName: bundle.bundleName,
      sizeBytes,
      assetCount,
    });
    module.bundleCount += 1;
    module.totalSizeBytes += sizeBytes;
    module.totalAssetCount += assetCount;
  }

  for (const module of byKey.values()) {
    module.bundles.sort((left, right) => right.sizeBytes - left.sizeBytes || left.bundleName.localeCompare(right.bundleName));
  }

  return BUNDLE_MODULE_DEFINITIONS.map((definition) => byKey.get(definition.key));
}

function classifyBundleModule(bundleName) {
  const normalized = String(bundleName || "").toLowerCase();
  if (normalized.includes("summer")) {
    return "summer";
  }
  if (normalized.includes("autumn")) {
    return "autumn";
  }
  if (normalized.includes("winter")) {
    return "winter";
  }
  return "common";
}

function normalizeBundleModuleKey(value) {
  const normalized = cleanText(value || "", MAX_NAME_LENGTH).toLowerCase();
  if (normalized === "summer" || normalized === "\u590f") {
    return "summer";
  }
  if (normalized === "autumn" || normalized === "\u79cb") {
    return "autumn";
  }
  if (normalized === "winter" || normalized === "\u51ac") {
    return "winter";
  }
  if (normalized === "common" || normalized === "shared" || normalized === "\u516c\u5171") {
    return "common";
  }
  return classifyBundleModule(normalized);
}

function bundleModuleLabel(key, fallback) {
  const definition = BUNDLE_MODULE_DEFINITIONS.find((item) => item.key === normalizeBundleModuleKey(key));
  return definition?.label || cleanText(fallback || "", MAX_NAME_LENGTH) || key;
}

function sanitizePathSegment(value) {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9_.-]+$/.test(text) ? text : "";
}

function sanitizeBuildNumber(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : "";
}

function cleanRootPath(value) {
  const text = String(value || "").trim();
  return text ? path.resolve(text) : "";
}

function appendSource(source, suffix) {
  const text = cleanText(source || "", MAX_NAME_LENGTH) || "postgres";
  return text.includes(suffix) ? text : `${text}+${suffix}`;
}

function toObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNonNegativeInteger(value) {
  const parsed = toInteger(value);
  if (parsed === null || parsed < 0) {
    return null;
  }
  return parsed;
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, maxLength);
}

function getAssetName(assetPath) {
  const text = cleanText(assetPath || "", MAX_TEXT_LENGTH).replace(/\\/g, "/");
  const index = text.lastIndexOf("/");
  return index >= 0 ? text.slice(index + 1) : text;
}
