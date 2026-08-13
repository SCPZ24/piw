import {describe, expect, test} from "vitest";
import {CliUsageError, parsePiwArgs} from "../src/cli/args.js";

describe("parsePiwArgs", () => {
  test.each([
    [[], {kind: "select", passthrough: []}],
    [["config"], {kind: "config"}],
    [["add", "foo"], {kind: "add", packageName: "foo"}],
    [["add", "@scope/foo"], {kind: "add", packageName: "@scope/foo"}],
    [["builder"], {kind: "launch", profile: "builder", passthrough: []}],
    [["builder", "--", "--model", "openai/gpt-5", "hello"], {kind: "launch", profile: "builder", passthrough: ["--model", "openai/gpt-5", "hello"]}],
    [["--", "--offline"], {kind: "select", passthrough: ["--offline"]}],
  ])("parses %j", (argv, expected) => {
    expect(parsePiwArgs(argv as string[])).toEqual(expected);
  });

  test.each([
    "-e", "--extension", "--extension=x", "--skill", "--skill=x", "--prompt-template", "--prompt-template=x", "--theme", "--theme=x",
    "--no-extensions", "-ne", "--no-skills", "-ns", "--no-prompt-templates", "-np", "--no-themes",
  ])(
    "rejects managed pass-through option %s",
    (option) => expect(() => parsePiwArgs(["builder", "--", option])).toThrow(CliUsageError),
  );

  test("requires an explicit separator before Pi arguments", () => {
    expect(() => parsePiwArgs(["builder", "--model", "x"])).toThrow(CliUsageError);
  });

  test.each([
    ["missing package", ["add"]],
    ["extra package", ["add", "foo", "bar"]],
    ["Pi passthrough", ["add", "foo", "--", "--model", "x"]],
    ["source prefix", ["add", "npm:foo"]],
    ["relative path", ["add", "../foo"]],
    ["absolute path", ["add", "/foo"]],
    ["unscoped slash", ["add", "foo/bar"]],
    ["missing scoped name", ["add", "@scope"]],
    ["empty scope", ["add", "@"]],
  ])("rejects add invocation with %s", (_label, argv) => {
    expect(() => parsePiwArgs(argv)).toThrow(CliUsageError);
  });
});
