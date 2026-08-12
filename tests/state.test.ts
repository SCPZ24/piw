import {mkdtemp, readFile, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {describe, expect, test} from "vitest";
import {ConcurrentStateError, ensurePiwHome, loadState, saveState, validateState} from "../src/state/state.js";
import {snapshot} from "../src/app.js";

describe("state", () => {
  test("accepts and normalizes a strict v1 state", () => {
    expect(validateState({version: 1, profiles: {builder: {entries: ["x10", "x2"]}}})).toEqual({
      version: 1, profiles: {builder: {entries: ["x2", "x10"]}},
    });
    expect(() => validateState({version: 1, profiles: {}, extra: true})).toThrow("exactly version and profiles");
    expect(() => validateState({version: 3, profiles: {}})).toThrow("newer");
  });

  test("initializes missing state without overwriting existing state", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "piw-state-"));
    const paths = await ensurePiwHome(home);
    expect(JSON.parse(await readFile(paths.stateFile, "utf8"))).toEqual({version: 1, profiles: {}});
    await writeFile(paths.stateFile, "{\"version\":1,\"profiles\":{\"x\":{\"entries\":[]}}}\n");
    await ensurePiwHome(home);
    expect((await readFile(paths.stateFile, "utf8"))).toContain('"x"');
  });

  test("refuses to overwrite an externally changed state", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "piw-concurrent-"));
    const paths = await ensurePiwHome(home);
    const loaded = await loadState(paths.stateFile);
    await writeFile(paths.stateFile, '{"version":1,"profiles":{"external":{"entries":[]}}}\n');
    await expect(saveState(paths.stateFile, {version: 1, profiles: {mine: {entries: []}}}, loaded.fingerprint)).rejects.toBeInstanceOf(ConcurrentStateError);
    expect((await readFile(paths.stateFile, "utf8"))).toContain("external");
  });

  test("read-only snapshots do not initialize missing state", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "piw-readonly-"));
    await expect(snapshot(home, false)).rejects.toThrow();
    await expect(readFile(path.join(home, ".pi", "piw", "piw.json"))).rejects.toThrow();
  });
});
