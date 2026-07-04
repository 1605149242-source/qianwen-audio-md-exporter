import fs from "node:fs/promises";
import path from "node:path";

const AUDIO_EXTENSIONS = new Set([".aac", ".mp3", ".m4a", ".wav", ".mp4"]);
const ORIGINAL_TEXT = "\u539f\u6587";

export async function assertDirectory(dir, label) {
  const stat = await fs.stat(dir).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`${label} is not a directory: ${dir}`);
  }
}

export async function ensureDirectory(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function listAudioFiles(dir) {
  const names = await fs.readdir(dir);
  return names
    .filter((name) => AUDIO_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))
    .map((name) => path.join(dir, name));
}

export function titleFromFile(file) {
  return path.basename(file).replace(/\.[^.]+$/, "");
}

export function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export function safeFilename(name) {
  return name.replace(/[\\/:*?"<>|]/g, "_");
}

export function filenameFromExportUrl(url, fallbackTitle) {
  try {
    const contentDisposition = new URL(url).searchParams.get("response-content-disposition") || "";
    const encoded = contentDisposition.match(/filename\*=UTF-8''(.+)$/)?.[1];
    if (encoded) return safeFilename(decodeURIComponent(encoded));
    const plain = contentDisposition.match(/filename=([^;]+)/)?.[1];
    if (plain) return safeFilename(plain.replace(/^"|"$/g, ""));
  } catch {
    // Fall through to fallback.
  }
  return safeFilename(`${fallbackTitle}_${ORIGINAL_TEXT}.md`);
}

export async function findExportedTitles(downloadDir, titles, options = {}) {
  const titleList = [...titles];
  const extensions = new Set((options.extensions || [".md"]).map((item) => item.toLowerCase()));
  const markers = options.markers || [ORIGINAL_TEXT];
  const names = await fs.readdir(downloadDir).catch(() => []);
  const exported = new Set();

  for (const name of names) {
    if (!extensions.has(path.extname(name).toLowerCase())) continue;
    const fullPath = path.join(downloadDir, name);
    const stat = await fs.stat(fullPath).catch(() => null);
    if (!stat || stat.size <= 0) continue;

    for (const title of titleList) {
      const safeTitle = safeFilename(title);
      if (name.startsWith(safeTitle) && markers.some((marker) => name.includes(marker))) {
        exported.add(title);
      }
    }
  }

  return exported;
}

export async function readJson(file, fallback) {
  const raw = await fs.readFile(file, "utf8").catch(() => null);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function writeJson(file, data) {
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}
