import {constants, type Dirent} from "node:fs";
import {access, lstat, readFile, readdir, realpath, stat} from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import {naturalCompare, type Diagnostic, type Entry, type EntryKind, validateIdentifier} from "../domain.js";

const FILE_KINDS: Record<string, EntryKind> = {".ts": "extension", ".js": "extension", ".md": "prompt", ".json": "theme"};
export const PI_0_84_1_THEME_TOKENS = [
  "accent", "border", "borderAccent", "borderMuted", "success", "error", "warning", "muted", "dim", "text", "thinkingText",
  "selectedBg", "userMessageBg", "userMessageText", "customMessageBg", "customMessageText", "customMessageLabel", "toolPendingBg", "toolSuccessBg", "toolErrorBg", "toolTitle", "toolOutput",
  "mdHeading", "mdLink", "mdLinkUrl", "mdCode", "mdCodeBlock", "mdCodeBlockBorder", "mdQuote", "mdQuoteBorder", "mdHr", "mdListBullet",
  "toolDiffAdded", "toolDiffRemoved", "toolDiffContext", "syntaxComment", "syntaxKeyword", "syntaxFunction", "syntaxVariable", "syntaxString", "syntaxNumber", "syntaxType", "syntaxOperator", "syntaxPunctuation",
  "thinkingOff", "thinkingMinimal", "thinkingLow", "thinkingMedium", "thinkingHigh", "thinkingXhigh", "bashMode",
] as const;

function validateTheme(theme: unknown): string[] {
  if (!theme || typeof theme !== "object" || Array.isArray(theme)) return ["Theme must be an object"];
  const value = theme as Record<string, unknown>;
  if (typeof value.name !== "string" || !value.name.trim() || value.name.includes("/")) return ["Theme must contain a non-empty name without /"];
  if (!value.colors || typeof value.colors !== "object" || Array.isArray(value.colors)) return ["Theme must contain a colors object"];
  const colors = value.colors as Record<string, unknown>;
  const missing = PI_0_84_1_THEME_TOKENS.filter((token) => !(token in colors));
  if (missing.length) return [`Missing required color tokens: ${missing.join(", ")}`];
  const vars = value.vars && typeof value.vars === "object" && !Array.isArray(value.vars) ? value.vars as Record<string, unknown> : {};
  const invalid = Object.entries({...vars, ...colors}).filter(([, color]) => !(typeof color === "string" || (Number.isInteger(color) && (color as number) >= 0 && (color as number) <= 255))).map(([name]) => name);
  if (invalid.length) return [`Invalid color values: ${invalid.join(", ")}`];
  const unknownReferences = Object.entries(colors).filter(([, color]) => typeof color === "string" && color !== "" && !color.startsWith("#") && !(color in vars)).map(([name]) => name);
  return unknownReferences.length ? [`Unknown theme variable references: ${unknownReferences.join(", ")}`] : [];
}

function error(code: string, message: string, entryId?: string, itemPath?: string): Diagnostic {
  return {severity: "error", code, message, ...(entryId ? {entryId} : {}), ...(itemPath ? {path: itemPath} : {})};
}

