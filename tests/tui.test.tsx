import React from "react";
import chalk from "chalk";
import {expect, test, vi} from "vitest";
import {render} from "ink-testing-library";
import {Selector} from "../src/tui/selector.js";
import {ConfigApp} from "../src/tui/config.js";

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
  const view = render(<ConfigApp initial={{version: 1, profiles: {}}} entries={[]} onSave={save} onCancel={() => undefined} />);
  view.stdin.write("n");
  await new Promise((resolve) => setTimeout(resolve, 10));
  view.stdin.write("builder");
  await new Promise((resolve) => setTimeout(resolve, 10));
  view.stdin.write("\r");
  await new Promise((resolve) => setTimeout(resolve, 10));
  view.stdin.write("s");
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(save).toHaveBeenCalledWith({version: 1, profiles: {builder: {entries: []}}});
});

test("config asks whether to save, discard, or continue when dirty", async () => {
  const cancel = vi.fn();
  const view = render(<ConfigApp initial={{version: 1, profiles: {x: {entries: []}}}} entries={[]} onSave={() => undefined} onCancel={cancel} />);
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
  const view = render(<ConfigApp initial={{version: 1, profiles: {x: {entries: []}}}} entries={[
    {id: "bad", registryPath: "/r/bad", realPath: "/r/bad", status: "invalid", diagnostics: [{severity: "error", code: "invalid", message: "bad"}]},
  ]} onSave={save} onCancel={() => undefined} />);
  view.stdin.write("\r");
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(view.lastFrame()).toContain("invalid: bad");
  view.stdin.write(" ");
  await new Promise((resolve) => setTimeout(resolve, 10));
  view.stdin.write("s");
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(save).toHaveBeenCalledWith({version: 1, profiles: {x: {entries: []}}});
});

test("config retains a missing reference and lets the user remove it", async () => {
  const save = vi.fn();
  const view = render(<ConfigApp initial={{version: 1, profiles: {x: {entries: ["gone"]}}}} entries={[]} onSave={save} onCancel={() => undefined} />);
  view.stdin.write("\r");
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(view.lastFrame()).toContain("gone missing");
  view.stdin.write(" ");
  await new Promise((resolve) => setTimeout(resolve, 10));
  view.stdin.write("s");
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(save).toHaveBeenCalledWith({version: 1, profiles: {x: {entries: []}}});
});
