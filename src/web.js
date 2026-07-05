#!/usr/bin/env node

import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs, readNumber } from "./utils/args.js";
import { ensureDirectory, findCompleteExportedTitles, listAudioFiles, readJson, titleFromFile } from "./utils/files.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const logsDir = path.join(root, "logs");
const defaultProfileDir = ".browser-profile-2026-06-01-02";
const defaultPollIntervalMinutes = 10;
const defaultPollInterval = defaultPollIntervalMinutes * 60 * 1000;
const defaultBatchSize = 50;
const defaultMaxRetries = 10;
const qianwenMaxBatchSize = 50;
const maxLogLines = 600;

const args = parseArgs(process.argv.slice(2));
const desiredPort = readNumber(args.port, 4317);
const shouldOpen = Boolean(args.open);

let child = null;
let currentJob = null;
let lastExit = null;
let logLines = [];

await ensureDirectory(logsDir);
const server = http.createServer(handleRequest);
const port = await listen(server, desiredPort);
const url = `http://127.0.0.1:${port}`;
console.log(`Qianwen Web UI: ${url}`);
if (shouldOpen) openBrowser(url);

async function handleRequest(request, response) {
  try {
    const requestUrl = new URL(request.url, url);
    if (request.method === "GET" && requestUrl.pathname === "/") {
      return sendHtml(response, renderApp());
    }
    if (request.method === "GET" && requestUrl.pathname === "/api/status") {
      return sendJson(response, await getStatus());
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/preview") {
      const body = await readBody(request);
      return sendJson(response, await previewJob(body));
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/start") {
      const body = await readBody(request);
      return sendJson(response, await startJob(body));
    }
    if (request.method === "POST" && requestUrl.pathname === "/api/stop") {
      return sendJson(response, stopJob());
    }
    if (request.method === "GET" && !requestUrl.pathname.startsWith("/api/")) {
      return sendHtml(response, renderApp());
    }
    sendJson(response, { error: "Not found" }, 404);
  } catch (error) {
    sendJson(response, { error: error.message || String(error) }, 500);
  }
}

async function startJob(body) {
  if (isRunning()) {
    return { ok: false, error: "已有任务正在运行，请先停止或等待完成。" };
  }

  const uploadDir = cleanPath(body.uploadDir);
  const downloadDir = cleanPath(body.downloadDir);
  if (!uploadDir || !downloadDir) {
    return { ok: false, error: "录音路径和下载路径都必须填写。" };
  }

  const preview = await previewJob({ uploadDir, downloadDir });
  if (!preview.ok) return preview;

  const profileDir = defaultProfileDir;
  const folderUrl = cleanPath(body.folderUrl);
  const transcriptConfig = normalizeTranscriptConfig(body);
  const exportConfig = normalizeExportConfig(body);
  const batchSize = Math.min(readNumber(body.batchSize, defaultBatchSize), qianwenMaxBatchSize);
  const maxRetries = readNumber(body.maxRetries, defaultMaxRetries);
  const retryCooldownMinutes = readNumber(body.retryCooldownMinutes, 10);
  const pollIntervalMinutes = readNumber(body.pollIntervalMinutes ?? body.pollInterval, defaultPollIntervalMinutes);
  const pollInterval = pollIntervalMinutes * 60 * 1000;
  const exportBatchSize = readNumber(body.exportBatchSize, 12);

  const stamp = timestamp();
  const outLog = path.join(logsDir, `web-run-${stamp}.out.log`);
  const errLog = path.join(logsDir, `web-run-${stamp}.err.log`);
  const cliArgs = [
    path.join(root, "src", "cli.js"),
    "--upload-dir", uploadDir,
    "--download-dir", downloadDir,
    "--profile-dir", profileDir,
    "--batch-size", String(batchSize),
    "--export-batch-size", String(exportBatchSize),
    "--max-retries", String(maxRetries),
    "--retry-cooldown-minutes", String(retryCooldownMinutes),
    "--poll-interval", String(pollInterval)
  ];
  if (folderUrl) cliArgs.push("--folder-url", folderUrl);
  cliArgs.push("--speaker-mode", transcriptConfig.speakerMode);
  cliArgs.push("--export-options", JSON.stringify(exportConfig));

  logLines = [];
  lastExit = null;
  currentJob = {
    uploadDir,
    downloadDir,
    folderUrl,
    profileDir,
    transcriptConfig,
    exportConfig,
    batchSize,
    exportBatchSize,
    maxRetries,
    retryCooldownMinutes,
    pollIntervalMinutes,
    pollInterval,
    startedAt: new Date().toISOString(),
    outLog,
    errLog
  };

  child = spawn(process.execPath, cliArgs, {
    cwd: root,
    windowsHide: false,
    stdio: ["ignore", "pipe", "pipe"]
  });

  const outFile = await fs.open(outLog, "a");
  const errFile = await fs.open(errLog, "a");
  child.stdout.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    appendLog("out", text);
    outFile.write(text).catch(() => null);
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    appendLog("err", text);
    errFile.write(text).catch(() => null);
  });
  child.on("exit", async (code, signal) => {
    lastExit = { code, signal, at: new Date().toISOString() };
    appendLog("system", `任务已结束：code=${code ?? "-"} signal=${signal ?? "-"}\n`);
    child = null;
    await outFile.close().catch(() => null);
    await errFile.close().catch(() => null);
  });

  return { ok: true, pid: child.pid, status: await getStatus() };
}

