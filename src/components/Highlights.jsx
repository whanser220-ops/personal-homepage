import { focusItems, metrics } from "../data/homepage.js";
import { SectionHeading } from "./SectionHeading.jsx";

export function Highlights() {
  return (
    <section id="lab" className="section lab-section">
      <SectionHeading eyebrow="Highlights" title="当前主页状态" />
      <div className="lab-layout">
        <div className="lab-panel">
          <p className="lab-label">作品集完善度</p>
          <div className="progress-summary">
            <strong id="progressValue">42%</strong>
            <span id="progressLabel" aria-live="polite">
              正在整理个人介绍
            </span>
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-label="作品集完善度"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow="42"
          >
            <span id="progressFill" className="progress-fill" />
          </div>
          <div className="metric-grid" aria-label="主页数据">
            {metrics.map((metric) => (
              <div className="metric" key={metric.label}>
                <strong data-counter data-target={metric.target}>
                  0
                </strong>
                <span>{metric.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="lab-panel">
          <div className="lab-actions">
            <button className="button primary" id="playIntro" type="button">
              重播入场
            </button>
            <button className="button secondary" id="shuffleFocus" type="button">
              切换状态
            </button>
          </div>
          <div className="focus-list" aria-label="主页状态">
            {focusItems.map((item, index) => (
              <button
                className={`focus-item${index === 0 ? " is-active" : ""}`}
                data-focus={item.focus}
                data-progress={item.progress}
                key={item.title}
                type="button"
              >
                <span>{item.status}</span>
                <strong>{item.title}</strong>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
