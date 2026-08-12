import {lstat, readFile, realpath} from "node:fs/promises";
import path from "node:path";
import {commandOutput, findExecutable} from "../launcher/launcher.js";
import type {Entry} from "../domain.js";
import type {UpdateClassifier, UpdateExecutor, UpdateOutcome, UpdateTarget} from "./updater.js";

async function gitOutput(root: string, args: string[]) { return commandOutput("git", ["-C", root, ...args]); }

export const classifySystemUpdate: UpdateClassifier = async (entry: Entry): Promise<UpdateTarget> => {
  if (await findExecutable("git")) {
    const top = await gitOutput(entry.realPath, ["rev-parse", "--show-toplevel"]).catch(() => ({code: 1, stdout: "", stderr: ""}));
    if (top.code === 0) {
      const root = await realpath(top.stdout.trim());
      if (root === entry.realPath) return {kind: "git", key: `git:${root}`, label: root};
    }
  }
  const parts = entry.realPath.split(path.sep);
  const nodeModules = parts.lastIndexOf("node_modules");
  if (nodeModules < 1) return {kind: "unmanaged", key: `local:${entry.realPath}`, label: entry.realPath};
  const rest = parts.slice(nodeModules + 1);
  const packageName = rest[0]?.startsWith("@") ? rest.slice(0, 2).join("/") : rest[0];
  if (!packageName || rest.length !== (packageName.startsWith("@") ? 2 : 1)) return {kind: "unmanaged", key: `local:${entry.realPath}`, label: entry.realPath};
  const installRoot = parts.slice(0, nodeModules).join(path.sep) || path.sep;
  try {
    const own = JSON.parse(await readFile(path.join(entry.realPath, "package.json"), "utf8"));
    const root = JSON.parse(await readFile(path.join(installRoot, "package.json"), "utf8"));
    const lock = JSON.parse(await readFile(path.join(installRoot, "package-lock.json"), "utf8"));
    const direct = root.dependencies?.[packageName] ?? root.devDependencies?.[packageName] ?? root.optionalDependencies?.[packageName];
    const record = lock.packages?.[`node_modules/${packageName}`];
    const installedPath = path.join(installRoot, "node_modules", packageName);
    const installedStat = await lstat(installedPath);
    if (!direct || ![2, 3].includes(lock.lockfileVersion) || !record || record.link === true || installedStat.isSymbolicLink() || await realpath(installedPath) !== entry.realPath || own.name !== packageName || !own.version || own.version !== record.version) throw new Error();
    return {kind: "npm", key: `npm:${installRoot}:${packageName}`, label: `${installRoot}\0${packageName}`};
  } catch { return {kind: "unmanaged", key: `local:${entry.realPath}`, label: entry.realPath}; }
};

export const executeSystemUpdate: UpdateExecutor = async (_key, target): Promise<UpdateOutcome> => {
  if (target.kind === "git") {
    if (!await findExecutable("git")) return {status: "skipped", manager: "git", reason: "git not found"};
    const root = target.label;
    const status = await gitOutput(root, ["status", "--porcelain"]);
    if (status.code || status.stdout.trim()) return {status: "skipped", manager: "git", reason: "dirty working tree"};
    const branch = await gitOutput(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    if (branch.code) return {status: "skipped", manager: "git", reason: "detached HEAD"};
    const upstream = await gitOutput(root, ["rev-parse", "--abbrev-ref", "@{upstream}"]);
    if (upstream.code) return {status: "skipped", manager: "git", reason: "missing upstream"};
    const before = await gitOutput(root, ["rev-parse", "HEAD"]);
    const pull = await gitOutput(root, ["pull", "--ff-only"]);
    if (pull.code) return {status: "failed", manager: "git", reason: pull.stderr.trim() || "git pull failed"};
    const after = await gitOutput(root, ["rev-parse", "HEAD"]);
    if (before.code || after.code) return {status: "failed", manager: "git", reason: "could not verify HEAD after update"};
    return {status: before.stdout.trim() === after.stdout.trim() ? "up-to-date" : "updated", manager: "git"};
  }
  if (target.kind === "npm") {
    if (!await findExecutable("npm")) return {status: "skipped", manager: "npm", reason: "npm not found"};
    const [installRoot, packageName] = target.label.split("\0");
    if (!installRoot || !packageName) return {status: "failed", manager: "npm", reason: "invalid update target"};
    const evidence = async () => {
      const own = JSON.parse(await readFile(path.join(installRoot, "node_modules", packageName, "package.json"), "utf8"));
      const lock = JSON.parse(await readFile(path.join(installRoot, "package-lock.json"), "utf8"));
      const record = lock.packages?.[`node_modules/${packageName}`];
      if (own.name !== packageName || !own.version || !record || record.link === true || record.version !== own.version) throw new Error("npm ownership evidence is no longer valid");
      return JSON.stringify({version: own.version, record});
    };
    let before: string;
    try { before = await evidence(); } catch (error) { return {status: "failed", manager: "npm", reason: (error as Error).message}; }
    const result = await commandOutput("npm", ["update", packageName], installRoot);
    if (result.code) return {status: "failed", manager: "npm", reason: result.stderr.trim() || "npm update failed"};
    try {
      const after = await evidence();
      return {status: before === after ? "up-to-date" : "updated", manager: "npm"};
    } catch { return {status: "failed", manager: "npm", reason: "could not verify package after update"}; }
  }
  return {status: "unmanaged", manager: "local"};
};
