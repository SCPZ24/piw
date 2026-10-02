import {access, mkdtemp, readFile, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {describe, expect, test} from "vitest";
import {ConcurrentStateError, ensurePiwHome, getPiwPaths, loadState, saveState, validateState} from "../src/state/state.js";
import {snapshot} from "../src/app.js";

describe("state", () => {
  test("accepts and normalizes a strict v1 state", () => {
    expect(validateState({version: 1, profiles: {builder: {entries: ["x10", "x2"]}}})).toEqual({
      version: 2, profiles: {builder: {entries: ["x2", "x10"]}},
    });
    expect(() => validateState({version: 1, profiles: {}, extra: true})).toThrow("exactly version and profiles");
    expect(() => validateState({version: 3, profiles: {}})).toThrow("newer");
  });

  test("initializes missing state without overwriting existing state", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "piw-state-"));
    const paths = await ensurePiwHome(home);
    expect(paths).toEqual({
      piwHome: path.join(home, ".pi", "piw"),
      stateFile: path.join(home, ".pi", "piw", "piw.json"),
    });
    await expect(access(path.join(paths.piwHome, "entries"))).rejects.toThrow();
    expect(JSON.parse(await readFile(paths.stateFile, "utf8"))).toEqual({version: 2, profiles: {}});
    await writeFile(paths.stateFile, "{\"version\":1,\"profiles\":{\"x\":{\"entries\":[]}}}\n");
    await ensurePiwHome(home);
    expect((await readFile(paths.stateFile, "utf8"))).toContain('"x"');
  });

  test("uses the PIW home itself as the Entry root", () => {
    const home = "/tmp/piw-home-contract";
    expect(getPiwPaths(home)).toEqual({
      piwHome: path.join(home, ".pi", "piw"),
      stateFile: path.join(home, ".pi", "piw", "piw.json"),
    });
  });

  test("refuses to overwrite an externally changed state", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "piw-concurrent-"));
    const paths = await ensurePiwHome(home);
    const loaded = await loadState(paths.stateFile);
    await writeFile(paths.stateFile, '{"version":1,"profiles":{"external":{"entries":[]}}}\n');
    await expect(saveState(paths.stateFile, {version: 2, profiles: {mine: {entries: []}}}, loaded.fingerprint)).rejects.toBeInstanceOf(ConcurrentStateError);
    expect((await readFile(paths.stateFile, "utf8"))).toContain("external");
  });

  test("read-only snapshots do not initialize missing state", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "piw-readonly-"));
    await expect(snapshot(home, false)).rejects.toThrow();
    await expect(readFile(path.join(home, ".pi", "piw", "piw.json"))).rejects.toThrow();
  });

  test("rejects state containing invalid UTF-8 bytes", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "piw-invalid-utf8-"));
    const paths = await ensurePiwHome(home);
    await writeFile(paths.stateFile, Buffer.concat([Buffer.from('{"version":1,"profiles":{"'), Buffer.from([0xc3, 0x28]), Buffer.from('":{"entries":[]}}}')]));
    await expect(loadState(paths.stateFile)).rejects.toThrow("valid UTF-8 JSON");
  });
});

test("reads v1 without writing and upgrades only on explicit save", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "piw-migrate-"));
  const paths = await ensurePiwHome(home);
  const original = '{"version":1,"profiles":{"dev":{"entries":["x10","x2"]}}}\n';
  await writeFile(paths.stateFile, original);
  const loaded = await loadState(paths.stateFile);
  expect(loaded.state).toEqual({version: 2, profiles: {dev: {entries: ["x2", "x10"]}}});
  expect(Buffer.from(loaded.rawBytes).toString()).toBe(original);
  await snapshot(home);
  expect(await readFile(paths.stateFile, "utf8")).toBe(original);
  const edited = {version: 2 as const, profiles: {dev: {entries: ["builtin:mcp", ...loaded.state.profiles.dev!.entries]}}};
  const saved = await saveState(paths.stateFile, edited, loaded.fingerprint);
  expect(JSON.parse(await readFile(paths.stateFile, "utf8"))).toEqual(edited);
  expect((await loadState(paths.stateFile)).state).toEqual(edited);
  expect(saved.fingerprint).not.toBe(loaded.fingerprint);
});

test("v2 accepts unknown builtin references but rejects malformed or duplicate references", () => {
  expect(validateState({version: 2, profiles: {dev: {entries: ["builtin:future", "builtin:llama.cpp"]}}}).profiles.dev?.entries).toEqual(["builtin:future", "builtin:llama.cpp"]);
  expect(() => validateState({version: 1, profiles: {dev: {entries: ["builtin:mcp"]}}})).toThrow("invalid Entry IDs");
  for (const entries of [["builtin:"], ["builtin:../mcp"], ["builtin:mcp", "builtin:mcp"]]) {
    expect(() => validateState({version: 2, profiles: {dev: {entries}}})).toThrow();
  }
  expect(() => validateState({version: 2, profiles: {"builtin:mcp": {entries: []}}})).toThrow("Invalid profile name");
  expect(() => validateState({version: 2, profiles: {dev: {entries: [], source: "builtin"}}})).toThrow("exactly entries");
});
