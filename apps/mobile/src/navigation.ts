import type { DemoAgent } from "./demo-contract";

export type RootStackParamList = {
  Tabs: undefined;
  AgentDetail: { agent: DemoAgent };
};

export type TabParamList = {
  Agents: undefined;
  Settings: undefined;
};
