import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { chunk, filenameFromExportUrl, titleFromFile } from "../utils/files.js";

const DEFAULT_CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const RECORD_STATUSES = [10, 20, 30, 33, 40, 41, 43];

const TEXT = {
  loginPattern: /\u767b\u5f55|\u626b\u7801|\u9a8c\u8bc1\u7801/,
  myRecords: "\u6211\u7684\u8bb0\u5f55",
  create: "\u65b0\u5efa",
  quickRead: "\u97f3\u89c6\u9891\u901f\u8bfb",
  noSpeaker: "\u6682\u4e0d\u4f53\u9a8c",
  singleSpeaker: "\u5355\u4eba\u6f14\u8bb2",
  twoSpeakers: "2\u4eba\u5bf9\u8bdd",
  multiPerson: "\u591a\u4eba\u8ba8\u8bba",
  confirm: "\u786e \u8ba4",
  fileCountPattern: /\u6587\u4ef6\u6570\u91cf\uff1a[^\n]+/
};
const CREATIONS_URL = "https://www.qianwen.com/creations";

export class QianwenClient {
  constructor(options) {
    this.options = options;
    this.context = null;
    this.page = null;
    this.folderUrl = null;
  }

  async open() {
    const chromePath = this.options.chromePath || process.env.CHROME_EXECUTABLE_PATH || DEFAULT_CHROME_PATH;
    const { userDataDir, args } = resolveProfileOptions(this.options);

    this.context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: chromePath,
      headless: false,
      acceptDownloads: true,
      viewport: { width: 1365, height: 900 },
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-crash-reporter",
        "--disable-crashpad",
        ...args
      ]
    });
    this.page = this.context.pages()[0] || await this.context.newPage();
  }

  async close() {
    await this.context?.close();
  }

  async ensureFolder(folderUrl) {
    this.folderUrl = folderUrl;
    await this.gotoWithRetry(folderUrl);
    await this.page.waitForTimeout(2500);
    const body = await this.page.locator("body").innerText({ timeout: 10_000 }).catch(() => "");
    if (TEXT.loginPattern.test(body) && !body.includes(TEXT.myRecords)) {
      console.log("Please log in to Qianwen/Tingwu in the opened browser. The program will continue automatically after login is detected.");
      await this.waitForLogin();
    }
  }

  async ensureFolderByName(folderName) {
    this.folderUrl = CREATIONS_URL;
    await this.gotoWithRetry(CREATIONS_URL);
    await this.page.waitForTimeout(2500);

    let dirList = await this.getDirList();
    if (!dirList.success) {
      console.log(`Qianwen folder list is not available yet (${dirList.code || "unknown"}). If the browser is not logged in, please log in there.`);
      await this.waitForLogin();
      dirList = await this.getDirList();
    }
    if (!dirList.success) {
      throw new Error(`Qianwen folder list failed: ${JSON.stringify(dirList)}`);
    }

    const existing = findFolderByName(dirList.data || [], folderName);
    if (existing) {
      const folderUrl = folderUrlFromId(existing.idStr);
      this.folderUrl = folderUrl;
      console.log(`Using existing Qianwen folder: ${folderName} (${existing.idStr})`);
      return { folderId: existing.idStr, folderUrl, created: false };
    }

    const created = await this.addDir(folderName, "-1");
    if (!created.success) {
      throw new Error(`Create Qianwen folder failed: ${JSON.stringify(created)}`);
    }
    const focus = created.data?.focusDir;
    const folderId = focus?.idStr || focus?.id;
    if (!folderId) {
      throw new Error(`Create Qianwen folder did not return an id: ${JSON.stringify(created)}`);
    }
    const folderUrl = folderUrlFromId(folderId);
    this.folderUrl = folderUrl;
    console.log(`Created Qianwen folder: ${folderName} (${folderId})`);
    return { folderId, folderUrl, created: true };
  }

  async gotoWithRetry(url, maxAttempts = 3) {
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
        return;
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts) break;
        console.log(`Page navigation failed, retrying ${attempt}/${maxAttempts}: ${error.message}`);
        await this.page.waitForTimeout(5000 * attempt);
      }
    }
    throw lastError;
  }

  async waitForLogin() {
    for (let i = 0; i < 120; i += 1) {
      if (this.page.isClosed()) {
        throw new Error("The login browser window was closed before login completed.");
      }
      await this.page.waitForTimeout(5000);
      const body = await this.page.locator("body").innerText({ timeout: 10_000 }).catch(() => "");
      if (body.includes(TEXT.myRecords) || body.includes(TEXT.create)) {
        console.log("Login detected. Continuing...");
        return;
      }
    }
    throw new Error("Login was not detected within 10 minutes.");
  }

  async listRecords(folderId) {
    let data = await this.fetchRecordList();

    if (!data?.success) {
      console.log(`Qianwen record list is not available yet (${data?.code || "unknown"}). If the browser is not logged in, please log in there.`);
      await this.waitForLogin();
      data = await this.fetchRecordList();
    }

    if (!data?.success && data?.code) {
      throw new Error(`Qianwen record list failed: ${JSON.stringify({ code: data.code, message: data.message, requestId: data.requestId })}`);
    }

    return (data.data?.batchRecord || [])
      .flatMap((batch) => batch.recordList || [])
      .filter((record) => String(record.dirIdStr || record.dirId) === String(folderId));
  }

  async listAllRecords() {
    let data = await this.fetchRecordList();
    if (!data?.success) {
      console.log(`Qianwen record list is not available yet (${data?.code || "unknown"}). If the browser is not logged in, please log in there.`);
      await this.waitForLogin();
      data = await this.fetchRecordList();
    }
    if (!data?.success && data?.code) {
      throw new Error(`Qianwen record list failed: ${JSON.stringify({ code: data.code, message: data.message, requestId: data.requestId })}`);
    }
    return (data.data?.batchRecord || []).flatMap((batch) => batch.recordList || []);
  }

  async fetchRecordList() {
    return this.evaluateWithRetry("record list", () => this.page.evaluate(`(async () => {
      const statuses = ${JSON.stringify(RECORD_STATUSES)};
      const xsrf = document.cookie.split("; ").find((item) => item.startsWith("XSRF-TOKEN="))?.split("=")[1] || "";
      const response = await fetch("https://api.qianwen.com/assistant/api/record/list/poll?c=tongyi-web", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/plain, */*",
          "X-XSRF-TOKEN": decodeURIComponent(xsrf),
          "X-Platform": "pc_tongyi"
        },
        body: JSON.stringify({
          status: statuses,
          fileTypes: [],
          beginTime: "",
          mediaType: "",
          endTime: "",
          showName: "",
          read: "",
          lang: "",
          shareUserId: "",
          pageNo: 1,
          pageSize: 1000,
          recordSources: ["zhiwen", "tingwu"],
          taskTypes: ["local"],
          terminal: "web",
          module: "uploadhistory"
        })
      });
      return response.json();
    })()`));
  }

  async getDirList() {
    return this.qianwenPost("assistant/api/record/dir/list/get", {});
  }

  async addDir(dirName, parentIdStr = "-1") {
    return this.qianwenPost("assistant/api/record/dir/add", { dirName, parentIdStr });
  }

  async moveRecordsToDir(dirIdStr, recordIds) {
    if (recordIds.length === 0) return { success: true, moved: 0 };
    return this.qianwenPost("assistant/api/file/move", { dirIdStr, recordIds });
  }

  async qianwenPost(url, data) {
    return this.evaluateWithRetry(url, () => this.page.evaluate(`(async () => {
      const url = ${JSON.stringify(url)};
      const data = ${JSON.stringify(data)};
      const xsrf = document.cookie.split("; ").find((item) => item.startsWith("XSRF-TOKEN="))?.split("=")[1] || "";
      const response = await fetch("https://api.qianwen.com/" + url + "?c=tongyi-web", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/plain, */*",
          "X-XSRF-TOKEN": decodeURIComponent(xsrf),
          "X-Platform": "pc_tongyi"
        },
        body: JSON.stringify(data)
      });
      return response.json();
    })()`));
  }

  async evaluateWithRetry(label, action, maxAttempts = 4) {
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await action();
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts) break;
        console.log(`Qianwen API ${label} failed, retrying ${attempt}/${maxAttempts}: ${error.message}`);
        await this.page.waitForTimeout(5000 * attempt);
      }
    }
    throw lastError;
  }

  async uploadFiles(folderUrl, files) {
    if (files.length === 0) return;
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await this.ensureFolder(folderUrl);
        await this.clickText(TEXT.create);
        await this.page.waitForTimeout(500);
        await this.clickText(TEXT.quickRead);
        await this.page.waitForTimeout(1500);
        const speakerText = speakerTextFor(this.options.speakerMode);
        if (speakerText) {
          await this.clickText(speakerText);
          await this.page.waitForTimeout(500);
        }
        await this.page.locator("input[type=file]").setInputFiles(files, { timeout: 120_000 });
        await this.page.waitForTimeout(1200);
        const body = await this.page.locator("body").innerText({ timeout: 10_000 }).catch(() => "");
        console.log(body.match(TEXT.fileCountPattern)?.[0] || `Selected ${files.length} file(s).`);
        await this.clickText(TEXT.confirm);
        await this.page.waitForTimeout(3000);
        return;
      } catch (error) {
        lastError = error;
        if (attempt >= 3) break;
        console.log(`Upload UI failed, retrying ${attempt}/3: ${error.message}`);
        await this.page.keyboard.press("Escape").catch(() => null);
        await this.page.waitForTimeout(5000 * attempt);
      }
    }
    throw lastError;
  }

  async clickText(text) {
    const locator = this.page.getByText(text, { exact: true }).last();
    try {
      await locator.click({ timeout: 20_000 });
    } catch (error) {
      const dismissed = await this.dismissBlockingModal();
      if (!dismissed) throw error;
      await locator.click({ timeout: 20_000, force: true });
    }
  }

  async dismissBlockingModal() {
    const modal = this.page.locator(".ant-modal-root .ant-modal-wrap").last();
    const visible = await modal.isVisible({ timeout: 1000 }).catch(() => false);
    if (!visible) return false;

    const buttons = modal.locator("button");
    const buttonCount = await buttons.count().catch(() => 0);
    if (buttonCount > 0) {
      await buttons.nth(buttonCount - 1).click({ timeout: 5000, force: true }).catch(() => null);
    } else {
      await this.page.keyboard.press("Escape").catch(() => null);
    }
    await this.page.waitForTimeout(1000);
    return true;
  }

  async exportMarkdown(records, downloadDir, exportBatchSize) {
    const completed = records.filter((record) => record.recordStatus === 30);
    const byId = new Map(completed.map((record) => [record.genRecordId || record.recordId, record.recordTitle]));
    const saved = [];

    for (const ids of chunk([...byId.keys()], exportBatchSize)) {
      const urls = await this.createExportTaskWithRetry(ids);
      for (const item of urls) {
        if (!item.success || !item.url) continue;
        const title = byId.get(item.transIdStr) || item.transIdStr;
        const filename = filenameFromExportUrl(item.url, title);
        const target = path.join(downloadDir, filename);
        const response = await fetch(item.url);
        if (!response.ok) {
          throw new Error(`Download failed ${response.status}: ${filename}`);
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        await fs.writeFile(target, bytes);
        saved.push(target);
      }
    }

    return saved;
  }

  async createExportTaskWithRetry(transIds, maxAttempts = 3) {
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await this.createExportTask(transIds);
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts) break;
        console.log(`Export request failed, retrying ${attempt}/${maxAttempts}: ${error.message}`);
        await this.page.waitForTimeout(5000 * attempt);
      }
    }
    throw lastError;
  }

  async createExportTask(transIds) {
    const exportDetails = exportDetailsFromOptions(this.options.exportOptions);
    const start = await this.page.evaluate(`(async () => {
      const transIds = ${JSON.stringify(transIds)};
      const headers = ${JSON.stringify(exportHeaders())};
      const exportDetails = ${JSON.stringify(exportDetails)};
      const response = await fetch("https://audio-api.qianwen.com/api/export/request?c=tongyi-web", {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({
          action: "exportTrans",
          transIds,
          exportDetails
        })
      });
      return response.json();
    })()`);

    if (!start.success) {
      throw new Error(`Export request failed: ${JSON.stringify(start)}`);
    }

    const taskId = start.data.exportTaskId;
    for (let i = 0; i < 30; i += 1) {
      await this.page.waitForTimeout(i === 0 ? 1000 : 2000);
      const status = await this.page.evaluate(`(async () => {
        const taskId = ${JSON.stringify(taskId)};
        const headers = ${JSON.stringify(exportHeaders())};
        const response = await fetch("https://audio-api.qianwen.com/api/export/request?c=tongyi-web", {
          method: "POST",
          credentials: "include",
          headers,
          body: JSON.stringify({ action: "getExportStatus", exportTaskId: taskId })
        });
        return response.json();
      })()`);

      if (status.success && Array.isArray(status.data?.exportUrls)) {
        return status.data.exportUrls;
      }
    }

    throw new Error(`Export task timed out: ${taskId}`);
  }
}

