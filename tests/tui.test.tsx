import React from "react";
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
