import {constants, type Dirent} from "node:fs";
import {access, readFile, readdir, realpath, stat} from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import {naturalCompare, type Diagnostic, type Entry, type EntryKind, validateIdentifier} from "../domain.js";

export interface DiscoveryResult {
  entries: Entry[];
  diagnostics: Diagnostic[];
}

interface Classification {
  kind?: EntryKind;
  launchPath?: string;
  diagnostics: Diagnostic[];
}

function error(code: string, message: string, entryId?: string, itemPath?: string): Diagnostic {
  return {severity: "error", code, message, ...(entryId ? {entryId} : {}), ...(itemPath ? {path: itemPath} : {})};
}

async function readableRegularFile(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return false;
    await access(filePath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function readUtf8(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return new TextDecoder("utf-8", {fatal: true}).decode(bytes);
}

async function isDirectory(directoryPath: string): Promise<boolean> {
  try { return (await stat(directoryPath)).isDirectory(); }
  catch { return false; }
}

async function exists(itemPath: string): Promise<boolean> {
  try { await stat(itemPath); return true; }
  catch { return false; }
}

async function hasPackageSignal(real: string): Promise<boolean> {
  const manifestPath = path.join(real, "package.json");
  if (await readableRegularFile(manifestPath)) {
    try {
      const manifest = JSON.parse(await readUtf8(manifestPath)) as {pi?: unknown};
      if (manifest?.pi && typeof manifest.pi === "object" && !Array.isArray(manifest.pi)) return true;
    } catch {
      // A malformed package.json is not itself a Pi package signal.
    }
  }
  for (const name of ["extensions", "skills", "prompts", "themes"]) {
    if (await isDirectory(path.join(real, name))) return true;
  }
  return false;
}

async function validateSkill(filePath: string, id: string): Promise<Diagnostic[]> {
  if (!await readableRegularFile(filePath)) return [error("invalid-skill", "SKILL.md must be a readable regular UTF-8 Markdown file", id, filePath)];
  try {
    const text = await readUtf8(filePath);
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
    const frontmatter = match ? YAML.parse(match[1]!) : undefined;
    if (!frontmatter || typeof frontmatter !== "object" || typeof frontmatter.name !== "string" || !frontmatter.name.trim() || typeof frontmatter.description !== "string" || !frontmatter.description.trim()) {
      return [error("invalid-skill", "SKILL.md frontmatter requires non-empty name and description", id, filePath)];
    }
    return [];
  } catch {
    return [error("invalid-skill", "SKILL.md must be readable UTF-8 Markdown with valid YAML frontmatter", id, filePath)];
  }
}

async function validatePrompt(filePath: string, id: string): Promise<Diagnostic[]> {
  if (!await readableRegularFile(filePath)) return [error("invalid-prompt", "Prompt template must be a readable regular UTF-8 Markdown file", id, filePath)];
  try { await readUtf8(filePath); return []; }
  catch { return [error("invalid-prompt", "Prompt template must be valid UTF-8 Markdown", id, filePath)]; }
}

async function validateTheme(filePath: string, id: string): Promise<Diagnostic[]> {
  if (!await readableRegularFile(filePath)) return [error("invalid-theme", "Theme must be a readable regular UTF-8 JSON file", id, filePath)];
  try {
    const theme = JSON.parse(await readUtf8(filePath)) as unknown;
    if (!theme || typeof theme !== "object" || Array.isArray(theme)) return [error("invalid-theme", "Theme must be a JSON object", id, filePath)];
    const value = theme as Record<string, unknown>;
    if (typeof value.name !== "string" || !value.name.trim()) return [error("invalid-theme", "Theme must contain a non-empty name", id, filePath)];
    if (!value.colors || typeof value.colors !== "object" || Array.isArray(value.colors)) return [error("invalid-theme", "Theme must contain a colors object", id, filePath)];
    return [];
  } catch {
    return [error("invalid-theme", "Theme must be valid UTF-8 JSON", id, filePath)];
  }
}

async function classifyDirectory(real: string, id: string): Promise<Classification> {
  if (await hasPackageSignal(real)) return {kind: "package", launchPath: real, diagnostics: []};

  const skillPath = path.join(real, "SKILL.md");
  const tsPath = path.join(real, "index.ts");
  const jsPath = path.join(real, "index.js");
  const promptPath = path.join(real, `${id}.md`);
  const themePath = path.join(real, `${id}.json`);
  const skill = await exists(skillPath);
  const ts = await exists(tsPath);
  const js = await exists(jsPath);
  const prompt = await exists(promptPath);
  const theme = await exists(themePath);

  if (ts && js) return {kind: "extension", diagnostics: [error("ambiguous-extension", "Entry contains both index.ts and index.js", id, real)]};
  const signals: Array<{kind: EntryKind; launchPath: string}> = [];
  if (skill) signals.push({kind: "skill", launchPath: real});
  if (ts || js) signals.push({kind: "extension", launchPath: ts ? tsPath : jsPath});
  if (prompt) signals.push({kind: "prompt", launchPath: promptPath});
  if (theme) signals.push({kind: "theme", launchPath: themePath});
  if (signals.length > 1) return {diagnostics: [error("ambiguous-entry", `Entry has multiple incompatible resource signals: ${signals.map(({kind}) => kind).join(", ")}`, id, real)]};
  if (!signals.length) return {diagnostics: [error("unclassified-entry", "Directory has no canonical Pi Entry signal", id, real)]};

  const signal = signals[0]!;
  const diagnostics = signal.kind === "skill" ? await validateSkill(skillPath, id)
    : signal.kind === "prompt" ? await validatePrompt(promptPath, id)
      : signal.kind === "theme" ? await validateTheme(themePath, id)
        : await readableRegularFile(signal.launchPath) ? [] : [error("invalid-extension", "Extension entrypoint must be a readable regular file", id, signal.launchPath)];
  return {kind: signal.kind, launchPath: signal.launchPath, diagnostics};
}

function isCandidate(child: Dirent): boolean {
  return child.isDirectory() || child.isSymbolicLink();
}

export async function discoverEntries(piwHome: string): Promise<DiscoveryResult> {
  let children: Dirent[];
  try { children = (await readdir(piwHome, {withFileTypes: true})).filter(({name}) => name !== "piw.json" && !name.startsWith(".")); }
  catch (cause) {
    return {entries: [], diagnostics: [error("unreadable-piw-home", `PIW home cannot be read: ${cause instanceof Error ? cause.message : String(cause)}`, undefined, piwHome)]};
  }

  const diagnostics: Diagnostic[] = [];
  const candidates = children.filter((child) => {
    if (isCandidate(child)) return true;
    diagnostics.push(error("unsupported-root-item", `Unsupported root item: ${child.name}; every Entry must be a directory`, undefined, path.join(piwHome, child.name)));
    return false;
  });
  const collisions = new Map<string, number>();
  for (const child of candidates) collisions.set(child.name.toLowerCase(), (collisions.get(child.name.toLowerCase()) ?? 0) + 1);

  const entries: Entry[] = [];
  for (const child of candidates) {
    const id = child.name;
    const registryPath = path.join(piwHome, id);
    let real = registryPath;
    const entryDiagnostics: Diagnostic[] = [];
    if (!validateIdentifier(id)) entryDiagnostics.push(error("invalid-id", `Invalid Entry ID: ${id}`, id, registryPath));
    if ((collisions.get(id.toLowerCase()) ?? 0) > 1) entryDiagnostics.push(error("id-collision", `Case-insensitive Entry ID collision: ${id}`, id, registryPath));

    let classification: Classification = {diagnostics: []};
    try {
      real = await realpath(registryPath);
      await access(real, constants.R_OK);
      if (!await isDirectory(real)) entryDiagnostics.push(error("unsupported-target", "Entry must resolve to a directory", id, registryPath));
      else classification = await classifyDirectory(real, id);
    } catch {
      entryDiagnostics.push(error("unresolved", "Entry directory is missing, unreadable, or has a symlink loop", id, registryPath));
    }
    entryDiagnostics.push(...classification.diagnostics);
    if (!entryDiagnostics.length && classification.kind && classification.launchPath) {
      entries.push({id, registryPath, realPath: real, status: "valid", kind: classification.kind, launchPath: classification.launchPath, diagnostics: []});
    } else {
      entries.push({id, registryPath, realPath: real, status: "invalid", ...(classification.kind ? {kind: classification.kind} : {}), ...(classification.launchPath ? {launchPath: classification.launchPath} : {}), diagnostics: entryDiagnostics});
    }
  }
  return {
    entries: entries.sort((a, b) => naturalCompare(a.id, b.id) || naturalCompare(a.registryPath, b.registryPath)),
    diagnostics: diagnostics.sort((a, b) => naturalCompare(a.path ?? "", b.path ?? "")),
  };
}
