import type {ValidEntry} from "../domain.js";

export type UpdateManager = "git" | "npm";

export interface UpdateStep {
  manager: UpdateManager;
  key: string;
  cwd: string;
  blockedReason?: string;
}

export type StepResult =
  | {manager: UpdateManager; status: "updated" | "up-to-date"}
  | {manager: UpdateManager; status: "skipped" | "failed"; reason: string}
  | {manager: "external"; status: "external"}
  | {manager: "local"; status: "unmanaged"}
  | {manager: "local"; status: "failed"; reason: string};

export interface EntryUpdateResult {
  entry: ValidEntry;
  steps: StepResult[];
}

export type UpdateDetection =
  | {ownership: "external"}
  | {ownership: "local"; phases: UpdateStep[]};

export type UpdateDetector = (entry: ValidEntry) => Promise<UpdateDetection>;
export type UpdateExecutor = (step: UpdateStep) => Promise<StepResult>;

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runUpdates(entries: readonly ValidEntry[], detect: UpdateDetector, execute: UpdateExecutor): Promise<EntryUpdateResult[]> {
  const cache = new Map<string, StepResult>();
  const results: EntryUpdateResult[] = [];
  for (const entry of entries) {
    let detection: UpdateDetection;
    try { detection = await detect(entry); }
    catch (cause) {
      results.push({entry, steps: [{manager: "local", status: "failed", reason: reason(cause)}]});
      continue;
    }
    if (detection.ownership === "external") {
      results.push({entry, steps: [{manager: "external", status: "external"}]});
      continue;
    }
    const phases = detection.phases;
    if (!phases.length) {
      results.push({entry, steps: [{manager: "local", status: "unmanaged"}]});
      continue;
    }

    const steps: StepResult[] = [];
    let gitCompletedSafely = true;
    for (const phase of phases) {
      if (phase.manager === "npm" && !gitCompletedSafely) {
        steps.push({manager: "npm", status: "skipped", reason: "git phase did not complete safely"});
        continue;
      }
      let result = cache.get(phase.key);
      if (!result) {
        try { result = await execute(phase); }
        catch (cause) { result = {manager: phase.manager, status: "failed", reason: reason(cause)}; }
        cache.set(phase.key, result);
      }
      steps.push(result);
      if (phase.manager === "git") gitCompletedSafely = result.manager === "git" && (result.status === "updated" || result.status === "up-to-date");
    }
    results.push({entry, steps});
  }
  return results;
}
