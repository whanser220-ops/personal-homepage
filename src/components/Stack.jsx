import { abilityCards } from "../data/homepage.js";
import { SectionHeading } from "./SectionHeading.jsx";
import { Badge } from "./ui/badge.jsx";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card.jsx";

export function Stack() {
  return (
    <section id="stack" className="section muted">
      <SectionHeading eyebrow="Stack" title="能力方向" />
      <div className="card-grid">
        {abilityCards.map((card) => (
          <Card
            className="info-card"
            data-topic={card.topic}
            data-progress={card.progress}
            key={card.topic}
            role="button"
            tabIndex={0}
            aria-label={`查看${card.title}能力`}
          >
            <CardHeader>
              <Badge className="card-index">{card.index}</Badge>
              <CardTitle>{card.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p>{card.body}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
