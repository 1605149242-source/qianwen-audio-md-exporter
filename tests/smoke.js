import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, readNumber } from "../src/utils/args.js";
import { chunk, safeFilename, titleFromFile } from "../src/utils/files.js";
import { folderIdFromUrl, summarize } from "../src/qianwen/client.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "README.md",
  "docs/PRD.md",
  "docs/TECH_ARCHITECTURE.md",
  "docs/PROJECT_STRUCTURE.md",
  "CHANGELOG.md",
  "docs/DEV_LOG.md",
  "src/cli.js",
  "src/qianwen/client.js",
  "src/utils/args.js",
  "src/utils/files.js"
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

console.log("Smoke check passed.");

function assert(value, label) {
  if (!value) throw new Error(`Assertion failed: ${label}`);
}
