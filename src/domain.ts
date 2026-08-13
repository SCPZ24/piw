export const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const RESERVED_PROFILE_NAMES = new Set(["add", "config", "update", "list", "doctor", "help", "version"]);

export type EntryKind = "extension" | "skill" | "prompt" | "theme" | "package";
export type DiagnosticSeverity = "warning" | "error";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  entryId?: string;
  profileName?: string;
  path?: string;
  hint?: string;
}

export interface EntryBase {
  id: string;
  registryPath: string;
  realPath: string;
  diagnostics: Diagnostic[];
}

export interface ValidEntry extends EntryBase {
  status: "valid";
  kind: EntryKind;
  launchPath: string;
}

export interface InvalidEntry extends EntryBase {
  status: "invalid";
  kind?: EntryKind;
  launchPath?: string;
}

export type Entry = ValidEntry | InvalidEntry;

export interface PiwStateV1 {
  version: 1;
  profiles: Record<string, {entries: string[]}>;
}

export function validateIdentifier(value: string): boolean {
  return IDENTIFIER_PATTERN.test(value);
}

export function validateProfileName(value: string): {valid: true} | {valid: false; reason: string} {
  if (!validateIdentifier(value)) return {valid: false, reason: "invalid profile name"};
  if (RESERVED_PROFILE_NAMES.has(value)) return {valid: false, reason: "reserved profile name"};
  return {valid: true};
}

function runs(value: string): string[] {
  return value.match(/\d+|\D+/g) ?? [];
}

export function naturalCompare(left: string, right: string): number {
  const leftRuns = runs(left);
  const rightRuns = runs(right);
  const length = Math.min(leftRuns.length, rightRuns.length);
  for (let index = 0; index < length; index += 1) {
    const a = leftRuns[index]!;
    const b = rightRuns[index]!;
    const digits = /^\d+$/.test(a) && /^\d+$/.test(b);
    if (digits) {
      const numberOrder = BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;
      if (numberOrder !== 0) return numberOrder;
    } else if (a !== b) {
      return a < b ? -1 : 1;
    }
  }
  if (leftRuns.length !== rightRuns.length) return leftRuns.length - rightRuns.length;
  return left < right ? -1 : left > right ? 1 : 0;
}
