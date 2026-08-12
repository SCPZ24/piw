import {spawn} from "node:child_process";
import {constants} from "node:fs";
import {access, realpath} from "node:fs/promises";
import path from "node:path";
import semver from "semver";
import {naturalCompare, type ValidEntry} from "../domain.js";

export const MINIMUM_PI_VERSION = "0.84.1";
export const ISOLATION_ARGS = ["--no-extensions", "--no-skills", "--no-prompt-templates", "--no-themes"] as const;

export function compilePiArgs(entries: readonly ValidEntry[], passthrough: string[]): string[] {
  const args: string[] = [...ISOLATION_ARGS];
  for (const entry of [...entries].sort((a, b) => naturalCompare(a.id, b.id))) {
    const flag = entry.kind === "extension" || entry.kind === "package" ? "-e" : entry.kind === "skill" ? "--skill" : entry.kind === "prompt" ? "--prompt-template" : "--theme";
    args.push(flag, entry.launchPath);
  }
  return [...args, ...passthrough];
}

export async function findExecutable(name: string, environment: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  for (const directory of (environment.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.resolve(directory, name);
    try { await access(candidate, constants.X_OK); return await realpath(candidate); } catch { /* continue */ }
  }
  return undefined;
}

export async function commandOutput(command: string, args: string[], cwd?: string): Promise<{code: number; stdout: string; stderr: string}> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {cwd, shell: false, stdio: ["ignore", "pipe", "pipe"]});
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (data) => { stdout += data; }); child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", reject); child.on("close", (code) => resolve({code: code ?? 1, stdout, stderr}));
  });
}

export async function resolvePi(environment: NodeJS.ProcessEnv = process.env): Promise<{path: string; version: string}> {
  const executable = await findExecutable("pi", environment);
  if (!executable) throw new Error("PIW cannot launch because `pi` was not found on PATH");
  const result = await commandOutput(executable, ["--version"]);
  const version = semver.coerce(result.stdout.trim())?.version;
  if (result.code !== 0 || !version) throw new Error("PIW could not determine the installed Pi version");
  if (semver.lt(version, MINIMUM_PI_VERSION)) throw new Error(`PIW requires Pi >=${MINIMUM_PI_VERSION}; found ${version}`);
  return {path: executable, version};
}

export function replaceWithPi(executable: string, args: string[], environment: NodeJS.ProcessEnv = process.env): never {
  if (!process.execve) throw new Error("PIW requires process.execve() on a supported Unix platform");
  process.execve(executable, ["pi", ...args], environment);
  throw new Error("execve unexpectedly returned");
}
