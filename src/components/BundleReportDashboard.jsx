"use client";

import { useEffect, useMemo, useState } from "react";
import { Button as AntButton, Card as AntCard, Input as AntInput, Select as AntSelect, Tag as AntTag } from "antd";

const dataBasePath = "/bundle-report-data";
const pageSize = 50;

const emptyIndex = {
  latestReportId: "",
  reports: [],
};

export function BundleReportDashboard() {
  const [reportIndex, setReportIndex] = useState(emptyIndex);
  const [report, setReport] = useState(null);
  const [selectedReportId, setSelectedReportId] = useState("");
  const [filters, setFilters] = useState({
    moduleOwner: "",
    assetType: "",
    query: "",
  });
  const [duplicatePage, setDuplicatePage] = useState(1);
  const [bundlePage, setBundlePage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadInitialReport() {
      setIsLoading(true);
      setLoadError("");

      try {
        const indexResponse = await fetch(`${dataBasePath}/index.json`, { cache: "no-store" });
        if (!indexResponse.ok) {
          throw new Error(`index.json HTTP ${indexResponse.status}`);
        }

        const nextIndex = await indexResponse.json();
        const latestId = nextIndex.latestReportId || nextIndex.reports?.[0]?.id || "";
        const latestEntry = nextIndex.reports?.find((entry) => entry.id === latestId);
        const nextReport = await fetchReport(latestEntry);

        if (!isMounted) {
          return;
        }

        setReportIndex(nextIndex);
        setSelectedReportId(nextReport?.summary?.reportId || latestId);
        setReport(nextReport);
      } catch (error) {
        if (isMounted) {
          setLoadError(error instanceof Error ? error.message : "报告加载失败");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadInitialReport();

    return () => {
      isMounted = false;
    };
  }, []);

  const modules = useMemo(() => {
    if (!report) {
      return [];
    }

    return Array.from(
      new Set([
        ...report.bundles.map((bundle) => bundle.moduleOwner),
        ...report.duplicateAssets.flatMap((asset) => asset.moduleOwners),
      ].filter(Boolean)),
    ).sort((left, right) => left.localeCompare(right));
  }, [report]);

  const assetTypes = useMemo(() => {
    if (!report) {
      return [];
    }

    return Array.from(new Set(report.duplicateAssets.map((asset) => asset.assetType).filter(Boolean))).sort(
      (left, right) => left.localeCompare(right),
    );
  }, [report]);

  const filteredDuplicates = useMemo(() => {
    if (!report) {
      return [];
    }

    const query = filters.query.trim().toLowerCase();
    return report.duplicateAssets.filter((asset) => {
      const moduleMatch =
        !filters.moduleOwner || asset.moduleOwners.some((owner) => owner === filters.moduleOwner);
      const typeMatch = !filters.assetType || asset.assetType === filters.assetType;
      const queryMatch =
        !query ||
        asset.assetPath.toLowerCase().includes(query) ||
        asset.bundles.some((bundle) => bundle.bundleName.toLowerCase().includes(query));
      return moduleMatch && typeMatch && queryMatch;
    });
  }, [filters, report]);

  const filteredBundles = useMemo(() => {
    if (!report) {
      return [];
    }

    const query = filters.query.trim().toLowerCase();
    return report.bundles.filter((bundle) => {
      const moduleMatch = !filters.moduleOwner || bundle.moduleOwner === filters.moduleOwner;
      const queryMatch =
        !query ||
        bundle.bundleName.toLowerCase().includes(query) ||
        bundle.fileName.toLowerCase().includes(query) ||
        bundle.moduleOwner.toLowerCase().includes(query);
      return moduleMatch && queryMatch;
    });
  }, [filters, report]);

  const duplicateRows = paginate(filteredDuplicates, duplicatePage);
  const bundleRows = paginate(filteredBundles, bundlePage);

  async function selectReport(reportId) {
    setSelectedReportId(reportId);
    if (!reportId) {
      return;
    }

    setIsLoading(true);
    setLoadError("");

    try {
      const entry = reportIndex.reports.find((item) => item.id === reportId);
      const nextReport = await fetchReport(entry);
      setReport(nextReport);
      resetFilters();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "报告加载失败");
    } finally {
      setIsLoading(false);
    }
  }

  function updateFilter(key, value) {
    setFilters((current) => ({
      ...current,
      [key]: value,
    }));
    setDuplicatePage(1);
    setBundlePage(1);
  }

  function resetFilters() {
    setFilters({
      moduleOwner: "",
      assetType: "",
      query: "",
    });
    setDuplicatePage(1);
    setBundlePage(1);
  }

  if (isLoading && !report) {
    return (
      <ReportShell>
        <section className="report-empty">
          <h1>正在加载 YooAsset 构建分析报告</h1>
          <p>读取静态报告索引和最新构建数据。</p>
        </section>
      </ReportShell>
    );
  }

  if (!report) {
    return (
      <ReportShell>
        <section className="report-empty">
          <h1>暂无 YooAsset 构建分析报告</h1>
          <p>{loadError || "请先生成报告数据，或检查 public/bundle-report-data。"} </p>
          <code>public/bundle-report-data</code>
        </section>
      </ReportShell>
    );
  }

  return (
    <ReportShell
      title="YooAsset 构建分析报告"
      subtitle={`${report.summary.buildTarget} / ${report.summary.packageName} / ${report.summary.packageVersion}`}
      reportIndex={reportIndex}
      selectedReportId={selectedReportId}
      isLoading={isLoading}
      onSelectReport={selectReport}
    >
      {loadError && <AntTag color="error">报告加载失败：{loadError}</AntTag>}

      <section className="report-summary-grid" aria-label="概览">
        <SummaryStat label="Bundle 总数" value={formatInteger(report.summary.bundleCount)} />
        <SummaryStat label="资源总数" value={formatInteger(report.summary.assetCount)} />
        <SummaryStat
          label="重复资源"
          value={formatInteger(report.summary.duplicateAssetCount)}
          tone={report.summary.duplicateAssetCount > 0 ? "warning" : undefined}
        />
        <SummaryStat
          label="冗余总大小"
          value={formatBytes(report.summary.totalRedundantSizeBytes)}
          tone={report.summary.totalRedundantSizeBytes > 0 ? "danger" : undefined}
        />
        <SummaryStat label="压缩前总大小" value={formatBytes(report.summary.totalUncompressedSizeBytes)} />
        <SummaryStat label="压缩后总大小" value={formatBytes(report.summary.totalCompressedSizeBytes)} />
        <SummaryStat
          label={`小包 < ${formatBytes(report.thresholds.smallBundleBytes)}`}
          value={formatInteger(report.summary.smallBundleCount)}
          tone={report.summary.smallBundleCount > 0 ? "warning" : undefined}
        />
        <SummaryStat
          label={`超大包 >= ${formatBytes(report.thresholds.largeBundleBytes)}`}
          value={formatInteger(report.summary.largeBundleCount)}
          tone={report.summary.largeBundleCount > 0 ? "danger" : undefined}
        />
        <SummaryStat
          label="最大依赖深度"
          value={formatInteger(report.summary.maxDependencyDepth)}
          tone={
            report.summary.maxDependencyDepth >= report.thresholds.dependencyDepthWarningEdges
              ? "warning"
              : undefined
          }
        />
        <SummaryStat label="Unity" value={report.summary.unityVersion || "-"} />
        <SummaryStat label="YooAsset" value={report.summary.yooAssetVersion || "-"} />
        <SummaryStat label="生成时间" value={formatDate(report.summary.generatedAt)} />
      </section>

      <section className="report-filters" aria-label="筛选">
        <div className="report-filter">
          <label htmlFor="moduleFilter">模块</label>
          <AntSelect
            id="moduleFilter"
            allowClear
            placeholder="全部模块"
            value={filters.moduleOwner || undefined}
            onChange={(value) => updateFilter("moduleOwner", value || "")}
            options={modules.map((moduleOwner) => ({ label: moduleOwner, value: moduleOwner }))}
          />
        </div>
        <div className="report-filter">
          <label htmlFor="typeFilter">资源类型</label>
          <AntSelect
            id="typeFilter"
            allowClear
            placeholder="全部类型"
            value={filters.assetType || undefined}
            onChange={(value) => updateFilter("assetType", value || "")}
            options={assetTypes.map((assetType) => ({ label: assetType, value: assetType }))}
          />
        </div>
        <div className="report-filter">
          <label htmlFor="bundleSearch">资源路径 / Bundle 名称</label>
          <AntInput
            id="bundleSearch"
            value={filters.query}
            onChange={(event) => updateFilter("query", event.target.value)}
            placeholder="输入关键字"
          />
        </div>
        <div className="report-filter">
          <label>当前报告</label>
          <AntInput value={report.summary.reportId} readOnly />
        </div>
        <AntButton type="default" onClick={resetFilters}>
          清空筛选
        </AntButton>
      </section>

      <ReportSection title="重复资源表" subtitle={`${filteredDuplicates.length} / ${report.duplicateAssets.length} 项`}>
        <DuplicateAssetsTable rows={duplicateRows.items} />
        <Pager
          page={duplicatePage}
          totalPages={duplicateRows.totalPages}
          onPrev={() => setDuplicatePage((page) => Math.max(1, page - 1))}
          onNext={() => setDuplicatePage((page) => Math.min(duplicateRows.totalPages, page + 1))}
        />
      </ReportSection>

      <ReportSection title="Bundle 大小表" subtitle={`${filteredBundles.length} / ${report.bundles.length} 个`}>
        <BundlesTable rows={bundleRows.items} />
        <Pager
          page={bundlePage}
          totalPages={bundleRows.totalPages}
          onPrev={() => setBundlePage((page) => Math.max(1, page - 1))}
          onNext={() => setBundlePage((page) => Math.min(bundleRows.totalPages, page + 1))}
        />
      </ReportSection>

      <ReportSection
        title="小包报告"
        subtitle={`小于 ${formatBytes(report.thresholds.smallBundleBytes)} 的 Bundle 数量：${report.smallBundles.length}`}
      >
        <BundlesTable rows={report.smallBundles.slice(0, pageSize)} compact />
      </ReportSection>

      <ReportSection
        title="超大包报告"
        subtitle={`超过 ${formatBytes(report.thresholds.largeBundleBytes)} 的 Bundle 数量：${report.largeBundles.length}`}
      >
        <BundlesTable rows={report.largeBundles} compact />
      </ReportSection>

      <ReportSection
        title="依赖深度报告"
        subtitle={`告警阈值：${report.thresholds.dependencyDepthWarningEdges} 条边`}
      >
        <DependencyChainsTable rows={report.dependencyChains} />
      </ReportSection>
    </ReportShell>
  );
}

function ReportShell({
  title = "YooAsset 构建分析报告",
  subtitle = "Unity6 bundle report",
  reportIndex = emptyIndex,
  selectedReportId = "",
  isLoading = false,
  onSelectReport,
  children,
}) {
  return (
    <div className="report-page">
      <header className="report-topbar">
        <div className="report-topbar-inner">
          <div className="report-brand">
            <a href="/" className="report-home-link" aria-label="返回首页">
              <img src="/assets/site-logo.webp" alt="" width="34" height="34" />
              <span>Huang</span>
            </a>
            <div>
              <h1>{title}</h1>
              <p>{subtitle}</p>
            </div>
          </div>
          <div className="report-build-select">
            <label htmlFor="reportSelect">历史报告</label>
            <AntSelect
              id="reportSelect"
              value={selectedReportId}
              disabled={isLoading || reportIndex.reports.length === 0}
              onChange={(value) => onSelectReport?.(value)}
              options={
                reportIndex.reports.length === 0
                  ? [{ label: "暂无报告", value: "" }]
                  : reportIndex.reports.map((entry) => ({
                      label: `#${entry.packageVersion} · ${entry.buildTarget} · ${formatDate(entry.generatedAt)}`,
                      value: entry.id,
                    }))
              }
            />
          </div>
        </div>
      </header>
      <main className="report-main">{children}</main>
    </div>
  );
}

function ReportSection({ title, subtitle, children }) {
  return (
    <section className="report-section">
      <div className="report-section-header">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function SummaryStat({ label, value, tone }) {
  return (
    <AntCard className={`report-stat ${tone ? `report-stat-${tone}` : ""}`} variant="outlined">
      <span>{label}</span>
      <strong>{value}</strong>
    </AntCard>
  );
}

function DuplicateAssetsTable({ rows }) {
  if (rows.length === 0) {
    return <EmptyTable text="当前筛选条件下没有重复资源。" />;
  }

  return (
    <div className="report-table-wrap">
      <table>
        <thead>
          <tr>
            <th>资源路径</th>
            <th>资源类型</th>
            <th className="report-number">构建后大小</th>
            <th className="report-number">Bundle 数量</th>
            <th>所在 Bundle 列表</th>
            <th className="report-number">冗余总大小</th>
            <th>直接引用者</th>
            <th>模块归属</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((asset) => (
            <tr key={asset.assetPath}>
              <td className="report-path">{asset.assetPath}</td>
              <td>{asset.assetType || "-"}</td>
              <td className="report-number">{formatBytes(asset.buildSizeBytes)}</td>
              <td className="report-number">{asset.bundleCount}</td>
              <td>
                <div className="report-tags">
                  {asset.bundles.map((bundle) => (
                    <AntTag key={`${asset.assetPath}-${bundle.bundleName}`}>
                      {bundle.bundleName} · {formatBytes(bundle.copySizeBytes)}
                    </AntTag>
                  ))}
                </div>
              </td>
              <td className="report-number">{formatBytes(asset.redundantSizeBytes)}</td>
              <td>
                <ListCell values={asset.directReferrers} />
              </td>
              <td>
                <ListCell values={asset.moduleOwners} tag />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BundlesTable({ rows, compact = false }) {
  if (rows.length === 0) {
    return <EmptyTable text="当前筛选条件下没有 Bundle。" />;
  }

  return (
    <div className="report-table-wrap">
      <table>
        <thead>
          <tr>
            <th>Bundle 名称</th>
            <th>模块</th>
            <th className="report-number">压缩前大小</th>
            <th className="report-number">压缩后大小</th>
            <th className="report-number">资源数量</th>
            <th className="report-number">直接资源</th>
            <th className="report-number">依赖资源</th>
            {!compact && <th>依赖 Bundle</th>}
            {!compact && <th>引用者 Bundle</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((bundle) => (
            <tr key={bundle.bundleName}>
              <td className="report-path">{bundle.bundleName}</td>
              <td>{bundle.moduleOwner || "-"}</td>
              <td className="report-number">{formatBytes(bundle.uncompressedSizeBytes)}</td>
              <td className="report-number">
                {formatBytes(bundle.compressedSizeBytes)}
                {bundle.isLarge && <AntTag color="error">超大</AntTag>}
                {bundle.isSmall && <AntTag color="warning">小包</AntTag>}
              </td>
              <td className="report-number">{bundle.assetCount}</td>
              <td className="report-number">{bundle.directAssetCount}</td>
              <td className="report-number">{bundle.dependencyAssetCount}</td>
              {!compact && (
                <td>
                  <ListCell values={bundle.dependBundles} />
                </td>
              )}
              {!compact && (
                <td>
                  <ListCell values={bundle.referenceBundles} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DependencyChainsTable({ rows }) {
  if (rows.length === 0) {
    return <EmptyTable text="没有超过阈值的依赖深度链路。" />;
  }

  return (
    <div className="report-table-wrap">
      <table>
        <thead>
          <tr>
            <th>根 Bundle</th>
            <th className="report-number">依赖深度</th>
            <th>链路</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((chain) => (
            <tr key={`${chain.rootBundle}-${chain.chain.join(">")}`}>
              <td className="report-path">{chain.rootBundle}</td>
              <td className="report-number">{chain.depth}</td>
              <td>
                <div className="report-chain">
                  {chain.chain.map((bundle, index) => (
                    <span key={`${bundle}-${index}`} className="report-mono">
                      {index > 0 && <span className="report-arrow"> -&gt; </span>}
                      {bundle}
                    </span>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ListCell({ values, tag = false }) {
  if (!values || values.length === 0) {
    return <span className="report-mono">-</span>;
  }

  if (tag) {
    return (
      <div className="report-tags">
        {values.map((value) => (
          <AntTag key={value}>
            {value}
          </AntTag>
        ))}
      </div>
    );
  }

  return (
    <div className="report-path">
      {values.slice(0, 5).map((value) => (
        <div key={value}>{value}</div>
      ))}
      {values.length > 5 && <div>+{values.length - 5}</div>}
    </div>
  );
}

function EmptyTable({ text }) {
  return (
    <div className="report-table-wrap">
      <div className="report-empty">{text}</div>
    </div>
  );
}

function Pager({ page, totalPages, onPrev, onNext }) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="report-pager">
      <AntButton type="default" disabled={page <= 1} onClick={onPrev}>
        上一页
      </AntButton>
      <span>
        {page} / {totalPages}
      </span>
      <AntButton type="default" disabled={page >= totalPages} onClick={onNext}>
        下一页
      </AntButton>
    </div>
  );
}

async function fetchReport(entry) {
  const path = entry?.reportPath || "latest.json";
  const response = await fetch(`${dataBasePath}/${path}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${path} HTTP ${response.status}`);
  }

  return response.json();
}

function paginate(items, page) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const start = (currentPage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    totalPages,
  };
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatInteger(value) {
  return new Intl.NumberFormat("zh-CN").format(value || 0);
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value || "-";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
