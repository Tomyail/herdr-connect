import type { Agent } from "./agent-contract";
import type { IoniconName } from "./icons";

export type RootStackParamList = {
  Tabs: undefined;
  AgentDetail: { agent: Agent };
  Language: undefined;
  Appearance: undefined;
  VoiceLanguage: undefined;
  SilenceThreshold: undefined;
  Pairing: undefined;
};

export type TabParamList = {
  Agents: undefined;
  Settings: undefined;
};

/** The two top-level destinations shared by the bottom tab bar (narrow) and the
 *  split-view sidebar (wide). Icons/labels are defined once so both surfaces
 *  stay in sync. */
export type SidebarDestination = keyof TabParamList;

export const sidebarIcons: Record<SidebarDestination, { active: IoniconName; inactive: IoniconName }> = {
  Agents: { active: "people", inactive: "people-outline" },
  Settings: { active: "settings", inactive: "settings-outline" },
};