function stopJob() {
  if (!isRunning()) return { ok: true, stopped: false };
  const pid = child.pid;
  child.kill();
  appendLog("system", `已请求停止任务：pid=${pid}\n`);
  return { ok: true, stopped: true, pid };
}

async function previewJob(body) {
  const uploadDir = cleanPath(body.uploadDir);
  const downloadDir = cleanPath(body.downloadDir);
  if (!uploadDir || !downloadDir) {
    return { ok: false, error: "请先填写录音路径和下载路径。" };
  }
  const uploadStat = await fs.stat(uploadDir).catch(() => null);
  if (!uploadStat?.isDirectory()) {
    return { ok: false, error: `录音路径不存在：${uploadDir}` };
  }
  await ensureDirectory(downloadDir);
  const audioFiles = await listAudioFiles(uploadDir);
  const titles = audioFiles.map(titleFromFile);
  const exported = await findCompleteExportedTitles(downloadDir, titles, normalizeExportConfig(body));
  return {
    ok: true,
    uploadDir,
    downloadDir,
    folderName: path.basename(path.resolve(downloadDir)),
    audioTotal: audioFiles.length,
    exportedTotal: exported.size,
    pendingTotal: Math.max(0, audioFiles.length - exported.size),
    sampleTitles: titles.slice(0, 8)
  };
}

async function getStatus() {
  const job = currentJob;
  const stats = job ? await collectStats(job).catch((error) => ({ error: error.message })) : null;
  return {
    running: isRunning(),
    pid: child?.pid || null,
    job,
    stats,
    lastExit,
    logs: logLines.slice(-maxLogLines)
  };
}

async function collectStats(job) {
  const audioFiles = await listAudioFiles(job.uploadDir).catch(() => []);
  const titles = audioFiles.map(titleFromFile);
  const exported = await findCompleteExportedTitles(job.downloadDir, titles, job.exportConfig || {});
  const stateFile = path.join(job.downloadDir, "qianwen-exporter-state.json");
  const state = await readJson(stateFile, {});
  const attempts = state.uploadAttemptsV2 || {};
  const failedTitles = titles.filter((title) => !exported.has(title) && Number(attempts[title]?.count || 0) >= job.maxRetries);
  const activeTitles = titles.filter((title) => !exported.has(title) && !failedTitles.includes(title));
  const attemptValues = Object.values(attempts);
  return {
    total: titles.length,
    success: exported.size,
    failed: failedTitles.length,
    active: activeTitles.length,
    attempted: attemptValues.length,
    maxAttemptCount: attemptValues.reduce((max, item) => Math.max(max, Number(item.count || 0)), 0),
    latestAttemptAt: attemptValues.reduce((max, item) => Math.max(max, Number(item.lastAttemptAt || 0)), 0),
    failedTitles,
    activeTitles,
    successfulTitles: titles.filter((title) => exported.has(title)),
    stateFile
  };
}

