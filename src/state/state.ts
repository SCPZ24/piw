import {createHash, randomUUID} from "node:crypto";
import {constants} from "node:fs";
import {access, mkdir, open, readFile, rename, unlink} from "node:fs/promises";
import path from "node:path";
import {naturalCompare, type PiwStateV1, validateIdentifier, validateProfileName} from "../domain.js";

export class StateValidationError extends Error {}
export class ConcurrentStateError extends Error {}

export interface PiwPaths {piwHome: string; registryRoot: string; stateFile: string}
export interface LoadedState {state: PiwStateV1; fingerprint: string; rawBytes: Uint8Array}

export function getPiwPaths(home: string): PiwPaths {
  const piwHome = path.join(home, ".pi", "piw");
  return {piwHome, registryRoot: path.join(piwHome, "entries"), stateFile: path.join(piwHome, "piw.json")};
}

function exactKeys(value: object, expected: string[], label: string): void {
  const keys = Object.keys(value).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== [...expected].sort()[index])) {
    throw new StateValidationError(`${label} must contain exactly ${expected.join(" and ")}`);
  }
}

export function validateState(input: unknown): PiwStateV1 {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new StateValidationError("PIW state must be an object");
  exactKeys(input, ["version", "profiles"], "PIW state");
  const record = input as Record<string, unknown>;
  if (record.version !== 1) {
    if (typeof record.version === "number" && record.version > 1) throw new StateValidationError(`PIW state version ${record.version} is newer than this release supports`);
    throw new StateValidationError("PIW state version must be 1");
  }
  if (!record.profiles || typeof record.profiles !== "object" || Array.isArray(record.profiles)) throw new StateValidationError("profiles must be an object");
  const profiles: PiwStateV1["profiles"] = {};
  const seen = new Set<string>();
  for (const [name, value] of Object.entries(record.profiles)) {
    const validity = validateProfileName(name);
    if (!validity.valid) throw new StateValidationError(`Invalid profile name "${name}": ${validity.reason}`);
    const folded = name.toLowerCase();
    if (seen.has(folded)) throw new StateValidationError(`Duplicate logical profile name: ${name}`);
    seen.add(folded);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new StateValidationError(`Profile "${name}" must be an object`);
    exactKeys(value, ["entries"], `Profile "${name}"`);
    const entries = (value as {entries?: unknown}).entries;
    if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== "string" || !validateIdentifier(entry))) throw new StateValidationError(`Profile "${name}" has invalid Entry IDs`);
    if (new Set(entries).size !== entries.length) throw new StateValidationError(`Profile "${name}" has duplicate Entry IDs`);
    profiles[name] = {entries: [...entries].sort(naturalCompare)};
  }
  return {version: 1, profiles: Object.fromEntries(Object.entries(profiles).sort(([a], [b]) => naturalCompare(a, b)))};
}

function fingerprint(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }

export async function ensurePiwHome(home: string): Promise<PiwPaths> {
  const paths = getPiwPaths(home);
  await mkdir(paths.registryRoot, {recursive: true});
  try { await access(paths.stateFile, constants.F_OK); }
  catch {
    const handle = await open(paths.stateFile, "wx", 0o600).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST") return undefined;
      throw error;
    });
    if (handle) { await handle.writeFile('{\n  "version": 1,\n  "profiles": {}\n}\n'); await handle.sync(); await handle.close(); }
  }
  return paths;
}

export async function loadState(stateFile: string): Promise<LoadedState> {
  const rawBytes = await readFile(stateFile);
  let parsed: unknown;
  try { parsed = JSON.parse(rawBytes.toString("utf8")); } catch { throw new StateValidationError("PIW state is not valid UTF-8 JSON"); }
  return {state: validateState(parsed), fingerprint: fingerprint(rawBytes), rawBytes};
}

export async function saveState(stateFile: string, state: PiwStateV1, expectedFingerprint: string): Promise<LoadedState> {
  const normalized = validateState(state);
  const bytes = Buffer.from(`${JSON.stringify(normalized, null, 2)}\n`);
  const temporary = path.join(path.dirname(stateFile), `.piw.json.${process.pid}.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(bytes); await handle.sync(); await handle.close();
    const current = await readFile(stateFile);
    if (fingerprint(current) !== expectedFingerprint) throw new ConcurrentStateError("PIW state changed externally; reopen piw config");
    await rename(temporary, stateFile);
    const directory = await open(path.dirname(stateFile), "r");
    try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) {
    await handle.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return {state: normalized, fingerprint: fingerprint(bytes), rawBytes: bytes};
}
