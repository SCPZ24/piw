import {describe, expect, test} from "vitest";
import {CliUsageError, parsePiwArgs} from "../src/cli/args.js";

describe("parsePiwArgs", () => {
  test.each([
    [[], {kind: "select", passthrough: []}],
    [["config"], {kind: "config"}],
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
});