export function folderIdFromUrl(folderUrl) {
  const match = String(folderUrl).match(/folders\/(\d+)/);
  if (!match) throw new Error(`Cannot parse Qianwen folder id from URL: ${folderUrl}`);
  return match[1];
}

export function folderUrlFromId(folderId) {
  return `https://www.qianwen.com/creations/folders/${folderId}`;
}

export function summarize(records, sourceFiles) {
  const sourceTitles = sourceFiles.map(titleFromFile);
  const sourceTitleSet = new Set(sourceTitles);
  const completedTitles = new Set(records.filter((r) => r.recordStatus === 30).map((r) => r.recordTitle));
  const presentTitles = new Set(records.map((r) => r.recordTitle));
  const counts = {};
  for (const record of records) counts[record.recordStatus] = (counts[record.recordStatus] || 0) + 1;
  const missingCompleted = sourceTitles.filter((title) => !completedTitles.has(title));
  const notPresent = sourceFiles.filter((file) => !presentTitles.has(titleFromFile(file)));
  const pendingRecords = records
    .filter((record) => sourceTitleSet.has(record.recordTitle))
    .filter((record) => !completedTitles.has(record.recordTitle))
    .filter((record) => [10, 20].includes(record.recordStatus));
  const failedRecords = records
    .filter((record) => sourceTitleSet.has(record.recordTitle))
    .filter((record) => !completedTitles.has(record.recordTitle))
    .filter((record) => [40, 41, 43, 100, 200, 301, 302, 303].includes(record.recordStatus));

  return {
    totalSource: sourceFiles.length,
    completed: sourceTitles.length - missingCompleted.length,
    missingCompleted,
    notPresent,
    pendingRecords,
    failedRecords,
    counts
  };
}

