import { open } from "node:fs/promises";
import path from "node:path";
import { agentSnapshot, agentTools, toolGroups } from "../data/studyAgent.js";

export const DEFAULT_STUDY_AGENT_DOCS_FILE = "/app/study-agent-docs/current.json";
export const MAX_STUDY_AGENT_DOCS_BYTES = 512 * 1024;

const REVISION = /^[a-f0-9]{40}$/;
const SOURCE_DIGEST = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,79}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const BAD_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export class StudyAgentDocsValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "StudyAgentDocsValidationError";
  }
}

function reject(field) {
  throw new StudyAgentDocsValidationError(`Invalid Study Agent document: ${field}`);
}

function record(value, field, keys, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) reject(field);
  const actual = Object.keys(value);
  if (actual.some((key) => !keys.includes(key) && !optional.includes(key)) || keys.some((key) => !Object.hasOwn(value, key))) reject(field);
}

function string(value, field, maxLength = 4000) {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength || BAD_CONTROL.test(value)) reject(field);
}

function list(value, field, maxLength, validate, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maxLength) reject(field);
  value.forEach((entry, index) => validate(entry, `${field}[${index}]`));
}

function identifier(value, field) {
  string(value, field, 80);
  if (!IDENTIFIER.test(value)) reject(field);
}

function timestamp(value, field) {
  string(value, field, 35);
  if (!ISO_DATE.test(value) || !Number.isFinite(Date.parse(value))) reject(field);
  // Date.parse normalizes invalid dates such as February 30; reject those too.
  const [date] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) reject(field);
}

function textList(value, field, maxLength = 24) {
  list(value, field, maxLength, (entry, name) => string(entry, name, 2000));
}

function titledBody(value, field) {
  record(value, field, ["title", "body"]);
  string(value.title, `${field}.title`, 120);
  string(value.body, `${field}.body`, 4000);
}

function jsonExample(value, field, depth = 0, budget = { nodes: 0 }) {
  if (depth > 8 || ++budget.nodes > 1200) reject(field);
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) reject(field);
    return;
  }
  if (typeof value === "string") {
    if (value.length > 8000 || BAD_CONTROL.test(value)) reject(field);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) reject(field);
    value.forEach((entry, index) => jsonExample(entry, `${field}[${index}]`, depth + 1, budget));
    return;
  }
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) reject(field);
  const keys = Object.keys(value);
  if (keys.length > 100 || keys.some((key) => !key || key.length > 120 || BAD_CONTROL.test(key) || UNSAFE_KEYS.has(key))) reject(field);
  keys.forEach((key) => jsonExample(value[key], `${field}.${key}`, depth + 1, budget));
}

/** Validate the public contract only. No model strings are interpreted as HTML or code. */
export function validateStudyAgentDocs(value) {
  record(value, "document", ["schemaVersion", "revision", "sourceDigest", "generatedAt", "generator", "overview", "toolGroups", "tools", "deployment"]);
  if (value.schemaVersion !== 1) reject("schemaVersion");
  if (typeof value.revision !== "string" || !REVISION.test(value.revision)) reject("revision");
  if (typeof value.sourceDigest !== "string" || !SOURCE_DIGEST.test(value.sourceDigest)) reject("sourceDigest");
  timestamp(value.generatedAt, "generatedAt");
  record(value.generator, "generator", ["engine", "model"]);
  if (value.generator.engine !== "study-agent") reject("generator.engine");
  string(value.generator.model, "generator.model", 160);

  record(value.overview, "overview", ["lead", "introduction", "workflow", "boundaries", "notes"]);
  string(value.overview.lead, "overview.lead", 1000);
  string(value.overview.introduction, "overview.introduction", 4000);
  list(value.overview.workflow, "overview.workflow", 16, titledBody, 1);
  list(value.overview.boundaries, "overview.boundaries", 32, titledBody);
  textList(value.overview.notes, "overview.notes");

  const groups = new Set();
  list(value.toolGroups, "toolGroups", 24, (group, field) => {
    record(group, field, ["id", "title"]);
    identifier(group.id, `${field}.id`);
    string(group.title, `${field}.title`, 120);
    if (groups.has(group.id)) reject(`${field}.id duplicate`);
    groups.add(group.id);
  }, 1);

  const tools = new Set();
  list(value.tools, "tools", 100, (tool, field) => {
    record(tool, field, ["id", "title", "group", "kind", "execution", "availability", "summary", "description", "parameters", "examplePrompt", "example", "result", "limits"], ["notes"]);
    identifier(tool.id, `${field}.id`);
    if (tools.has(tool.id)) reject(`${field}.id duplicate`);
    tools.add(tool.id);
    string(tool.title, `${field}.title`, 120);
    if (!groups.has(tool.group)) reject(`${field}.group`);
    if (!["function", "provider-hosted"].includes(tool.kind)) reject(`${field}.kind`);
    if (tool.execution !== (tool.kind === "provider-hosted" ? "provider" : "cloud")) reject(`${field}.execution`);
    string(tool.availability, `${field}.availability`, 1000);
    string(tool.summary, `${field}.summary`, 1000);
    string(tool.description, `${field}.description`, 6000);
    const parameters = new Set();
    list(tool.parameters, `${field}.parameters`, 48, (parameter, name) => {
      record(parameter, name, ["name", "type", "required", "description"]);
      string(parameter.name, `${name}.name`, 120);
      if (parameters.has(parameter.name)) reject(`${name}.name duplicate`);
      parameters.add(parameter.name);
      string(parameter.type, `${name}.type`, 240);
      if (typeof parameter.required !== "boolean") reject(`${name}.required`);
      string(parameter.description, `${name}.description`, 3000);
    });
    string(tool.examplePrompt, `${field}.examplePrompt`, 2000);
    if (!tool.example || typeof tool.example !== "object" || Array.isArray(tool.example)) reject(`${field}.example`);
    jsonExample(tool.example, `${field}.example`);
    if (Buffer.byteLength(JSON.stringify(tool.example), "utf8") > 32 * 1024) reject(`${field}.example size`);
    string(tool.result, `${field}.result`, 4000);
    textList(tool.limits, `${field}.limits`);
    if (Object.hasOwn(tool, "notes")) textList(tool.notes, `${field}.notes`);
  });

  record(value.deployment, "deployment", ["revision", "verifiedAt", "runtime", "mode"]);
  if (value.deployment.revision !== value.revision) reject("deployment.revision mismatch");
  timestamp(value.deployment.verifiedAt, "deployment.verifiedAt");
  if (value.deployment.runtime !== "native-pi" || value.deployment.mode !== "remote") reject("deployment runtime/mode");
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_STUDY_AGENT_DOCS_BYTES) reject("document size");
  return value;
}

