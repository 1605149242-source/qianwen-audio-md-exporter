import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, readNonNegativeNumber, readNumber } from "../src/utils/args.js";
import { chunk, findCompleteExportedTitles, safeFilename, titleFromFile } from "../src/utils/files.js";
import { exportDetailsFromOptions, folderIdFromUrl, summarize } from "../src/qianwen/client.js";
import { getAttempt, getFailedRerunCount, hasReachedFinalFailure, startFailedRerun, titlesReadyForFailedRerun } from "../src/utils/retry.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "README.md",
  "docs/PRD.md",
  "docs/TECH_ARCHITECTURE.md",
  "docs/PROJECT_STRUCTURE.md",
  "CHANGELOG.md",
  "docs/DEV_LOG.md",
  "src/cli.js",
  "src/web.js",
  "src/qianwen/client.js",
  "src/utils/args.js",
  "src/utils/files.js",
  "open-web-ui.bat",
  "open-web-ui.vbs",
  "start-web-ui.ps1",
  "启动网页控制台.bat"
];

for (const relative of required) {
  const file = path.join(root, relative);
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) throw new Error(`Missing required file: ${relative}`);
}

assert(parseArgs(["--upload-dir", "a", "--dry-run"]).uploadDir === "a", "parse upload dir");
assert(parseArgs(["--dry-run"]).dryRun === true, "parse boolean");
assert(readNumber("12", 1) === 12, "parse number");
assert(readNumber("bad", 7) === 7, "fallback number");
assert(readNonNegativeNumber("0", 1) === 0, "parse zero number");
assert(titleFromFile("D:/x/demo.aac") === "demo", "title from file");
assert(safeFilename("a:b?.md") === "a_b_.md", "safe filename");
assert(chunk([1, 2, 3], 2).length === 2, "chunk");
assert(folderIdFromUrl("https://www.qianwen.com/creations/folders/2050003524008270053") === "2050003524008270053", "folder id");

const progress = summarize(
  [{ recordStatus: 30, recordTitle: "a" }, { recordStatus: 10, recordTitle: "b" }],
  ["D:/tmp/a.aac", "D:/tmp/b.aac", "D:/tmp/c.aac"]
);
assert(progress.completed === 1, "completed summary");
assert(progress.notPresent.length === 1, "not present summary");

const originalWithoutSpeakerOrTimestamp = exportDetailsFromOptions({
  original: true,
  originalFormat: "md",
  originalSpeaker: false,
  originalTimestamp: false
}).find((item) => item.docType === 1);
assert(originalWithoutSpeakerOrTimestamp?.withSpeaker === false, "original export can disable speaker");
assert(originalWithoutSpeakerOrTimestamp?.withTimeStamp === false, "original export can disable timestamp");

await assertMultiExportCompletion();
assertFailedRerunState();
await assertWebConsoleScope();
await assertCompletedRecordCleanupWiring();

console.log("Smoke check passed.");

function assert(value, label) {
  if (!value) throw new Error(`Assertion failed: ${label}`);
}

async function assertMultiExportCompletion() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "qianwen-export-smoke-"));
  try {
    const title = "demo";
    await fs.writeFile(path.join(tempRoot, "demo_原文.md"), "# original\n", "utf8");
    let complete = await findCompleteExportedTitles(tempRoot, [title], {
      original: true,
      originalFormat: "md",
      guide: true,
      guideFormat: "pdf",
      notes: true,
      notesFormat: "txt"
    });
    assert(!complete.has(title), "multi-export incomplete when guide and notes are missing");

    await fs.writeFile(path.join(tempRoot, "demo_导读.pdf"), "guide\n", "utf8");
    await fs.writeFile(path.join(tempRoot, "demo_笔记.txt"), "notes\n", "utf8");
    complete = await findCompleteExportedTitles(tempRoot, [title], {
      original: true,
      originalFormat: "md",
      guide: true,
      guideFormat: "pdf",
      notes: true,
      notesFormat: "txt"
    });
    assert(complete.has(title), "multi-export complete when all selected document files exist");

    complete = await findCompleteExportedTitles(tempRoot, [title], {
      original: false,
      audio: true
    });
    assert(!complete.has(title), "audio export incomplete when no audio file exists");
    await fs.writeFile(path.join(tempRoot, "demo.mp3"), "audio\n", "utf8");
    complete = await findCompleteExportedTitles(tempRoot, [title], {
      original: false,
      audio: true
    });
    assert(complete.has(title), "audio export complete when audio file exists");
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

function assertFailedRerunState() {
  const config = { maxRetries: 10, failedRerunLimit: 1 };
  const state = {
    uploadAttemptsV2: {
      done: { count: 10, lastAttemptAt: 1 },
      retry: { count: 10, lastAttemptAt: 1 }
    },
    failedRerunsV1: {}
  };
  assert(!hasReachedFinalFailure(state, "retry", config), "exhausted title is recoverable before failed rerun");
  assert(titlesReadyForFailedRerun(state, ["retry"], config).length === 1, "eligible title can start failed rerun");
  startFailedRerun(state, ["retry"], 123);
  assert(getAttempt(state, "retry").count === 0, "failed rerun resets attempt count");
  assert(getAttempt(state, "retry").forceUpload === true, "failed rerun forces next upload");
  assert(getFailedRerunCount(state, "retry") === 1, "failed rerun count increments");
  state.uploadAttemptsV2.retry = { count: 10, lastAttemptAt: 456 };
  assert(hasReachedFinalFailure(state, "retry", config), "title is final failed after rerun is exhausted");
  assert(titlesReadyForFailedRerun(state, ["done", "retry"], config).length === 0, "mixed final and recoverable titles do not start another group rerun");
}

async function assertWebConsoleScope() {
  const webSource = await fs.readFile(path.join(root, "src/web.js"), "utf8");
  for (const marker of ["/api/summary", "call_summary_automation.py", "exportAiSummary", "renderSummaryApp"]) {
    assert(!webSource.includes(marker), `web console excludes AI summary marker: ${marker}`);
  }
}

async function assertCompletedRecordCleanupWiring() {
  const webSource = await fs.readFile(path.join(root, "src/web.js"), "utf8");
  const clientSource = await fs.readFile(path.join(root, "src/qianwen/client.js"), "utf8");
  const cliSource = await fs.readFile(path.join(root, "src/cli.js"), "utf8");
  assert(webSource.includes("cleanCompletedRecords"), "web console exposes completed-record cleanup option");
  assert(webSource.includes("自动清除已经下载好文字稿的录音记录"), "web console labels completed-record cleanup option");
  assert(clientSource.includes("assistant/api/record/task/delete"), "client uses Qianwen completed-record delete endpoint");
  assert(cliSource.includes("recordStatus === 30"), "cleanup only considers completed records");
}
