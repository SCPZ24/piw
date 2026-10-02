import type {ValidEntry} from "../domain.js";

const BUILTIN_IDS = ["builtin:codemode", "builtin:llama.cpp", "builtin:mcp", "builtin:tool-search"] as const;

export function getBuiltinEntries(): ValidEntry[] {
  return BUILTIN_IDS.map((id) => ({source: "builtin", id, kind: "extension", status: "valid", launchPath: id, diagnostics: []}));
}
