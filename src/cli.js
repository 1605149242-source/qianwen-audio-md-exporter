#!/usr/bin/env node

import path from "node:path";
import { parseArgs, promptMissing, readNumber } from "./utils/args.js";
import { assertDirectory, ensureDirectory, findExportedTitles, listAudioFiles, readJson, titleFromFile, writeJson } from "./utils/files.js";
import { folderIdFromUrl, QianwenClient, summarize } from "./qianwen/client.js";

const TEXT = {
  runInfo: "\u8fd0\u884c\u4fe1\u606f",
  finalReport: "\u5904\u7406\u7ed3\u679c",
  successList: "\u6210\u529f\u5f55\u97f3",
  failedList: "\u5931\u8d25\u5f55\u97f3",
  activeList: "\u4ecd\u5728\u5904\u7406",
  none: "\u65e0",
  autoFolder: "\u6309\u4e0b\u8f7d\u76ee\u5f55\u540d\u81ea\u52a8\u521b\u5efa / \u590d\u7528"
};

const rawArgs = parseArgs(process.argv.slice(2));
const options = await promptMissing({
  ...rawArgs,
  profileDir: rawArgs.profileDir || process.env.QIANWEN_PROFILE_DIR || ".browser-profile",
  chromePath: rawArgs.chromePath || process.env.CHROME_EXECUTABLE_PATH,
  batchSize: readNumber(rawArgs.batchSize, 50),
  exportBatchSize: readNumber(rawArgs.exportBatchSize, 12),
  pollInterval: readNumber(rawArgs.pollInterval || process.env.POLL_INTERVAL_MS, 10 * 60 * 1000),
  maxRetries: readNumber(rawArgs.maxRetries, 10),
  retryCooldownMinutes: readNumber(rawArgs.retryCooldownMinutes, 10),
  useSystemChromeProfile: Boolean(rawArgs.useSystemChromeProfile),
  skipUpload: Boolean(rawArgs.skipUpload),
  speakerMode: rawArgs.speakerMode || "multi",
  exportOptions: parseExportOptions(rawArgs.exportOptions),
  chromeProfileName: rawArgs.chromeProfileName,
  systemChromeUserDataDir: rawArgs.systemChromeUserDataDir
});

await main(options);

async function main(config) {
  await assertDirectory(config.uploadDir, "Upload folder");
  await ensureDirectory(config.downloadDir);

  const sourceFiles = await listAudioFiles(config.uploadDir);
  if (sourceFiles.length === 0) {
    throw new Error(`No supported audio files found in ${config.uploadDir}`);
  }

  const folderName = path.basename(path.resolve(config.downloadDir));
  let folderId = config.folderUrl ? folderIdFromUrl(config.folderUrl) : "";
  const stateFile = path.join(config.downloadDir, "qianwen-exporter-state.json");
  const state = await readJson(stateFile, { attempts: {} });
  state.attempts ||= {};
  state.uploadAttemptsV2 ||= {};

  printRunInfo({
    audioCount: sourceFiles.length,
    uploadDir: config.uploadDir,
    downloadDir: config.downloadDir,
    folderName,
    folderId,
    folderUrl: config.folderUrl
  });

  if (config.dryRun) {
    console.log("Dry run only. Browser automation was not started.");
    return;
  }

  const client = new QianwenClient(config);
  await client.open();
  let lastSummary = null;

  try {
    if (config.folderUrl) {
      await client.ensureFolder(config.folderUrl);
    } else {
      const target = await client.ensureFolderByName(folderName);
      folderId = target.folderId;
      config.folderUrl = target.folderUrl;
    }

    while (true) {
      const moved = await moveExistingSourceRecords(client, folderId, sourceFiles);
      if (moved > 0) {
        console.log(`Moved existing records into target folder: ${moved}`);
        await client.page.waitForTimeout(2000);
      }

      const records = await client.listRecords(folderId);
      const progress = summarize(records, sourceFiles);
      printProgress(progress);

      const exportResult = await exportNewMarkdown(client, records, sourceFiles, config);
      if (exportResult.newlyExported > 0 || exportResult.alreadyExported > 0) {
        console.log(`Markdown export: already=${exportResult.alreadyExported}, newly=${exportResult.newlyExported}`);
      }

      const summary = await buildCompletionSummary(progress, sourceFiles, state, config);
      lastSummary = summary;
      printSummary(summary);
      if (summary.done) {
        console.log("All possible recordings are finished.");
        break;
      }

      const uploadCandidates = getUploadCandidates(progress, sourceFiles)
        .filter((file) => canUploadAgain(state, titleFromFile(file), config))
        .slice(0, config.batchSize);

      if (config.skipUpload) {
        console.log(`Skip upload is enabled. Upload candidates skipped: ${getUploadCandidates(progress, sourceFiles).length}`);
        break;
      }

      if (uploadCandidates.length > 0) {
        console.log(`Uploading missing/failed files: ${uploadCandidates.length}`);
        await client.uploadFiles(config.folderUrl, uploadCandidates);
        const now = Date.now();
        for (const file of uploadCandidates) {
          const title = titleFromFile(file);
          const attempt = getAttempt(state, title);
          state.uploadAttemptsV2[title] = {
            count: attempt.count + 1,
            lastAttemptAt: now
          };
        }
        await writeJson(stateFile, state);
        console.log(`Upload submitted. Waiting ${config.pollInterval}ms before checking records again...`);
        await client.page.waitForTimeout(config.pollInterval);
      } else {
        const allCandidates = getUploadCandidates(progress, sourceFiles);
        const cooling = allCandidates.filter((file) => isCoolingDown(state, titleFromFile(file), config)).length;
        const exhausted = allCandidates.filter((file) => getAttempt(state, titleFromFile(file)).count >= config.maxRetries).length;
        console.log(`Waiting ${config.pollInterval}ms for transcription progress... coolingDown=${cooling}, retryLimitReached=${exhausted}`);
        await client.page.waitForTimeout(config.pollInterval);
      }
    }
  } finally {
    await client.close();
  }

  if (lastSummary) {
    printFinalReport(lastSummary);
  }
}