function appendLog(type, text) {
  const lines = text.replace(/\r/g, "").split("\n");
  for (const line of lines) {
    if (!line) continue;
    logLines.push({ type, text: line, at: new Date().toISOString() });
  }
  if (logLines.length > maxLogLines) {
    logLines = logLines.slice(-maxLogLines);
  }
}

function isRunning() {
  return Boolean(child && !child.killed);
}

function cleanPath(value) {
  return String(value || "").trim().replace(/^"|"$/g, "");
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function inferMonthFromPath(value) {
  const text = String(value || "");
  const match = text.match(/20\d{2}-\d{2}/);
  return match ? match[0] : currentMonth();
}

function normalizeTranscriptConfig(body) {
  return {
    language: pick(body.language, ["zh", "en", "ja", "yue", "zh_en"], "zh"),
    translation: pick(body.translation, ["none", "en", "ja"], "none"),
    speakerMode: pick(body.speakerMode, ["none", "single", "two", "multi"], "multi")
  };
}

function normalizeExportConfig(body) {
  return {
    original: Boolean(body.exportOriginal ?? true),
    guide: Boolean(body.exportGuide ?? false),
    audio: Boolean(body.exportAudio ?? false),
    notes: Boolean(body.exportNotes ?? false),
    originalFormat: pick(body.originalFormat, ["docx", "pdf", "md", "txt", "srt"], "md"),
    guideFormat: pick(body.guideFormat, ["docx", "pdf", "md", "txt", "srt"], "docx"),
    notesFormat: pick(body.notesFormat, ["docx", "pdf", "md", "txt", "srt"], "docx"),
    originalSpeaker: Boolean(body.originalSpeaker ?? true),
    originalTimestamp: Boolean(body.originalTimestamp ?? true)
  };
}

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, data, status = 200) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(data));
}

function sendHtml(response, html) {
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(html);
}

function listen(httpServer, startPort) {
  return new Promise((resolve, reject) => {
    const tryPort = (candidate) => {
      httpServer.once("error", (error) => {
        if (error.code === "EADDRINUSE" && candidate < startPort + 20) {
          httpServer.removeAllListeners("listening");
          tryPort(candidate + 1);
        } else {
          reject(error);
        }
      });
      httpServer.once("listening", () => resolve(candidate));
      httpServer.listen(candidate, "127.0.0.1");
    };
    tryPort(startPort);
  });
}

function openBrowser(targetUrl) {
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", targetUrl], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("open", [targetUrl], { detached: true, stdio: "ignore" }).unref();
  }
}

