import {lstat, realpath, stat} from "node:fs/promises";
import path from "node:path";
import {commandOutput, findExecutable} from "../launcher/launcher.js";
import type {ValidEntry} from "../domain.js";
import type {StepResult, UpdateDetector, UpdateExecutor, UpdateStep} from "./updater.js";

interface CommandResult {code: number; stdout: string; stderr: string}

export interface SystemUpdaterDependencies {
  findExecutable: (name: string) => Promise<string | undefined>;
  commandOutput: (command: string, args: string[], cwd?: string) => Promise<CommandResult>;
}

async function isRegularFile(filePath: string): Promise<boolean> {
  try { return (await stat(filePath)).isFile(); }
  catch { return false; }
}

async function hasGitMarker(root: string): Promise<boolean> {
  try {
    const marker = await lstat(path.join(root, ".git"));
    return marker.isFile() || marker.isDirectory();
  } catch {
    return false;
  }
}

function commandFailure(result: CommandResult, fallback: string): string {
  return result.stderr.trim() || result.stdout.trim() || fallback;
}

export function createSystemUpdater(dependencies: SystemUpdaterDependencies): {detect: UpdateDetector; execute: UpdateExecutor} {
  const detect: UpdateDetector = async (entry: ValidEntry): Promise<UpdateStep[]> => {
    const phases: UpdateStep[] = [];
    const git = await dependencies.findExecutable("git");
    if (git) {
      const top = await dependencies.commandOutput(git, ["-C", entry.realPath, "rev-parse", "--show-toplevel"]).catch(() => ({code: 1, stdout: "", stderr: ""}));
      if (top.code === 0) {
        try {
          const root = await realpath(top.stdout.trim());
          if (root === entry.realPath) phases.push({manager: "git", key: `git:${root}`, cwd: root});
        } catch {
          // An unresolved reported root is not safe to update.
        }
      }
    } else if (await hasGitMarker(entry.realPath)) {
      phases.push({manager: "git", key: `git:${entry.realPath}`, cwd: entry.realPath});
    }
    if (await isRegularFile(path.join(entry.realPath, "package.json"))) {
      phases.push({manager: "npm", key: `npm:${entry.realPath}`, cwd: entry.realPath});
    }
    return phases;
  };

  const executeGit = async (step: UpdateStep): Promise<StepResult> => {
    const git = await dependencies.findExecutable("git");
    if (!git) return {manager: "git", status: "skipped", reason: "git not found"};
    const run = async (args: string[]) => dependencies.commandOutput(git, ["-C", step.cwd, ...args]);

    const status = await run(["status", "--porcelain"]);
    if (status.code !== 0) return {manager: "git", status: "failed", reason: commandFailure(status, "git status failed")};
    if (status.stdout.trim()) return {manager: "git", status: "skipped", reason: "dirty working tree"};
    const branch = await run(["symbolic-ref", "--quiet", "--short", "HEAD"]);
    if (branch.code !== 0) return {manager: "git", status: "skipped", reason: "detached HEAD"};
    const upstream = await run(["rev-parse", "--abbrev-ref", "@{upstream}"]);
    if (upstream.code !== 0) return {manager: "git", status: "skipped", reason: "missing upstream"};
    const before = await run(["rev-parse", "HEAD"]);
    if (before.code !== 0 || !before.stdout.trim()) return {manager: "git", status: "failed", reason: commandFailure(before, "could not read HEAD before update")};
    const pull = await run(["pull", "--ff-only"]);
    if (pull.code !== 0) return {manager: "git", status: "failed", reason: commandFailure(pull, "git pull failed")};
    const after = await run(["rev-parse", "HEAD"]);
    if (after.code !== 0 || !after.stdout.trim()) return {manager: "git", status: "failed", reason: commandFailure(after, "could not verify HEAD after update")};
    return {manager: "git", status: before.stdout.trim() === after.stdout.trim() ? "up-to-date" : "updated"};
  };

  const executeNpm = async (step: UpdateStep): Promise<StepResult> => {
    const npm = await dependencies.findExecutable("npm");
    if (!npm) return {manager: "npm", status: "skipped", reason: "npm not found"};
    if (!await isRegularFile(path.join(step.cwd, "package.json"))) return {manager: "npm", status: "failed", reason: "package.json is no longer a regular file"};
    const result = await dependencies.commandOutput(npm, ["update", "--json"], step.cwd);
    if (result.code !== 0) return {manager: "npm", status: "failed", reason: commandFailure(result, "npm update failed")};
    try {
      const parsed = JSON.parse(result.stdout) as {added?: unknown; removed?: unknown; changed?: unknown};
      const changed = [parsed.added, parsed.removed, parsed.changed].some((value) => typeof value === "number" && value > 0);
      return {manager: "npm", status: changed ? "updated" : "up-to-date"};
    } catch {
      return {manager: "npm", status: "updated"};
    }
  };

  const execute: UpdateExecutor = async (step) => step.manager === "git" ? executeGit(step) : executeNpm(step);
  return {detect, execute};
}

const systemUpdater = createSystemUpdater({findExecutable, commandOutput});
export const detectSystemUpdates = systemUpdater.detect;
export const executeSystemUpdate = systemUpdater.execute;
