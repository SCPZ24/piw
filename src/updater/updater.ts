import type {Entry} from "../domain.js";

export type UpdateTarget = {kind: "git" | "npm"; key: string; label: string} | {kind: "unmanaged"; key: string; label: string};
export type UpdateOutcome =
  | {status: "updated" | "up-to-date"; manager: "git" | "npm"}
  | {status: "skipped" | "failed"; manager: "git" | "npm"; reason: string}
  | {status: "unmanaged"; manager: "local"};
export type UpdateClassifier = (entry: Entry) => Promise<UpdateTarget>;
export type UpdateExecutor = (key: string, target: UpdateTarget) => Promise<UpdateOutcome>;
export interface EntryUpdateResult {entry: Entry; outcome: UpdateOutcome}

export async function runUpdates(entries: Entry[], classify: UpdateClassifier, execute: UpdateExecutor): Promise<EntryUpdateResult[]> {
  const cache = new Map<string, UpdateOutcome>();
  const results: EntryUpdateResult[] = [];
  for (const entry of entries) {
    let target: UpdateTarget;
    try { target = await classify(entry); }
    catch (error) { results.push({entry, outcome: {status: "failed", manager: "git", reason: error instanceof Error ? error.message : String(error)}}); continue; }
    if (target.kind === "unmanaged") { results.push({entry, outcome: {status: "unmanaged", manager: "local"}}); continue; }
    let outcome = cache.get(target.key);
    if (!outcome) {
      try { outcome = await execute(target.key, target); }
      catch (error) { outcome = {status: "failed", manager: target.kind, reason: error instanceof Error ? error.message : String(error)}; }
      cache.set(target.key, outcome);
    }
    results.push({entry, outcome});
  }
  return results;
}
