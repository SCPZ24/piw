import {validateIdentifier} from "../domain.js";

export class CliUsageError extends Error {}

export type ParsedCommand =
  | {kind: "select"; passthrough: string[]}
  | {kind: "launch"; profile: string; passthrough: string[]}
  | {kind: "config" | "update" | "list" | "doctor" | "help" | "version"};

const RESOURCE_OPTIONS = new Set([
  "-e", "--extension", "--skill", "--prompt-template", "--theme",
  "--no-extensions", "-ne", "--no-skills", "-ns",
  "--no-prompt-templates", "-np", "--no-themes",
]);

function validatePassthrough(args: string[]): void {
  for (const argument of args) {
    const name = argument.includes("=") ? argument.slice(0, argument.indexOf("=")) : argument;
    if (RESOURCE_OPTIONS.has(name)) throw new CliUsageError(`Pi resource option is managed by PIW: ${name}`);
  }
}

export function parsePiwArgs(argv: string[]): ParsedCommand {
  const separator = argv.indexOf("--");
  const own = separator === -1 ? argv : argv.slice(0, separator);
  const passthrough = separator === -1 ? [] : argv.slice(separator + 1);
  validatePassthrough(passthrough);

  if (own.length === 0) return {kind: "select", passthrough};
  if (own.length !== 1) throw new CliUsageError("Expected one PIW command or profile name before --");

  const value = own[0]!;
  if (value === "--help" || value === "-h") return {kind: "help"};
  if (value === "--version" || value === "-v") return {kind: "version"};
  if (["config", "update", "list", "doctor"].includes(value)) {
    if (separator !== -1) throw new CliUsageError(`${value} does not accept Pi arguments`);
    return {kind: value as "config" | "update" | "list" | "doctor"};
  }
  if (value.startsWith("-")) throw new CliUsageError(`Unknown PIW option: ${value}`);
  if (!validateIdentifier(value)) throw new CliUsageError(`Invalid profile name: ${value}`);
  if (separator === -1 && argv.length > 1) throw new CliUsageError("Pi arguments must follow an explicit -- separator");
  return {kind: "launch", profile: value, passthrough};
}
