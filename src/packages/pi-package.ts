import {spawn} from "node:child_process";
import {lstat, mkdir, readdir, realpath, stat, symlink} from "node:fs/promises";
import path from "node:path";
import {validateIdentifier} from "../domain.js";
import {resolvePi as resolveSystemPi} from "../launcher/launcher.js";

const MAX_NPM_PACKAGE_NAME_LENGTH = 214;
const NPM_COMPONENT_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

interface ParsedPackageName {
  scope?: string;
  name: string;
}

export type AddPackageResult =
  | {status: "linked"; entryId: string; registryPath: string; installedPath: string; installedByCommand: boolean}
  | {status: "already-available"; entryId: string; registryPath: string; installedPath: string};

export interface AddPackageDependencies {
  resolvePi: () => Promise<{path: string; version: string}>;
  installPackage: (piPath: string, packageName: string) => Promise<void>;
}

function parseNpmPackageName(packageName: string): ParsedPackageName | undefined {
  if (!packageName || packageName.length > MAX_NPM_PACKAGE_NAME_LENGTH) return undefined;
  if (packageName.startsWith("@")) {
    const match = /^@([^/]+)\/([^/]+)$/.exec(packageName);
    if (!match) return undefined;
    const scope = match[1]!;
    const name = match[2]!;
    if (!NPM_COMPONENT_PATTERN.test(scope) || !NPM_COMPONENT_PATTERN.test(name)) return undefined;
    return {scope, name};
  }
  if (!NPM_COMPONENT_PATTERN.test(packageName)) return undefined;
  return {name: packageName};
}

export function validateNpmPackageName(packageName: string): boolean {
  return parseNpmPackageName(packageName) !== undefined;
}

export function deriveEntryId(packageName: string): string {
  const parsed = parseNpmPackageName(packageName);
  if (!parsed) throw new Error(`Invalid npm package name: ${packageName}`);
  if (!validateIdentifier(parsed.name)) throw new Error(`Package "${packageName}" has invalid derived Entry ID "${parsed.name}"`);
  return parsed.name;
}

export function resolvePiPackagePath(home: string, packageName: string): string {
  const parsed = parseNpmPackageName(packageName);
  if (!parsed) throw new Error(`Invalid npm package name: ${packageName}`);
  const modules = path.resolve(home, ".pi", "agent", "npm", "node_modules");
  return parsed.scope ? path.join(modules, `@${parsed.scope}`, parsed.name) : path.join(modules, parsed.name);
}

function isMissing(cause: unknown): boolean {
  return (cause as NodeJS.ErrnoException)?.code === "ENOENT";
}

async function inspectRegistryPath(registryPath: string, installedPath: string, entryId: string): Promise<"absent" | "already-available"> {
  let info;
  try { info = await lstat(registryPath); }
  catch (cause) {
    if (isMissing(cause)) return "absent";
    throw cause;
  }
  if (!info.isSymbolicLink()) throw new Error(`Entry "${entryId}" already exists at ${registryPath}`);
  let actual: string;
  try { actual = await realpath(registryPath); }
  catch { throw new Error(`Entry "${entryId}" already exists as a broken symlink at ${registryPath}`); }
  let expected: string;
  try { expected = await realpath(installedPath); }
  catch { throw new Error(`Entry "${entryId}" already exists as a symlink, but the requested Pi package is missing at ${installedPath}`); }
  if (actual !== expected) throw new Error(`Entry "${entryId}" already exists as a symlink to a different target`);
  return "already-available";
}

async function rejectCaseInsensitiveCollision(piwHome: string, entryId: string): Promise<void> {
  let names: string[];
  try { names = await readdir(piwHome); }
  catch (cause) {
    if (isMissing(cause)) return;
    throw cause;
  }
  const conflicting = names.find((name) => name !== entryId && name.toLowerCase() === entryId.toLowerCase());
  if (conflicting) throw new Error(`Case-insensitive Entry ID collision: "${conflicting}" conflicts with "${entryId}"`);
}

async function installedDirectoryState(installedPath: string): Promise<"absent" | "directory"> {
  let linkInfo;
  try { linkInfo = await lstat(installedPath); }
  catch (cause) {
    if (isMissing(cause)) return "absent";
    throw cause;
  }
  try {
    const info = await stat(installedPath);
    if (!info.isDirectory()) throw new Error(`Pi package path exists but is not a directory: ${installedPath}`);
    return "directory";
  } catch (cause) {
    if (isMissing(cause) && linkInfo.isSymbolicLink()) throw new Error(`Pi package path exists as a broken symlink: ${installedPath}`);
    throw cause;
  }
}

export async function installPiPackage(piPath: string, packageName: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(piPath, ["install", `npm:${packageName}`], {stdio: "inherit", shell: false});
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(signal
        ? `Pi install was terminated by signal ${signal}`
        : `Pi install failed with exit code ${code ?? "unknown"}`));
    });
  });
}

const systemDependencies: AddPackageDependencies = {
  resolvePi: () => resolveSystemPi(),
  installPackage: installPiPackage,
};

export async function addPiPackage(
  packageName: string,
  home: string,
  dependencies: AddPackageDependencies = systemDependencies,
): Promise<AddPackageResult> {
  if (!validateNpmPackageName(packageName)) throw new Error(`Invalid npm package name: ${packageName}`);
  const entryId = deriveEntryId(packageName);
  const installedPath = resolvePiPackagePath(home, packageName);
  const piwHome = path.resolve(home, ".pi", "piw");
  const registryPath = path.join(piwHome, entryId);

  await rejectCaseInsensitiveCollision(piwHome, entryId);
  if (await inspectRegistryPath(registryPath, installedPath, entryId) === "already-available") {
    await installedDirectoryState(installedPath);
    return {status: "already-available", entryId, registryPath, installedPath};
  }

  let installedByCommand = false;
  if (await installedDirectoryState(installedPath) === "absent") {
    const pi = await dependencies.resolvePi();
    await dependencies.installPackage(pi.path, packageName);
    installedByCommand = true;
    if (await installedDirectoryState(installedPath) !== "directory") {
      throw new Error(`Pi reported success but did not create the package directory: ${installedPath}`);
    }
  }

  await mkdir(path.dirname(registryPath), {recursive: true});
  try { await symlink(installedPath, registryPath); }
  catch (cause) {
    if ((cause as NodeJS.ErrnoException)?.code === "EEXIST") throw new Error(`Entry "${entryId}" already exists at ${registryPath}`);
    throw cause;
  }
  return {status: "linked", entryId, registryPath, installedPath, installedByCommand};
}