async function buildCompletionSummary(progress, sourceFiles, state, config) {
  const sourceTitles = sourceFiles.map(titleFromFile);
  const exportedTitles = await findExportedTitles(config.downloadDir, sourceTitles, exportedTitleOptions(config));
  const uploadCandidates = new Set(getUploadCandidates(progress, sourceFiles).map(titleFromFile));
  const abandonedTitles = sourceTitles.filter((title) => uploadCandidates.has(title) && getAttempt(state, title).count >= config.maxRetries);
  const successfulTitles = sourceTitles.filter((title) => exportedTitles.has(title));
  const activeTitles = sourceTitles.filter((title) => !exportedTitles.has(title) && !abandonedTitles.includes(title));

  return {
    total: sourceTitles.length,
    success: successfulTitles.length,
    failed: abandonedTitles.length,
    active: activeTitles.length,
    successfulTitles,
    abandonedTitles,
    activeTitles,
    done: successfulTitles.length + abandonedTitles.length >= sourceTitles.length
  };
}

function printSummary(summary) {
  console.log(`Summary: success=${summary.success}, failed=${summary.failed}, active=${summary.active}, total=${summary.total}`);
}

async function exportNewMarkdown(client, records, sourceFiles, config) {
  const sourceTitles = new Set(sourceFiles.map(titleFromFile));
  const completedByTitle = new Map();
  for (const record of records) {
    if (record.recordStatus === 30 && sourceTitles.has(record.recordTitle) && !completedByTitle.has(record.recordTitle)) {
      completedByTitle.set(record.recordTitle, record);
    }
  }

  const exportedTitles = await findExportedTitles(config.downloadDir, completedByTitle.keys(), exportedTitleOptions(config));
  const exportRecords = [...completedByTitle.entries()]
    .filter(([title]) => !exportedTitles.has(title))
    .map(([, record]) => record);

  if (exportRecords.length === 0) {
    return { alreadyExported: exportedTitles.size, newlyExported: 0 };
  }

  const saved = await client.exportMarkdown(exportRecords, config.downloadDir, config.exportBatchSize);
  return { alreadyExported: exportedTitles.size, newlyExported: saved.length };
}

function getUploadCandidates(progress, sourceFiles) {
  const fileByTitle = new Map(sourceFiles.map((file) => [titleFromFile(file), file]));
  const pendingTitles = new Set(progress.pendingRecords.map((record) => record.recordTitle));
  const candidates = [];

  for (const file of progress.notPresent) candidates.push(file);

  for (const record of progress.failedRecords) {
    if (pendingTitles.has(record.recordTitle)) continue;
    const file = fileByTitle.get(record.recordTitle);
    if (file) candidates.push(file);
  }

  return [...new Map(candidates.map((file) => [titleFromFile(file), file])).values()];
}

async function moveExistingSourceRecords(client, folderId, sourceFiles) {
  const sourceTitles = new Set(sourceFiles.map(titleFromFile));
  const allRecords = await client.listAllRecords();
  const recordIds = allRecords
    .filter((record) => sourceTitles.has(record.recordTitle))
    .filter((record) => String(record.dirIdStr || record.dirId) !== String(folderId))
    .map((record) => record.recordId)
    .filter(Boolean);

  const uniqueRecordIds = [...new Set(recordIds)];
  if (uniqueRecordIds.length === 0) return 0;
  const result = await client.moveRecordsToDir(folderId, uniqueRecordIds);
  if (!result.success) {
    throw new Error(`Move existing records failed: ${JSON.stringify(result)}`);
  }
  return uniqueRecordIds.length;
}

