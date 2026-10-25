import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadStudyAgentDocs, validateStudyAgentDocs, StudyAgentDocsValidationError, MAX_STUDY_AGENT_DOCS_BYTES } from "../src/server/studyAgentDocs.js";

function documentFixture() {
  const revision = "a".repeat(40);
  const tool = {
    id: "new_tool", title: "新工具", group: "new_group", kind: "function", execution: "cloud", availability: "默认启用",
    summary: "工具摘要", description: "工具的公开说明", parameters: [{ name: "query", type: "string", required: true, description: "要查询的内容" }],
    examplePrompt: "查找相关资料", example: { query: "hello", options: { limit: 3 }, enabled: true }, result: "返回结果", limits: ["受云端权限限制"],
  };
  return {
    schemaVersion: 1, revision, sourceDigest: "c".repeat(64), generatedAt: "2026-10-25T01:00:00.000Z", generator: { engine: "study-agent", model: "test-model" },
    overview: { lead: "公开文档", introduction: "当前部署简介", workflow: [{ title: "开始", body: "发送任务" }], boundaries: [{ title: "范围", body: "执行范围" }], notes: ["不读取用户会话"] },
    toolGroups: [{ id: "new_group", title: "新分组" }, { id: "hosted", title: "提供方能力" }],
    tools: [tool, { ...tool, id: "web_search", title: "托管搜索", group: "hosted", kind: "provider-hosted", execution: "provider", parameters: [], example: { type: "web_search" } }],
    deployment: { revision, verifiedAt: "2026-10-25T00:59:00Z", runtime: "native-pi", mode: "remote" },
  };
}

async function temporaryFile(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "study-agent-docs-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return path.join(directory, "current.json");
}

test("accepts expandable function and provider-hosted tools, without interpreting strings", () => {
  const document = documentFixture();
  document.overview.lead = '<script>alert("text only")</script>';
  assert.equal(validateStudyAgentDocs(document), document);
  assert.equal(document.tools[1].kind, "provider-hosted");
  assert.equal(document.overview.lead, '<script>alert("text only")</script>');
});

test("accepts microsecond deployment receipts and bounded nanosecond ISO timestamps", () => {
  const document = documentFixture();
  document.deployment.verifiedAt = "2026-10-25T04:25:30.610132Z";
  document.generatedAt = "2026-10-25T12:27:38.123456789+08:00";
  assert.equal(document.generatedAt.length, 35);
  assert.equal(validateStudyAgentDocs(document), document);
});

const invalidDocuments = [
  ["unsupported schema", (doc) => { doc.schemaVersion = 2; }],
  ["short revision", (doc) => { doc.revision = "abcdef"; }],
  ["missing source digest", (doc) => { delete doc.sourceDigest; }],
  ["invalid source digest", (doc) => { doc.sourceDigest = "abcdef"; }],
  ["deployment revision mismatch", (doc) => { doc.deployment.revision = "b".repeat(40); }],
  ["unknown root field", (doc) => { doc.privateToken = "must not pass"; }],
  ["missing required metadata", (doc) => { delete doc.generator; }],
  ["wrong generator", (doc) => { doc.generator.engine = "external"; }],
  ["unknown nested field", (doc) => { doc.generator.apiKey = "must not pass"; }],
  ["invalid ISO timestamp", (doc) => { doc.generatedAt = "yesterday"; }],
  ["more than nine fractional digits", (doc) => { doc.deployment.verifiedAt = "2026-10-25T04:25:30.1234567890Z"; }],
  ["timestamp over the total length limit", (doc) => { doc.generatedAt = "2026-10-25T12:27:38.1234567890+08:00"; }],
  ["normalized invalid date", (doc) => { doc.generatedAt = "2026-02-30T00:00:00Z"; }],
  ["invalid deployment time", (doc) => { doc.deployment.verifiedAt = "2026-01-01"; }],
  ["wrong runtime", (doc) => { doc.deployment.runtime = "other"; }],
  ["wrong deployment mode", (doc) => { doc.deployment.mode = "local"; }],
  ["duplicate group", (doc) => { doc.toolGroups.push(doc.toolGroups[0]); }],
  ["duplicate tool", (doc) => { doc.tools.push(doc.tools[0]); }],
  ["missing group", (doc) => { doc.tools[0].group = "absent"; }],
  ["invalid URL identifier", (doc) => { doc.tools[0].id = "../escaped"; }],
  ["wrong tool kind", (doc) => { doc.tools[0].kind = "anything"; }],
  ["hosted execution mismatch", (doc) => { doc.tools[1].execution = "cloud"; }],
  ["function execution mismatch", (doc) => { doc.tools[0].execution = "provider"; }],
  ["wrong parameter type", (doc) => { doc.tools[0].parameters[0].required = "true"; }],
  ["duplicate parameter", (doc) => { doc.tools[0].parameters.push(doc.tools[0].parameters[0]); }],
  ["unknown parameter field", (doc) => { doc.tools[0].parameters[0].secret = "no"; }],
  ["oversized field", (doc) => { doc.overview.lead = "x".repeat(1001); }],
  ["control characters", (doc) => { doc.tools[0].description = "bad\u0000value"; }],
  ["empty required text", (doc) => { doc.tools[0].summary = "  "; }],
  ["too many tools", (doc) => { doc.tools = Array.from({ length: 101 }, (_, index) => ({ ...doc.tools[0], id: `tool_${index}` })); }],
  ["too many steps", (doc) => { doc.overview.workflow = Array(17).fill(doc.overview.workflow[0]); }],
  ["example is not an object", (doc) => { doc.tools[0].example = []; }],
  ["deep example", (doc) => { let nested = {}; doc.tools[0].example = nested; for (let i = 0; i < 10; i++) { nested.value = {}; nested = nested.value; } }],
  ["wide example", (doc) => { doc.tools[0].example = Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`key_${index}`, index])); }],
  ["prototype key", (doc) => { doc.tools[0].example = JSON.parse('{"__proto__":{"polluted":true}}'); }],
  ["non JSON number", (doc) => { doc.tools[0].example.value = Infinity; }],
  ["non object document", () => {} , null],
];