async function classifyDirectory(real: string): Promise<{kind: EntryKind; diagnostics: Diagnostic[]}> {
  const names = new Set((await readdir(real)).filter((name) => !name.startsWith(".")));
  let manifestPi = false;
  if (names.has("package.json")) {
    try { const manifest = JSON.parse(await readFile(path.join(real, "package.json"), "utf8")); manifestPi = Boolean(manifest?.pi && typeof manifest.pi === "object"); } catch { /* diagnosed if it is the only signal */ }
  }
  const conventions: string[] = [];
  for (const name of ["extensions", "skills", "prompts", "themes"]) {
    if (!names.has(name)) continue;
    try {
      const conventionPath = path.join(real, name);
      if ((await stat(conventionPath)).isDirectory() && (await readdir(conventionPath)).some((child) => !child.startsWith("."))) conventions.push(name);
    } catch { /* not an effective convention */ }
  }
  if (manifestPi || conventions.length > 0) {
    const diagnostics: Diagnostic[] = [];
    let resources = conventions.length;
    if (manifestPi) {
      const manifest = JSON.parse(await readFile(path.join(real, "package.json"), "utf8"));
      for (const value of Object.values(manifest.pi as Record<string, unknown>)) {
        const targets = Array.isArray(value) ? value : [];
        for (const target of targets) {
          if (typeof target !== "string") { diagnostics.push(error("package-target", "Package manifest targets must be strings")); continue; }
          const resolved = path.resolve(real, target);
          if (resolved !== real && !resolved.startsWith(`${real}${path.sep}`)) diagnostics.push(error("package-escape", `Package target escapes root: ${target}`));
          else { try { const canonical = await realpath(resolved); if (canonical !== real && !canonical.startsWith(`${real}${path.sep}`)) diagnostics.push(error("package-escape", `Package target resolves outside root: ${target}`)); else resources += 1; } catch { diagnostics.push(error("package-missing", `Package target is missing: ${target}`)); } }
        }
      }
    }
    if (resources === 0) diagnostics.push(error("empty-package", "Pi package resolves to no supported resources"));
    return {kind: "package", diagnostics};
  }
  const skill = names.has("SKILL.md");
  const extension = names.has("index.ts") || names.has("index.js");
  if (skill && extension) return {kind: "skill", diagnostics: [error("weak-signal-conflict", "Found both SKILL.md and index.ts/index.js without a Pi package signal")]};
  if (skill) {
    const diagnostics: Diagnostic[] = [];
    try {
      const text = await readFile(path.join(real, "SKILL.md"), "utf8");
      const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
      const frontmatter = match ? YAML.parse(match[1]!) : undefined;
      if (!frontmatter || typeof frontmatter.name !== "string" || !frontmatter.name.trim() || typeof frontmatter.description !== "string" || !frontmatter.description.trim()) diagnostics.push(error("invalid-skill", "SKILL.md frontmatter requires non-empty name and description"));
    } catch { diagnostics.push(error("invalid-skill", "SKILL.md must be readable UTF-8 Markdown with YAML frontmatter")); }
    return {kind: "skill", diagnostics};
  }
  if (extension) return {kind: "extension", diagnostics: []};
  return {kind: "extension", diagnostics: [error("unclassified", "Directory has no supported Pi resource signal")]};
}

function candidateId(dirent: Dirent): string {
  if (!dirent.isFile()) return dirent.name;
  const extension = path.extname(dirent.name);
  return FILE_KINDS[extension] ? dirent.name.slice(0, -extension.length) : dirent.name;
}

export async function discoverEntries(registryRoot: string): Promise<Entry[]> {
  let children: Dirent[];
  try { children = (await readdir(registryRoot, {withFileTypes: true})).filter((item) => !item.name.startsWith(".")); }
  catch { return []; }
  const collisions = new Map<string, number>();
  for (const child of children) collisions.set(candidateId(child).toLowerCase(), (collisions.get(candidateId(child).toLowerCase()) ?? 0) + 1);
  const entries: Entry[] = [];
  for (const child of children) {
    const id = candidateId(child);
    const registryPath = path.join(registryRoot, child.name);
    const diagnostics: Diagnostic[] = [];
    if (!validateIdentifier(id)) diagnostics.push(error("invalid-id", `Invalid Entry ID: ${id}`, id, registryPath));
    if ((collisions.get(id.toLowerCase()) ?? 0) > 1) diagnostics.push(error("id-collision", `Case-insensitive Entry ID collision: ${id}`, id, registryPath));
    let real = registryPath;
    let kind: EntryKind = "extension";
    try {
      real = await realpath(registryPath);
      await access(real, constants.R_OK);
      const target = await stat(real);
      if (target.isDirectory()) {
        const result = await classifyDirectory(real); kind = result.kind; diagnostics.push(...result.diagnostics);
      } else if (target.isFile()) {
        const extension = path.extname(child.name);
        kind = FILE_KINDS[extension] ?? "extension";
        if (!FILE_KINDS[extension]) diagnostics.push(error("unsupported-file", `Unsupported standalone file: ${child.name}`, id, registryPath));
        if (kind === "prompt") { try { await readFile(real, "utf8"); } catch { diagnostics.push(error("invalid-prompt", "Prompt must be readable UTF-8 Markdown", id, registryPath)); } }
        if (kind === "theme") { try { const theme = JSON.parse(await readFile(real, "utf8")); diagnostics.push(...validateTheme(theme).map((message) => error("invalid-theme", message, id, registryPath))); } catch { diagnostics.push(error("invalid-theme", "Theme must be parseable JSON", id, registryPath)); } }
      } else diagnostics.push(error("unsupported-target", "Entry target is not a regular file or directory", id, registryPath));
    } catch { diagnostics.push(error("unresolved", "Entry target is missing, unreadable, or has a symlink loop", id, registryPath)); }
    entries.push({id, kind, registryPath, realPath: real, status: diagnostics.some((item) => item.severity === "error") ? "invalid" : "valid", diagnostics});
  }
  return entries.sort((a, b) => naturalCompare(a.id, b.id) || naturalCompare(a.registryPath, b.registryPath));
}