function fallbackDocument(reason) {
  return {
    schemaVersion: 1,
    revision: agentSnapshot.revision,
    sourceDigest: null,
    generatedAt: null,
    generator: null,
    overview: {
      lead: "运行在云端的学习 Agent。在这里了解它怎样工作，以及快照记录的工具。",
      introduction: "桌面端负责交互，云端负责运行 Agent、执行工具并保存会话。此处显示的是 2026-10-24 的静态核对快照。",
      workflow: [
        { title: "在桌面端提出问题", body: "桌面应用连接已配置的云端运行环境，把问题发送给远程 Agent。" },
        { title: "模型选择工具", body: "Agent 将当前已启用、可直接调用的工具提供给模型；需要读取资料、执行命令或更新白板时，模型生成工具调用。" },
        { title: "云端执行并返回结果", body: "Pi runtime 在服务器执行工具，将结果送回模型，继续生成回答。会话记录保存在云端。" },
      ],
      boundaries: [
        { title: "文件与命令", body: "读写服务器可访问的文件，在云端执行 Bash 命令；桌面本地文件需要先传入云端。" },
        { title: "学习白板", body: "读取、编辑及撤销会话绑定的学习白板；编辑使用读取结果中的 readToken，发生冲突时重新读取。" },
        { title: "联网搜索", body: "快照版本未启用专用 Web Search / Tavily 搜索工具。模型联网出口与搜索工具是两件事。" },
        { title: "扩展与 MCP", body: "该次核对未发现启用的 MCP 配置。可选工具与内置扩展不计入默认工具清单。" },
        { title: "任务恢复", body: "会话记录保存在云端；断线恢复、长任务自动续跑及跨设备接续未在该次核查中验证。" },
      ],
      notes: [
        "静态内容依据该部署版本的服务状态、运行配置和工具注册代码整理，不能代表当前云端部署。",
        "该次核查未读取用户会话的实时工具列表，也未逐项执行工具。",
        "原 /study/ 网页服务与这里介绍的远程 Agent 是两个运行实例。远程 Agent 通过桌面端连接。",
      ],
    },
    toolGroups,
    tools: agentTools.map((tool) => ({ ...tool, kind: "function", execution: "cloud", availability: "静态快照中的默认远程会话工具" })),
    deployment: { revision: agentSnapshot.revision, verifiedAt: agentSnapshot.verifiedAt, runtime: "native-pi", mode: "remote" },
    source: { kind: "fallback", reason },
  };
}

/** Each call opens the current file again; atomic publication is visible on the next request. */
export async function loadStudyAgentDocs(options = {}) {
  const filePath = options.filePath ?? process.env.STUDY_AGENT_DOCS_FILE ?? DEFAULT_STUDY_AGENT_DOCS_FILE;
  const maxBytes = options.maxBytes ?? MAX_STUDY_AGENT_DOCS_BYTES;
  if (typeof filePath !== "string" || !path.isAbsolute(filePath)) return fallbackDocument("invalid-path");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_STUDY_AGENT_DOCS_BYTES) throw new TypeError("maxBytes must be a bounded positive integer");
  let file;
  try {
    file = await open(filePath, "r");
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maxBytes) return fallbackDocument("invalid-document");
    const buffer = Buffer.alloc(maxBytes + 1);
    let size = 0;
    while (size <= maxBytes) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > maxBytes) return fallbackDocument("invalid-document");
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size));
    const document = validateStudyAgentDocs(JSON.parse(text));
    return { ...document, source: { kind: "generated" } };
  } catch (error) {
    return fallbackDocument(error?.code === "ENOENT" ? "not-found" : error instanceof StudyAgentDocsValidationError || error instanceof SyntaxError || error instanceof TypeError ? "invalid-document" : "unavailable");
  } finally {
    if (file) await file.close().catch(() => {});
  }
}
