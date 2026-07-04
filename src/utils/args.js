import fs from "node:fs";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const TEXT = {
  title: "\u5343\u95ee / \u901a\u4e49\u542c\u609f\u5f55\u97f3\u8f6c Markdown \u5de5\u5177",
  subtitle: "\u8bf7\u586b\u5199\u672c\u6b21\u6279\u91cf\u5904\u7406\u9700\u8981\u7684\u8def\u5f84\u548c\u53ef\u9009\u7f51\u9875\u5730\u5740",
  uploadDir: "\u5f55\u97f3\u539f\u8def\u5f84",
  downloadDir: "Markdown \u4e0b\u8f7d\u8def\u5f84",
  folderUrl: "\u5343\u95ee\u6587\u4ef6\u5939\u7f51\u9875\u5730\u5740",
  folderUrlHint: "\u53ef\u7559\u7a7a\uff0c\u7a0b\u5e8f\u4f1a\u6309\u4e0b\u8f7d\u76ee\u5f55\u540d\u81ea\u52a8\u521b\u5efa\u6216\u590d\u7528\u6587\u4ef6\u5939",
  pasteValue: "\u8bf7\u7c98\u8d34",
  optional: "\u53ef\u9009",
  enterAuto: "\u76f4\u63a5\u56de\u8f66\u4f7f\u7528\u81ea\u52a8\u6a21\u5f0f"
};

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = toCamel(token.slice(2));
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

export async function promptMissing(options) {
  const needsInteractiveInput = !options.uploadDir || !options.downloadDir || Boolean(options.askFolderUrl);
  if (!needsInteractiveInput) {
    return {
      ...options,
      folderUrl: options.folderUrl || ""
    };
  }

  if (!input.isTTY) {
    printInputPanel();
    const answers = readPipedAnswers();
    const uploadDir = options.uploadDir || takeAnswer(answers, TEXT.uploadDir, true);
    const downloadDir = options.downloadDir || takeAnswer(answers, TEXT.downloadDir, true);
    const folderUrl = options.folderUrl || takeAnswer(answers, TEXT.folderUrl, false);
    return {
      ...options,
      uploadDir,
      downloadDir,
      folderUrl
    };
  }

  const rl = readline.createInterface({ input, output });
  try {
    printInputPanel();
    const uploadDir = options.uploadDir || await ask(rl, TEXT.uploadDir, "1/3");
    const downloadDir = options.downloadDir || await ask(rl, TEXT.downloadDir, "2/3");
    const folderUrl = options.folderUrl || await askOptional(rl, TEXT.folderUrl, "3/3", TEXT.folderUrlHint);
    return {
      ...options,
      uploadDir,
      downloadDir,
      folderUrl
    };
  } finally {
    rl.close();
  }
}

export function readNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function printInputPanel() {
  console.log("");
  console.log("======================================================================");
  console.log(`  ${TEXT.title}`);
  console.log("----------------------------------------------------------------------");
  console.log(`  ${TEXT.subtitle}`);
  console.log("======================================================================");
  console.log("");
}

async function ask(rl, label, index) {
  console.log(`[${index}] ${label}`);
  const value = await rl.question(`  ${TEXT.pasteValue}: `);
  return cleanValue(value);
}

async function askOptional(rl, label, index, hint) {
  console.log(`[${index}] ${label} (${TEXT.optional})`);
  console.log(`  ${hint}`);
  const value = await rl.question(`  ${TEXT.enterAuto}: `);
  return cleanValue(value);
}

function readPipedAnswers() {
  let raw = "";
  try {
    raw = fs.readFileSync(0, "utf8");
  } catch {
    raw = "";
  }
  return raw.split(/\r?\n/).map(cleanValue);
}

function takeAnswer(answers, label, required) {
  const value = answers.shift() || "";
  if (required && !value) {
    throw new Error(`${label} is required. Pass it with arguments or run the program in an interactive terminal.`);
  }
  return value;
}

function cleanValue(value) {
  return value.trim().replace(/^"|"$/g, "");
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