function renderApp() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>千问录音转文字控制台</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f3;
      --panel: #ffffff;
      --ink: #202124;
      --muted: #6b6f76;
      --line: #d8dcd5;
      --accent: #19766b;
      --accent-strong: #115e56;
      --warn: #a45f18;
      --bad: #b23a48;
      --soft: #edf6f4;
      --shadow: 0 18px 45px rgba(35, 39, 42, 0.09);
      font-family: "Microsoft YaHei UI", "Microsoft YaHei", Segoe UI, Arial, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-size: 15px;
      letter-spacing: 0;
    }
    .shell {
      min-height: 100vh;
      display: grid;
      grid-template-rows: auto 1fr;
    }
    header {
      border-bottom: 1px solid var(--line);
      background: #ffffff;
    }
    .bar {
      max-width: 1320px;
      margin: 0 auto;
      padding: 18px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
    }
    h1 {
      margin: 0;
      font-size: 22px;
      line-height: 1.25;
      font-weight: 700;
    }
    .sub {
      color: var(--muted);
      margin-top: 4px;
      font-size: 13px;
    }
    .status-pill {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 8px 13px;
      min-width: 110px;
      text-align: center;
      background: #f8faf8;
      font-weight: 700;
      white-space: nowrap;
    }
    .status-pill.running {
      color: var(--accent-strong);
      border-color: #9bcac3;
      background: var(--soft);
    }
    .top-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .nav-link {
      display: inline-flex;
      align-items: center;
      min-height: 38px;
      padding: 8px 12px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: #fff;
      color: var(--ink);
      text-decoration: none;
      font-weight: 700;
      font-size: 13px;
      white-space: nowrap;
    }
    .nav-link.active {
      border-color: #8cc1ba;
      background: var(--soft);
      color: var(--accent-strong);
    }
    main {
      max-width: 1320px;
      width: 100%;
      margin: 0 auto;
      padding: 22px 24px 32px;
      display: grid;
      grid-template-columns: minmax(360px, 430px) minmax(0, 1fr);
      gap: 18px;
      align-items: start;
    }
    section, .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      box-shadow: var(--shadow);
    }
    .form-panel {
      padding: 18px;
    }
    .field {
      margin-bottom: 14px;
    }
    label {
      display: block;
      font-weight: 700;
      margin-bottom: 7px;
      font-size: 13px;
    }
    .hint {
      margin-top: 6px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }
    input {
      width: 100%;
      min-height: 42px;
      border: 1px solid #c7ccc5;
      border-radius: 6px;
      padding: 10px 11px;
      color: var(--ink);
      background: #fff;
      outline: none;
      font: inherit;
    }
    input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(25, 118, 107, 0.14);
    }
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .config-block {
      margin-top: 18px;
      padding-top: 16px;
      border-top: 1px solid var(--line);
    }
    .config-title {
      margin: 0 0 12px;
      font-size: 16px;
      line-height: 1.25;
    }
    .choice-group {
      margin-bottom: 14px;
    }
    .choice-label {
      display: block;
      font-weight: 700;
      margin-bottom: 8px;
      font-size: 13px;
    }
    .segmented {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .segmented input,
    .export-row input[type="checkbox"],
    .info-tags input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }
    .segmented span {
      display: inline-flex;
      align-items: center;
      min-height: 34px;
      padding: 7px 11px;
      border: 1px solid #cfd5cc;
      border-radius: 999px;
      background: #fff;
      color: var(--ink);
      cursor: pointer;
      user-select: none;
      font-size: 13px;
    }
    .segmented input:checked + span {
      color: var(--accent-strong);
      border-color: #8cc1ba;
      background: var(--soft);
      font-weight: 700;
    }
    .export-settings {
      display: grid;
      gap: 10px;
    }
    .export-row {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      background: #fff;
    }
    .export-head {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 700;
      margin-bottom: 10px;
    }
    .checkmark {
      width: 18px;
      height: 18px;
      border-radius: 4px;
      border: 1px solid #aeb5ad;
      background: #fff;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 13px;
      line-height: 1;
    }
    .export-head input:checked + .checkmark {
      background: #2b2f32;
      border-color: #2b2f32;
    }
    .export-head input:checked + .checkmark::after {
      content: "✓";
    }
    .export-grid {
      display: grid;
      grid-template-columns: minmax(120px, 0.34fr) minmax(0, 1fr);
      gap: 9px 10px;
      align-items: center;
      padding-left: 28px;
    }
    .export-grid .muted-label {
      color: #3f4548;
      font-size: 13px;
    }
    select {
      width: 100%;
      min-height: 40px;
      border: 1px solid #c7ccc5;
      border-radius: 8px;
      padding: 8px 11px;
      color: var(--ink);
      background: #fff;
      font: inherit;
    }
    .info-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
    }
    .info-tags span {
      display: inline-flex;
      align-items: center;
      min-height: 32px;
      padding: 6px 10px;
      border-radius: 6px;
      background: #f2f4f7;
      border: 1px solid #e3e7ed;
      cursor: pointer;
      user-select: none;
    }
    .info-tags input:checked + span {
      background: #eef3ff;
      border-color: #cdd8ff;
      color: #233b8f;
      font-weight: 700;
    }
    .actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-top: 16px;
    }
    button {
      border: 1px solid transparent;
      border-radius: 6px;
      min-height: 42px;
      padding: 9px 12px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
      background: #eef1ec;
      color: var(--ink);
    }
    button.primary {
      background: var(--accent);
      color: white;
    }
    button.primary:hover { background: var(--accent-strong); }
    button.danger {
      color: var(--bad);
      border-color: #e1b5bb;
      background: #fff7f8;
    }
    button:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .mini-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
    }
    .mini-actions button {
      min-height: 36px;
      font-size: 13px;
      padding: 7px 10px;
    }
    .preview {
      margin-top: 14px;
      padding: 12px;
      border-radius: 6px;
      background: #f8faf8;
      border: 1px solid var(--line);
      color: var(--muted);
      font-size: 13px;
      min-height: 44px;
    }
    .dashboard {
      display: grid;
      gap: 14px;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }
    .metric {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
      min-height: 88px;
    }
    .metric span {
      display: block;
      color: var(--muted);
      font-size: 12px;
      margin-bottom: 9px;
    }
    .metric strong {
      font-size: 28px;
      line-height: 1;
    }
    .progress {
      height: 12px;
      border-radius: 999px;
      overflow: hidden;
      background: #e8ece7;
      border: 1px solid var(--line);
    }
    .progress > div {
      height: 100%;
      width: 0%;
      background: var(--accent);
      transition: width 250ms ease;
    }
    .lists {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }
    .list-panel {
      padding: 14px;
    }
    .list-panel h2, .log-panel h2 {
      margin: 0 0 10px;
      font-size: 15px;
    }
    ul {
      list-style: none;
      padding: 0;
      margin: 0;
      max-height: 230px;
      overflow: auto;
      border-top: 1px solid var(--line);
    }
    li {
      padding: 8px 0;
      border-bottom: 1px solid #edf0ec;
      font-size: 13px;
      overflow-wrap: anywhere;
    }
    .log-panel {
      padding: 14px;
    }
    pre {
      margin: 0;
      min-height: 280px;
      max-height: 460px;
      overflow: auto;
      background: #202124;
      color: #f1f3f4;
      border-radius: 6px;
      padding: 12px;
      font-family: Consolas, "Cascadia Mono", monospace;
      font-size: 12px;
      line-height: 1.55;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .muted { color: var(--muted); }
    .err { color: #ffb5bf; }
    @media (max-width: 980px) {
      main { grid-template-columns: 1fr; }
      .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 620px) {
      .bar { align-items: flex-start; flex-direction: column; }
      main { padding: 14px; }
      .grid-2, .actions, .lists, .metrics { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <header>
      <div class="bar">
        <div>
          <h1>千问录音转文字控制台</h1>
          <div class="sub">本地运行 · 批量上传 · 自动导出 · 断点续跑</div>
        </div>
        <div class="top-actions">
          <a class="nav-link active" href="/">录音转文字</a>
          <div id="runState" class="status-pill">未运行</div>
        </div>
      </div>
    </header>
    <main>
      <section class="form-panel">
        <div class="field">
          <label for="uploadDir">录音所在路径</label>
          <input id="uploadDir" autocomplete="off" placeholder="例如 D:\\Desktop\\微信电话录音\\2026-06\\2026-06-15~06-25">
        </div>
        <div class="field">
          <label for="downloadDir">文字稿下载路径</label>
          <input id="downloadDir" autocomplete="off" placeholder="可以和录音路径相同">
        </div>
        <div class="field">
          <label for="folderUrl">千问网页地址</label>
          <input id="folderUrl" autocomplete="off" placeholder="https://www.qianwen.com/creations/">
          <div class="hint">留空则默认网址为 https://www.qianwen.com/creations/</div>
        </div>
        <div class="config-block">
          <h2 class="config-title">录音转写配置</h2>
          <div class="choice-group">
            <span class="choice-label">音视频语音</span>
            <div class="segmented" data-radio-group="language">
              <label><input type="radio" name="language" value="zh" checked><span>中文</span></label>
              <label><input type="radio" name="language" value="en"><span>英语</span></label>
              <label><input type="radio" name="language" value="ja"><span>日语</span></label>
              <label><input type="radio" name="language" value="yue"><span>粤语</span></label>
              <label><input type="radio" name="language" value="zh_en"><span>中英文自由说</span></label>
            </div>
          </div>
          <div class="choice-group">
            <span class="choice-label">翻译</span>
            <div class="segmented" data-radio-group="translation">
              <label><input type="radio" name="translation" value="none" checked><span>不翻译</span></label>
              <label><input type="radio" name="translation" value="en"><span>英语</span></label>
              <label><input type="radio" name="translation" value="ja"><span>日语</span></label>
            </div>
          </div>
          <div class="choice-group">
            <span class="choice-label">区分发言人</span>
            <div class="segmented" data-radio-group="speakerMode">
              <label><input type="radio" name="speakerMode" value="none"><span>暂不体验</span></label>
              <label><input type="radio" name="speakerMode" value="single"><span>单人演讲</span></label>
              <label><input type="radio" name="speakerMode" value="two"><span>2人对话</span></label>
              <label><input type="radio" name="speakerMode" value="multi" checked><span>多人讨论</span></label>
            </div>
          </div>
        </div>
        <div class="config-block">
          <h2 class="config-title">导出设置</h2>
          <div class="export-settings">
            <div class="export-row">
              <label class="export-head"><input id="exportOriginal" type="checkbox" checked><span class="checkmark"></span><span>原文</span></label>
              <div class="export-grid">
                <span class="muted-label">文档格式</span>
                <select id="originalFormat">
                  <option value="docx">.docx</option>
                  <option value="pdf">.pdf</option>
                  <option value="txt">.txt</option>
                  <option value="md" selected>.md</option>
                  <option value="srt">.srt</option>
                </select>
                <span class="muted-label">显示信息</span>
                <div class="info-tags">
                  <label><input id="originalSpeaker" type="checkbox" checked><span>发言人 ×</span></label>
                  <label><input id="originalTimestamp" type="checkbox" checked><span>时间戳 ×</span></label>
                </div>
              </div>
            </div>
            <div class="export-row">
              <label class="export-head"><input id="exportGuide" type="checkbox"><span class="checkmark"></span><span>导读</span></label>
              <div class="export-grid">
                <span class="muted-label">文档格式</span>
                <select id="guideFormat">
                  <option value="docx" selected>.docx</option>
                  <option value="pdf">.pdf</option>
                  <option value="md">.md</option>
                  <option value="txt">.txt</option>
                  <option value="srt">.srt</option>
                </select>
              </div>
            </div>
            <div class="export-row">
              <label class="export-head"><input id="exportAudio" type="checkbox"><span class="checkmark"></span><span>音视频</span></label>
              <div class="export-grid">
                <span class="muted-label">文档格式</span>
                <span>.mp3 或 mp4</span>
              </div>
            </div>
            <div class="export-row">
              <label class="export-head"><input id="exportNotes" type="checkbox"><span class="checkmark"></span><span>笔记</span></label>
              <div class="export-grid">
                <span class="muted-label">文档格式</span>
                <select id="notesFormat">
                  <option value="docx" selected>.docx</option>
                  <option value="pdf">.pdf</option>
                  <option value="txt">.txt</option>
                  <option value="md">.md</option>
                  <option value="srt">.srt</option>
                </select>
              </div>
            </div>
          </div>
        </div>
        <div class="grid-2">
          <div class="field">
            <label for="batchSize">每轮上传数量</label>
            <input id="batchSize" type="number" min="1" value="${defaultBatchSize}">
            <div class="hint">按本次录音数量自动取不超过该值的数量；千问网站每轮最大上传数量为 ${qianwenMaxBatchSize}。</div>
          </div>
          <div class="field">
            <label for="maxRetries">重试上限</label>
            <input id="maxRetries" type="number" min="1" value="${defaultMaxRetries}">
          </div>
        </div>
        <div class="grid-2">
          <div class="field">
            <label for="retryCooldownMinutes">重试冷却（分钟）</label>
            <input id="retryCooldownMinutes" type="number" min="1" value="10">
          </div>
          <div class="field">
            <label for="pollInterval">检查间隔（分钟）</label>
            <input id="pollInterval" type="number" min="1" value="${defaultPollIntervalMinutes}">
          </div>
        </div>
        <div class="actions">
          <button id="previewBtn">预检</button>
          <button id="startBtn" class="primary">启动</button>
          <button id="stopBtn" class="danger">停止</button>
          <button id="sameBtn">下载同路径</button>
        </div>
        <div id="preview" class="preview">填写路径后先预检，再启动。</div>
      </section>
      <div class="dashboard">
        <div class="metrics">
          <div class="metric"><span>录音总数</span><strong id="total">0</strong></div>
          <div class="metric"><span>成功导出</span><strong id="success">0</strong></div>
          <div class="metric"><span>处理中</span><strong id="active">0</strong></div>
          <div class="metric"><span>失败放弃</span><strong id="failed">0</strong></div>
        </div>
        <div class="panel" style="padding:14px;">
          <div class="progress"><div id="progressBar"></div></div>
          <div id="progressText" class="muted" style="margin-top:8px;font-size:13px;">等待任务开始</div>
        </div>
        <div class="lists">
          <section class="list-panel">
            <h2>失败录音</h2>
            <ul id="failedList"></ul>
          </section>
          <section class="list-panel">
            <h2>仍在处理</h2>
            <ul id="activeList"></ul>
          </section>
        </div>
        <section class="log-panel panel">
          <h2>运行日志</h2>
          <pre id="logs"></pre>
        </section>
      </div>
    </main>
  </div>
  <script>
    const $ = (id) => document.getElementById(id);
    const fields = ["uploadDir", "downloadDir", "folderUrl", "batchSize", "maxRetries", "retryCooldownMinutes", "pollInterval", "language", "translation", "speakerMode", "exportOriginal", "exportGuide", "exportAudio", "exportNotes", "originalFormat", "guideFormat", "notesFormat", "originalSpeaker", "originalTimestamp"];
    const saved = JSON.parse(localStorage.getItem("qianwenWebUi") || "{}");
    applySaved(saved);

    $("sameBtn").addEventListener("click", () => { $("downloadDir").value = $("uploadDir").value; saveForm(); });
    $("previewBtn").addEventListener("click", preview);
    $("startBtn").addEventListener("click", start);
    $("stopBtn").addEventListener("click", stop);
    for (const node of document.querySelectorAll("input, select")) node.addEventListener("input", saveForm);
    for (const node of document.querySelectorAll("input[type=radio], input[type=checkbox], select")) node.addEventListener("change", saveForm);

    function formData() {
      return {
        uploadDir: $("uploadDir").value.trim(),
        downloadDir: $("downloadDir").value.trim(),
        folderUrl: $("folderUrl").value.trim(),
        batchSize: $("batchSize").value.trim(),
        maxRetries: $("maxRetries").value.trim(),
        retryCooldownMinutes: $("retryCooldownMinutes").value.trim(),
        pollInterval: $("pollInterval").value.trim(),
        language: checkedValue("language"),
        translation: checkedValue("translation"),
        speakerMode: checkedValue("speakerMode"),
        exportOriginal: $("exportOriginal").checked,
        exportGuide: $("exportGuide").checked,
        exportAudio: $("exportAudio").checked,
        exportNotes: $("exportNotes").checked,
        originalFormat: $("originalFormat").value,
        guideFormat: $("guideFormat").value,
        notesFormat: $("notesFormat").value,
        originalSpeaker: $("originalSpeaker").checked,
        originalTimestamp: $("originalTimestamp").checked
      };
    }
    function saveForm() {
      localStorage.setItem("qianwenWebUi", JSON.stringify(formData()));
    }
    function checkedValue(name) {
      return document.querySelector("input[name=" + CSS.escape(name) + "]:checked")?.value || "";
    }
    function applySaved(data) {
      for (const key of ["uploadDir", "downloadDir", "folderUrl", "batchSize", "maxRetries", "retryCooldownMinutes", "pollInterval", "originalFormat", "guideFormat", "notesFormat"]) {
        if (data[key] !== undefined && $(key)) $(key).value = data[key];
      }
      if (data.pollInterval !== undefined && $("pollInterval")) {
        const savedPoll = Number(data.pollInterval);
        $("pollInterval").value = savedPoll > 1000 ? String(Math.round(savedPoll / 60000)) : String(savedPoll || ${defaultPollIntervalMinutes});
      }
      for (const key of ["language", "translation", "speakerMode"]) {
        if (data[key]) {
          const radio = document.querySelector("input[name=" + CSS.escape(key) + "][value=" + CSS.escape(data[key]) + "]");
          if (radio) radio.checked = true;
        }
      }
      for (const key of ["exportOriginal", "exportGuide", "exportAudio", "exportNotes", "originalSpeaker", "originalTimestamp"]) {
        if (data[key] !== undefined && $(key)) $(key).checked = Boolean(data[key]);
      }
    }
    async function api(path, body) {
      const res = await fetch(path, {
        method: body ? "POST" : "GET",
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined
      });
      return res.json();
    }
    async function preview() {
      saveForm();
      const data = await api("/api/preview", formData());
      $("preview").textContent = data.ok
        ? "识别到 " + data.audioTotal + " 个录音，已存在 Markdown " + data.exportedTotal + " 个，千问文件夹名：" + data.folderName
        : data.error;
    }
    async function start() {
      saveForm();
      $("startBtn").disabled = true;
      const data = await api("/api/start", formData());
      if (!data.ok) $("preview").textContent = data.error || "启动失败";
      await refresh();
      $("startBtn").disabled = false;
    }
    async function stop() {
      await api("/api/stop", {});
      await refresh();
    }
    async function refresh() {
      const data = await api("/api/status");
      renderStatus(data);
    }
    function renderStatus(data) {
      const runState = $("runState");
      runState.textContent = data.running ? "运行中" : "未运行";
      runState.classList.toggle("running", Boolean(data.running));
      $("startBtn").disabled = Boolean(data.running);
      $("stopBtn").disabled = !data.running;

      const s = data.stats || {};
      const total = Number(s.total || 0);
      const success = Number(s.success || 0);
      const active = Number(s.active || 0);
      const failed = Number(s.failed || 0);
      $("total").textContent = total;
      $("success").textContent = success;
      $("active").textContent = active;
      $("failed").textContent = failed;
      const percent = total ? Math.round((success + failed) / total * 100) : 0;
      $("progressBar").style.width = percent + "%";
      $("progressText").textContent = total ? "已完成 " + (success + failed) + "/" + total + "，进度 " + percent + "%" : "等待任务开始";

      renderList("failedList", s.failedTitles || []);
      renderList("activeList", s.activeTitles || []);
      const lines = (data.logs || []).map((item) => {
        const time = new Date(item.at).toLocaleTimeString("zh-CN", { hour12: false });
        return "[" + time + "] " + item.text;
      });
      $("logs").textContent = lines.join("\\n");
      $("logs").scrollTop = $("logs").scrollHeight;
      if (data.job) {
        for (const key of ["uploadDir", "downloadDir", "folderUrl", "batchSize", "maxRetries", "retryCooldownMinutes", "pollInterval"]) {
          if (data.job[key] !== undefined && $(key) && !$(key).value) $(key).value = data.job[key];
        }
      }
    }
    function renderList(id, items) {
      const node = $(id);
      node.replaceChildren();
      if (!items.length) {
        const li = document.createElement("li");
        li.textContent = "无";
        node.appendChild(li);
        return;
      }
      for (const item of items.slice(0, 120)) {
        const li = document.createElement("li");
        li.textContent = item;
        node.appendChild(li);
      }
    }
    refresh();
    setInterval(refresh, 3000);
  </script>
</body>
</html>`;
}
