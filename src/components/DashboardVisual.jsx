export function DashboardVisual({ className = "", title = "WH" }) {
  return (
    <span className={`dashboard-visual ${className}`} aria-hidden="true">
      <svg viewBox="0 0 240 180" role="img">
        <rect className="visual-card visual-card-back" x="56" y="18" width="128" height="88" rx="10" />
        <rect className="visual-card visual-card-front" x="38" y="42" width="150" height="98" rx="12" />
        <path className="visual-line visual-line-one" d="M56 72H170" />
        <path className="visual-line visual-line-two" d="M56 94H142" />
        <path className="visual-line visual-line-three" d="M56 116H158" />
        <circle className="visual-dot visual-dot-one" cx="188" cy="42" r="12" />
        <circle className="visual-dot visual-dot-two" cx="44" cy="146" r="9" />
        <path className="visual-spark" d="M196 112L210 118L196 124L190 138L184 124L170 118L184 112L190 98Z" />
        <text x="112" y="102" textAnchor="middle">
          {title}
        </text>
      </svg>
    </span>
  );
}
