import {expect, test, vi} from "vitest";
import type {Entry} from "../src/domain.js";
import {runUpdates, type UpdateClassifier} from "../src/updater/updater.js";

test("deduplicates manager targets and continues after failure", async () => {
  const entries: Entry[] = ["a", "b", "c"].map((id) => ({id, kind: "extension", registryPath: id, realPath: id, status: "valid", diagnostics: []}));
  const execute = vi.fn(async (key: string) => key === "git:/x" ? {status: "failed" as const, manager: "git" as const, reason: "pull failed"} : {status: "up-to-date" as const, manager: "npm" as const});
  const classifier: UpdateClassifier = async (entry) => entry.id === "c" ? {kind: "npm", key: "npm:/y:p", label: "p"} : {kind: "git", key: "git:/x", label: "/x"};
  const results = await runUpdates(entries, classifier, execute);
  expect(execute).toHaveBeenCalledTimes(2);
  expect(results.map((result) => result.outcome.status)).toEqual(["failed", "failed", "up-to-date"]);
});

test("continues when one classifier throws", async () => {
  const entries: Entry[] = ["a", "b"].map((id) => ({id, kind: "extension", registryPath: id, realPath: id, status: "valid", diagnostics: []}));
  const results = await runUpdates(entries, async (entry) => {
    if (entry.id === "a") throw new Error("disappeared");
    return {kind: "unmanaged", key: "b", label: "b"};
  }, async () => ({status: "up-to-date", manager: "git"}));
  expect(results.map((result) => result.outcome.status)).toEqual(["failed", "unmanaged"]);
});