for (const [name, mutate, replacement] of invalidDocuments) {
  test(`rejects ${name}`, () => {
    const document = replacement === null ? null : documentFixture();
    if (document) mutate(document);
    assert.throws(() => validateStudyAgentDocs(document), StudyAgentDocsValidationError);
  });
}

test("reads current document on every call and observes a changed deployment", async (t) => {
  const filePath = await temporaryFile(t);
  const document = documentFixture();
  await writeFile(filePath, JSON.stringify(document));
  const first = await loadStudyAgentDocs({ filePath });
  assert.equal(first.source.kind, "generated");
  assert.equal(first.tools[1].execution, "provider");
  document.revision = document.deployment.revision = "b".repeat(40);
  document.overview.lead = "第二次请求读到的新内容";
  await writeFile(filePath, JSON.stringify(document));
  const second = await loadStudyAgentDocs({ filePath });
  assert.equal(second.revision, "b".repeat(40));
  assert.equal(second.overview.lead, "第二次请求读到的新内容");
});

test("missing document preserves dated static fallback with an explicit source", async (t) => {
  const filePath = await temporaryFile(t);
  const result = await loadStudyAgentDocs({ filePath });
  assert.deepEqual(result.source, { kind: "fallback", reason: "not-found" });
  assert.equal(result.deployment.verifiedAt, "2026-10-24 20:15");
  assert.equal(result.tools[0].id, "read");
  assert.equal(result.generatedAt, null);
});

test("malformed and invalid documents fall back without exposing input or diagnostics", async (t) => {
  const filePath = await temporaryFile(t);
  for (const contents of ['{"apiKey":"private-marker"}', "broken JSON", Buffer.from([0xff, 0xfe, 0xfd])]) {
    await writeFile(filePath, contents);
    const result = await loadStudyAgentDocs({ filePath });
    assert.deepEqual(result.source, { kind: "fallback", reason: "invalid-document" });
    assert.ok(!JSON.stringify(result).includes("private-marker"));
  }
});

test("rejects oversized files before parsing and supports a bounded test limit", async (t) => {
  const filePath = await temporaryFile(t);
  await writeFile(filePath, "x".repeat(MAX_STUDY_AGENT_DOCS_BYTES + 1));
  assert.equal((await loadStudyAgentDocs({ filePath })).source.kind, "fallback");
  await writeFile(filePath, JSON.stringify(documentFixture()));
  assert.equal((await loadStudyAgentDocs({ filePath, maxBytes: 64 })).source.reason, "invalid-document");
  await assert.rejects(loadStudyAgentDocs({ filePath, maxBytes: MAX_STUDY_AGENT_DOCS_BYTES + 1 }), TypeError);
});

test("rejects directories and relative paths", async (t) => {
  const filePath = await temporaryFile(t);
  await mkdir(filePath);
  assert.equal((await loadStudyAgentDocs({ filePath })).source.kind, "fallback");
  assert.deepEqual((await loadStudyAgentDocs({ filePath: "current.json" })).source, { kind: "fallback", reason: "invalid-path" });
});

test("uses the configured absolute file path without touching the production default", async (t) => {
  const filePath = await temporaryFile(t);
  await writeFile(filePath, JSON.stringify(documentFixture()));
  const previous = process.env.STUDY_AGENT_DOCS_FILE;
  process.env.STUDY_AGENT_DOCS_FILE = filePath;
  t.after(() => { if (previous === undefined) delete process.env.STUDY_AGENT_DOCS_FILE; else process.env.STUDY_AGENT_DOCS_FILE = previous; });
  assert.equal((await loadStudyAgentDocs()).source.kind, "generated");
});
