import type { DemoAgent } from "./demo-contract";

export type RootStackParamList = {
  Tabs: undefined;
  AgentDetail: { agent: DemoAgent };
  Language: undefined;
  Appearance: undefined;
  Pairing: undefined;
};

export type TabParamList = {
  Agents: undefined;
  Settings: undefined;
};
