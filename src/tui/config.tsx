import React, {useState} from "react";
import {Box, Text, useInput} from "ink";
import {naturalCompare, type Entry, type PiwStateV1, validateProfileName} from "../domain.js";

export function ConfigApp({initial, entries, onSave, onCancel}: {initial: PiwStateV1; entries: Entry[]; onSave: (state: PiwStateV1) => void | Promise<void>; onCancel: () => void}) {
  const [state, setState] = useState(() => structuredClone(initial));
  const names = Object.keys(state.profiles).sort(naturalCompare);
  const [profileIndex, setProfileIndex] = useState(0);
  const [detail, setDetail] = useState(false);
  const [entryIndex, setEntryIndex] = useState(0);
  const [dialog, setDialog] = useState<"create" | "rename" | "delete" | "unsaved" | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [saveError, setSaveError] = useState<string>();
  const profile = names[profileIndex];
  const visible = profile ? [...new Set([...entries.map((entry) => entry.id), ...state.profiles[profile]!.entries])].sort(naturalCompare) : [];
  useInput((input, key) => {
    if (dialog === "unsaved") {
      if (input === "s") void Promise.resolve(onSave(state)).catch((error: unknown) => { setSaveError(error instanceof Error ? error.message : String(error)); setDialog(null); });
      else if (input === "d") onCancel();
      else if (input === "c" || key.escape) setDialog(null);
      return;
    }
    if (dialog === "delete") {
      if (input.toLowerCase() === "y" && profile) { const profiles = {...state.profiles}; delete profiles[profile]; setState({...state, profiles}); setProfileIndex(0); setDialog(null); }
      else if (input.toLowerCase() === "n" || key.escape) setDialog(null);
      return;
    }
    if (dialog === "create" || dialog === "rename") {
      if (key.escape) { setDialog(null); setInputValue(""); return; }
      if (key.backspace || key.delete) { setInputValue((value) => value.slice(0, -1)); return; }
      if (key.return) {
        const validity = validateProfileName(inputValue);
        if (!validity.valid || (state.profiles[inputValue] && inputValue !== profile)) return;
        if (dialog === "create") setState({...state, profiles: {...state.profiles, [inputValue]: {entries: []}}});
        else if (profile) { const profiles = {...state.profiles}; const value = profiles[profile]!; delete profiles[profile]; profiles[inputValue] = value; setState({...state, profiles}); }
        setDialog(null); setInputValue(""); return;
      }
      if (input && !key.ctrl && !key.meta) setInputValue((value) => value + input);
      return;
    }
    if (key.escape || input === "q") { if (detail) setDetail(false); else if (JSON.stringify(state) !== JSON.stringify(initial)) setDialog("unsaved"); else onCancel(); return; }
    if (input === "s") { setSaveError(undefined); void Promise.resolve(onSave(state)).catch((error: unknown) => setSaveError(error instanceof Error ? error.message : String(error))); return; }
    if (!detail) {
      if (input === "n") { setDialog("create"); return; }
      if (input === "r" && profile) { setInputValue(profile); setDialog("rename"); return; }
      if (input === "d" && profile) { setDialog("delete"); return; }
      if (key.upArrow) setProfileIndex((value) => Math.max(0, value - 1));
      if (key.downArrow) setProfileIndex((value) => Math.min(names.length - 1, value + 1));
      if (key.return && profile) setDetail(true);
    } else {
      if (key.upArrow) setEntryIndex((value) => Math.max(0, value - 1));
      if (key.downArrow) setEntryIndex((value) => Math.min(visible.length - 1, value + 1));
      if (input === " " && profile) {
        const id = visible[entryIndex]!; const discovered = entries.find((entry) => entry.id === id); const current = state.profiles[profile]!.entries;
        if (current.includes(id) || discovered?.status === "valid") setState({...state, profiles: {...state.profiles, [profile]: {entries: current.includes(id) ? current.filter((value) => value !== id) : [...current, id].sort(naturalCompare)}}});
      }
    }
  });
  if (dialog === "unsaved") return <Box flexDirection="column"><Text bold>Unsaved changes</Text><Text>Save, discard, or continue editing?</Text><Text dimColor>s save  d discard  c/Esc continue</Text></Box>;
  if (dialog === "create" || dialog === "rename") return <Box flexDirection="column"><Text bold>{dialog === "create" ? "Create profile" : `Rename ${profile}`}</Text><Text>Name: {inputValue}_</Text><Text dimColor>Enter confirm  Esc cancel</Text></Box>;
  if (dialog === "delete") return <Box flexDirection="column"><Text bold color="red">Delete profile "{profile}"?</Text><Text>Press y to confirm, n/Esc to cancel.</Text></Box>;
  if (!profile) return <Box flexDirection="column"><Text bold>Configure Pi Profiles</Text><Text>No profiles. Press n to create one, or q to exit.</Text></Box>;
  return <Box flexDirection="column"><Text bold>{detail ? profile : "Configure Pi Profiles"}</Text>{saveError ? <Text color="red">{saveError}</Text> : <Text> </Text>}{detail ? visible.map((id, index) => { const selected = state.profiles[profile]!.entries.includes(id); const found = entries.find((entry) => entry.id === id); const color = index === entryIndex ? "cyan" : found?.status === "invalid" ? "red" : undefined; return <Text key={id} {...(color ? {color} : {})}>{index === entryIndex ? "> " : "  "}[{selected ? (found?.status === "valid" ? "x" : "!") : " "}] {id} {found?.kind ?? "missing"}</Text>; }) : names.map((name, index) => <Text key={name} {...(index === profileIndex ? {color: "cyan"} : {})}>{index === profileIndex ? "> " : "  "}{name}</Text>)}<Text dimColor>{detail ? "Space toggle  s save  Esc back" : "Enter edit  s save  q/Esc exit"}</Text></Box>;
}