export async function openLocalFile(file) {
  return pathToFileURL(path.resolve(file)).href;
}

function resolveProfileOptions(options) {
  if (options.useSystemChromeProfile) {
    const userDataDir = options.systemChromeUserDataDir || path.join(os.homedir(), "AppData", "Local", "Google", "Chrome", "User Data");
    const profileName = options.chromeProfileName || "Default";
    return {
      userDataDir,
      args: [`--profile-directory=${profileName}`]
    };
  }

  return {
    userDataDir: path.resolve(options.profileDir || ".browser-profile"),
    args: []
  };
}

function findFolderByName(items, folderName) {
  for (const item of items) {
    const dir = item.dir || item;
    const name = dir.dirName || item.dirName;
    const idStr = dir.idStr || item.idStr;
    if (name === folderName && idStr) return { ...dir, ...item, idStr };
    const child = findFolderByName(item.children || item.childrenDir || [], folderName);
    if (child) return child;
  }
  return null;
}

function exportHeaders() {
  return {
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*",
    "x-tw-from": "tongyi",
    "x-tw-canary": ""
  };
}

export function exportDetailsFromOptions(options = {}) {
  const details = [];
  const fileTypes = {
    docx: 0,
    pdf: 1,
    srt: 2,
    md: 3,
    txt: 7
  };
  const originalFormat = fileTypes[options.originalFormat || "md"] ?? 3;
  const guideFormat = fileTypes[options.guideFormat || "docx"] ?? 0;
  const notesFormat = fileTypes[options.notesFormat || "docx"] ?? 0;

  if (options.original !== false) {
    details.push({
      docType: 1,
      fileType: originalFormat,
      withSpeaker: options.originalSpeaker !== false,
      withTimeStamp: options.originalTimestamp !== false
    });
  }
  if (options.guide) {
    details.push({ docType: 7, fileType: guideFormat });
  }
  if (options.audio) {
    details.push({ docType: 4 });
  }
  if (options.notes) {
    details.push({ docType: 3, fileType: notesFormat });
  }

  return details.length ? details : [{
    docType: 1,
    fileType: 3,
    withSpeaker: true,
    withTimeStamp: true
  }];
}

function speakerTextFor(mode) {
  if (mode === "none") return TEXT.noSpeaker;
  if (mode === "single") return TEXT.singleSpeaker;
  if (mode === "two") return TEXT.twoSpeakers;
  return TEXT.multiPerson;
}