function canUploadAgain(state, title, config) {
  const attempt = getAttempt(state, title);
  if (attempt.count >= config.maxRetries) return false;
  if (!attempt.lastAttemptAt) return true;
  return Date.now() - attempt.lastAttemptAt >= config.retryCooldownMinutes * 60 * 1000;
}

function isCoolingDown(state, title, config) {
  const attempt = getAttempt(state, title);
  if (!attempt.lastAttemptAt) return false;
  if (attempt.count >= config.maxRetries) return false;
  return Date.now() - attempt.lastAttemptAt < config.retryCooldownMinutes * 60 * 1000;
}

function getAttempt(state, title) {
  const value = state.uploadAttemptsV2?.[title];
  return {
    count: Number(value?.count || 0),
    lastAttemptAt: Number(value?.lastAttemptAt || 0)
  };
}

function parseExportOptions(raw) {
  if (!raw) return defaultExportOptions();
  try {
    return normalizeExportOptions(JSON.parse(raw));
  } catch {
    return defaultExportOptions();
  }
}

function defaultExportOptions() {
  return {
    original: true,
    guide: false,
    audio: false,
    notes: false,
    originalFormat: "md",
    guideFormat: "docx",
    notesFormat: "docx",
    originalSpeaker: true,
    originalTimestamp: true
  };
}

function normalizeExportOptions(value) {
  const allowedOriginal = new Set(["docx", "pdf", "txt", "md", "srt"]);
  const allowedGuide = new Set(["docx", "pdf", "txt", "md", "srt"]);
  const allowedNotes = new Set(["docx", "pdf", "txt", "md", "srt"]);
  return {
    original: value.original !== false,
    guide: Boolean(value.guide),
    audio: Boolean(value.audio),
    notes: Boolean(value.notes),
    originalFormat: allowedOriginal.has(value.originalFormat) ? value.originalFormat : "md",
    guideFormat: allowedGuide.has(value.guideFormat) ? value.guideFormat : "docx",
    notesFormat: allowedNotes.has(value.notesFormat) ? value.notesFormat : "docx",
    originalSpeaker: value.originalSpeaker !== false,
    originalTimestamp: value.originalTimestamp !== false
  };
}

function exportedTitleOptions(config) {
  if (config.exportOptions?.original !== false) {
    const format = config.exportOptions?.originalFormat || "md";
    return {
      extensions: [`.${format}`],
      markers: ["\u539f\u6587"]
    };
  }
  if (config.exportOptions?.guide) {
    const format = config.exportOptions?.guideFormat || "docx";
    return {
      extensions: [`.${format}`],
      markers: ["\u5bfc\u8bfb"]
    };
  }
  if (config.exportOptions?.notes) {
    const format = config.exportOptions?.notesFormat || "docx";
    return {
      extensions: [`.${format}`],
      markers: ["\u7b14\u8bb0"]
    };
  }
  return {
    extensions: [".md"],
    markers: ["\u539f\u6587"]
  };
}

function printProgress(progress) {
  console.log([
    `Completed: ${progress.completed}/${progress.totalSource}`,
    `Records by status: ${JSON.stringify(progress.counts)}`,
    `Not present: ${progress.notPresent.length}`
  ].join(" | "));
}

function printRunInfo(info) {
  printBox(TEXT.runInfo, [
    `\u5f55\u97f3\u6570\u91cf       : ${info.audioCount}`,
    `\u5f55\u97f3\u539f\u8def\u5f84     : ${info.uploadDir}`,
    `\u6587\u5b57\u7a3f\u4e0b\u8f7d\u8def\u5f84 : ${info.downloadDir}`,
    `\u5343\u95ee\u6587\u4ef6\u5939     : ${info.folderName}`,
    `\u7f51\u9875\u5730\u5740       : ${info.folderUrl || TEXT.autoFolder}`,
    `\u6587\u4ef6\u5939 ID      : ${info.folderId || "-"}`
  ]);
}

function printFinalReport(summary) {
  const lines = [
    `\u603b\u6570             : ${summary.total}`,
    `\u6210\u529f             : ${summary.success}`,
    `\u5931\u8d25             : ${summary.failed}`,
    `\u4ecd\u5728\u5904\u7406       : ${summary.active}`,
    "",
    `${TEXT.successList}:`,
    ...formatTitleList(summary.successfulTitles),
    "",
    `${TEXT.failedList}:`,
    ...formatTitleList(summary.abandonedTitles),
    "",
    `${TEXT.activeList}:`,
    ...formatTitleList(summary.activeTitles)
  ];
  printBox(TEXT.finalReport, lines);
}

function formatTitleList(titles) {
  if (!titles.length) return [`  - ${TEXT.none}`];
  return titles.map((title) => `  - ${title}`);
}

function printBox(title, lines) {
  const width = 70;
  console.log("");
  console.log("=".repeat(width));
  console.log(` ${title}`);
  console.log("-".repeat(width));
  for (const line of lines) {
    console.log(line);
  }
  console.log("=".repeat(width));
  console.log("");
}
