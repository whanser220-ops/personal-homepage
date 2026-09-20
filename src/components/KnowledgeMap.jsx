"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import index from "../data/knowledge-index.json";
import styles from "./KnowledgeMap.module.css";

const relationLabels = {
  hierarchy: "上级 / 下级",
  peer: "并列",
  related: "相关",
  composition: "组成",
  causal: "因果",
};

const articleById = new Map(index.articles.map((article) => [article.id, article]));

function relationText(relation) {
  const from = index.concepts.find((concept) => concept.id === relation.from)?.name || relation.from;
  const to = index.concepts.find((concept) => concept.id === relation.to)?.name || relation.to;
  return `${from} → ${to}`;
}

export function KnowledgeMap() {
  const [query, setQuery] = useState("");
  const [relationType, setRelationType] = useState("all");
  const [selectedId, setSelectedId] = useState("event-driven");
  const [focusOnly, setFocusOnly] = useState(false);

  const selected = index.concepts.find((concept) => concept.id === selectedId) || index.concepts[0];
  const selectedRelations = index.relations.filter((relation) => relation.from === selected.id || relation.to === selected.id);
  const neighborIds = new Set(selectedRelations.flatMap((relation) => [relation.from, relation.to]));

  const concepts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return index.concepts.filter((concept) => {
      const searchable = [concept.name, concept.id, ...(concept.aliases || []), concept.definition].join(" ").toLowerCase();
      const matchesQuery = !needle || searchable.includes(needle);
      const matchesType = relationType === "all" || index.relations.some((relation) =>
        relation.type === relationType && (relation.from === concept.id || relation.to === concept.id),
      );
      const matchesFocus = !focusOnly || neighborIds.has(concept.id);
      return matchesQuery && matchesType && matchesFocus;
    });
  }, [focusOnly, neighborIds, query, relationType]);

  const visibleRelations = index.relations.filter((relation) => {
    const matchesType = relationType === "all" || relation.type === relationType;
    const matchesFocus = !focusOnly || relation.from === selected.id || relation.to === selected.id;
    return matchesType && matchesFocus;
  });

  return (
    <section className={styles.mapShell} aria-label="概念知识地图">
      <header className={styles.mapHeader}>
        <div>
          <p className={styles.kicker}>CONCEPT MAP / REVISION {index.revision}</p>
          <h1>知识地图</h1>
          <p>每个节点是一个概念，文章只是它的解释资料。选中“事件驱动”，可以看到它和消息、回调、异步控制流之间的具体关系。</p>
        </div>
        <Link className={styles.backLink} href="/articles">← 返回文章</Link>
      </header>

      <div className={styles.controls}>
        <label>
          <span>搜索概念</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如：回调、异步、消息" />
        </label>
        <label>
          <span>关系类型</span>
          <select value={relationType} onChange={(event) => setRelationType(event.target.value)}>
            <option value="all">全部关系</option>
            {Object.entries(relationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <button className={styles.focusButton} aria-pressed={focusOnly} onClick={() => setFocusOnly((value) => !value)} type="button">
          {focusOnly ? "显示全图" : "只看当前相邻"}
        </button>
      </div>

      <div className={styles.legend} aria-label="关系方向说明">
        <span><i className={styles.dotCausal} />因果：前者通过机制改变后者</span>
        <span><i className={styles.dotComposition} />组成：整体由部分构成</span>
        <span><i className={styles.dotHierarchy} />层级：下级属于上级</span>
        <span><i className={styles.dotRelated} />相关：帮助解释但不表示组成</span>
      </div>

      <div className={styles.mapLayout}>
        <div className={styles.conceptGrid} aria-label="概念节点">
          {concepts.map((concept) => (
            <button
              aria-pressed={selected.id === concept.id}
              className={selected.id === concept.id ? styles.conceptCardActive : styles.conceptCard}
              key={concept.id}
              onClick={() => setSelectedId(concept.id)}
              type="button"
            >
              <span className={styles.domain}>{concept.domain}</span>
              <strong>{concept.name}</strong>
              <small>{concept.definition}</small>
            </button>
          ))}
          {!concepts.length ? <p className={styles.empty}>没有找到匹配的概念。</p> : null}
        </div>

        <aside className={styles.detailPanel} aria-live="polite">
          <p className={styles.detailLabel}>SELECTED CONCEPT</p>
          <h2>{selected.name}</h2>
          <p>{selected.definition}</p>
          <div className={styles.aliases}>别名：{(selected.aliases || []).join("、") || "无"}</div>

          <h3>相关文章</h3>
          <ul className={styles.articleLinks}>
            {(selected.articles || []).map((articleId) => {
              const article = articleById.get(articleId);
              return article ? <li key={article.id}><Link href={`/articles/${article.slug}`}>{article.title}</Link></li> : null;
            })}
          </ul>

          <h3>关系</h3>
          <div className={styles.relationList}>
            {selectedRelations.length ? selectedRelations.map((relation) => (
              <details key={relation.id} open={relation.type === "causal" || relation.type === "composition"}>
                <summary><span>{relationLabels[relation.type]}</span>{relationText(relation)}</summary>
                <p>{relation.reason}</p>
                <small>适用范围：{relation.scope}</small>
              </details>
            )) : <p>当前概念暂无已核实关系。</p>}
          </div>
        </aside>
      </div>

      <details className={styles.allRelations}>
        <summary>查看当前筛选下的全部关系（{visibleRelations.length}）</summary>
        <ul>
          {visibleRelations.map((relation) => <li key={relation.id}><b>{relationLabels[relation.type]}</b>{relationText(relation)}：{relation.reason}</li>)}
        </ul>
      </details>
    </section>
  );
}
