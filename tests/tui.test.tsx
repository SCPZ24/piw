import React from "react";
import chalk from "chalk";
import {expect, test, vi} from "vitest";
import {render} from "ink-testing-library";
import {Selector} from "../src/tui/selector.js";
import {ConfigApp} from "../src/tui/config.js";
import {getBuiltinEntries} from "../src/registry/builtins.js";

test("selector skips unavailable profiles and selects a ready profile", async () => {
  const selected = vi.fn();
  const view = render(<Selector profiles={[
    {name: "broken", available: false, diagnostics: [{severity: "error", code: "missing", message: "Entry missing"}]},
    {name: "ready", available: true, diagnostics: []},
  ]} onSelect={selected} onCancel={() => undefined} />);
  expect(view.lastFrame()).toContain("ready");
  view.stdin.write("\r");
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(selected).toHaveBeenCalledWith("ready");
});

test("selector visibly dims unavailable profiles", () => {
  const colorLevel = chalk.level;
  chalk.level = 1;
  try {
    const view = render(<Selector profiles={[
      {name: "ready", available: true, diagnostics: []},
      {name: "broken", available: false, diagnostics: [{severity: "error", code: "missing", message: "Entry missing"}]},
    ]} onSelect={() => undefined} onCancel={() => undefined} />);

    expect(view.lastFrame()).toMatch(/\u001B\[2m\s+broken\s+unavailable\u001B\[22m/);
  } finally {
    chalk.level = colorLevel;
  }
});

test("config creates and saves a profile", async () => {
  const save = vi.fn();
  const view = render(<ConfigApp initial={{version: 2, profiles: {}}} entries={getBuiltinEntries()} onSave={save} onCancel={() => undefined} />);
  view.stdin.write("n");
  await new Promise((resolve) => setTimeout(resolve, 10));
  view.stdin.write("builder");
  await new Promise((resolve) => setTimeout(resolve, 10));
  view.stdin.write("\r");
  await new Promise((resolve) => setTimeout(resolve, 10));
  view.stdin.write("s");
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(save).toHaveBeenCalledWith({version: 2, profiles: {builder: {entries: []}}});
});

test("config asks whether to save, discard, or continue when dirty", async () => {
  const cancel = vi.fn();
  const view = render(<ConfigApp initial={{version: 2, profiles: {x: {entries: []}}}} entries={[]} onSave={() => undefined} onCancel={cancel} />);
  view.stdin.write("d");
  await new Promise((resolve) => setTimeout(resolve, 10));
  view.stdin.write("y");
  await new Promise((resolve) => setTimeout(resolve, 10));
  view.stdin.write("q");
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(view.lastFrame()).toContain("Save, discard, or continue editing");
  expect(cancel).not.toHaveBeenCalled();
  view.stdin.write("d");
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(cancel).toHaveBeenCalledOnce();
});

test("config cannot newly select an invalid Entry", async () => {
  const save = vi.fn();
  const view = render(<ConfigApp initial={{version: 2, profiles: {x: {entries: []}}}} entries={[
    {source: "filesystem", id: "bad", registryPath: "/r/bad", realPath: "/r/bad", status: "invalid", diagnostics: [{severity: "error", code: "invalid", message: "bad"}]},
  ]} onSave={save} onCancel={() => undefined} />);
  view.stdin.write("\r");
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(view.lastFrame()).toContain("invalid: bad");
  view.stdin.write(" ");
  await new Promise((resolve) => setTimeout(resolve, 10));
  view.stdin.write("s");
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(save).toHaveBeenCalledWith({version: 2, profiles: {x: {entries: []}}});
});

test("config retains a missing reference and lets the user remove it", async () => {
  const save = vi.fn();
  const view = render(<ConfigApp initial={{version: 2, profiles: {x: {entries: ["gone"]}}}} entries={[]} onSave={save} onCancel={() => undefined} />);
  view.stdin.write("\r");
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(view.lastFrame()).toContain("gone missing");
  view.stdin.write(" ");
  await new Promise((resolve) => setTimeout(resolve, 10));
  view.stdin.write("s");
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(save).toHaveBeenCalledWith({version: 2, profiles: {x: {entries: []}}});
});

test("cancelling config after loading v1 leaves original bytes untouched", async () => {
  const {mkdtemp, readFile, writeFile} = await import("node:fs/promises");
  const {tmpdir} = await import("node:os");
  const {join} = await import("node:path");
  const {ensurePiwHome, loadState, saveState} = await import("../src/state/state.js");
  const paths = await ensurePiwHome(await mkdtemp(join(tmpdir(), "piw-cancel-")));
  const original = '{"version":1,"profiles":{"dev":{"entries":[]}}}\n';
  await writeFile(paths.stateFile, original);
  const loaded = await loadState(paths.stateFile);
  const cancel = vi.fn();
  const save = vi.fn(async (state: typeof loaded.state) => { await saveState(paths.stateFile, state, loaded.fingerprint); });
  const view = render(<ConfigApp initial={loaded.state} entries={[]} onSave={save} onCancel={cancel} />);
  view.stdin.write("q");
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(cancel).toHaveBeenCalledOnce();
  expect(save).not.toHaveBeenCalled();
  expect(await readFile(paths.stateFile, "utf8")).toBe(original);
  view.unmount();
});

test("config labels builtins, selects only MCP, and removes an unknown builtin", async () => {
  const save = vi.fn();
  const view = render(<ConfigApp initial={{version: 2, profiles: {dev: {entries: ["builtin:future"]}}}} entries={getBuiltinEntries()} onSave={save} onCancel={() => undefined} />);
  const press = async (key: string) => { view.stdin.write(key); await new Promise((resolve) => setTimeout(resolve, 10)); };
  await press("\r");
  expect(view.lastFrame()).toContain("[ ] builtin:mcp extension (Pi built-in)");
  expect(view.lastFrame()).toContain("Loads the extension; tool activation is controlled by Pi.");
  await press("\u001b[B");
  expect(view.lastFrame()).toContain("> [!] builtin:future missing");
  await press(" ");
  await press("\u001b[B");
  expect(view.lastFrame()).toContain("> [ ] builtin:mcp");
  await press(" ");
  await press("s");
  expect(save).toHaveBeenCalledWith({version: 2, profiles: {dev: {entries: ["builtin:mcp"]}}});
  view.unmount();
});
