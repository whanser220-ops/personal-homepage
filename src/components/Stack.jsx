import { abilityCards } from "../data/homepage.js";
import { SectionHeading } from "./SectionHeading.jsx";

export function Stack() {
  return (
    <section id="stack" className="section muted">
      <SectionHeading eyebrow="Stack" title="能力方向" />
      <div className="card-grid">
        {abilityCards.map((card) => (
          <article
            className="info-card"
            data-topic={card.topic}
            data-progress={card.progress}
            key={card.topic}
            role="button"
            tabIndex={0}
            aria-label={`查看${card.title}能力`}
          >
            <span className="card-index">{card.index}</span>
            <h3>{card.title}</h3>
            <p>{card.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
