import React, {useState} from "react";
import {Box, Text, useInput} from "ink";
import type {Diagnostic} from "../domain.js";

export interface SelectorProfile {name: string; available: boolean; diagnostics: Diagnostic[]}

export function Selector({profiles, onSelect, onCancel}: {profiles: SelectorProfile[]; onSelect: (name: string) => void; onCancel: () => void}) {
  const first = Math.max(0, profiles.findIndex((profile) => profile.available));
  const [index, setIndex] = useState(first);
  useInput((input, key) => {
    if (key.upArrow) setIndex((value) => (value - 1 + profiles.length) % profiles.length);
    else if (key.downArrow) setIndex((value) => (value + 1) % profiles.length);
    else if (key.return && profiles[index]?.available) onSelect(profiles[index]!.name);
    else if (key.escape || input === "q") onCancel();
  });
  const current = profiles[index];
  return <Box flexDirection="column">
    <Text bold>Select Pi Profile</Text>
    <Text> </Text>
    {profiles.map((profile, row) => <Text key={profile.name} dimColor={!profile.available} {...(row === index ? {color: "cyan"} : {})}>{row === index ? "> " : "  "}{profile.name}  {profile.available ? "ready" : "unavailable"}</Text>)}
    {current && !current.available ? <Box marginTop={1} flexDirection="column">{current.diagnostics.map((item) => <Text key={`${item.code}:${item.message}`} color="red">{item.message}</Text>)}</Box> : null}
    <Text dimColor>↑/↓ move  Enter launch  q/Esc cancel</Text>
  </Box>;
}
