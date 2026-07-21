import type { Agent } from "./agent-contract";

export type RootStackParamList = {
  Tabs: undefined;
  AgentDetail: { agent: Agent };
  Language: undefined;
  Appearance: undefined;
  Pairing: undefined;
};

export type TabParamList = {
  Agents: undefined;
  Settings: undefined;
};
