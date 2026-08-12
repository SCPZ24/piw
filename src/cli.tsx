#!/usr/bin/env node
import {parsePiwArgs, CliUsageError} from "./cli/args.js";
import {configure, launch, printList, runDoctor, selectProfile, snapshot, updateEntries} from "./app.js";
import packageJson from "../package.json" with {type: "json"};

const HELP = `piw - lightweight Pi profile launcher

Usage:
  piw [-- <pi-args...>]
  piw <profile> [-- <pi-args...>]
  piw config | update | list | doctor
  piw --help | --version`;

async function main(): Promise<number> {
  const command = parsePiwArgs(process.argv.slice(2));
  if (command.kind === "help") { console.log(HELP); return 0; }
  if (command.kind === "version") { console.log(packageJson.version); return 0; }
  if (command.kind === "select") return selectProfile(command.passthrough);
  if (command.kind === "launch") return launch(command.profile, command.passthrough);
  if (command.kind === "config") return configure();
  if (command.kind === "doctor") return await runDoctor() ? 1 : 0;
  const current = await snapshot(process.env.HOME, command.kind !== "list");
  if (command.kind === "list") { printList(current); return 0; }
  return await updateEntries(current) ? 1 : 0;
}

main().then((code) => { process.exitCode = code; }).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = error instanceof CliUsageError ? 2 : 1;
});
