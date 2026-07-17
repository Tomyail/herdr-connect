import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { NativeModules, PermissionsAndroid, Platform } from "react-native";
import * as ServiceDiscovery from "@inthepocket/react-native-service-discovery";
import type { Service } from "@inthepocket/react-native-service-discovery";

import type { DemoAgent, DemoAgentsResponse } from "./demo-contract";
import { devServerFallbackService, fetchDemoAgents, focusDemoAgent, serviceKey } from "./network";

const SERVICE_TYPE = "herdr-connect";
const DISCOVERY_WAIT_MS = 6_000;

async function ensureAndroidLocalNetworkPermission(): Promise<void> {
  if (Platform.OS !== "android" || Number(Platform.Version) < 33) return;
  const permission = PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES;
  const result = await PermissionsAndroid.request(permission, {
    title: "允许发现附近的 Herdr daemon",
    message: "Herdr Connect 需要访问附近设备，以发现并连接同一局域网中的 Mac。",
    buttonPositive: "允许",
    buttonNegative: "暂不允许",
  });
  if (result !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error("未获得附近设备权限");
  }
}

export type ConnectionState =
  | { phase: "discovering" }
  | { phase: "not_found" }
  | { phase: "failed"; message: string }
  | { phase: "connected"; service: Service; data: DemoAgentsResponse };

export type FocusPhase = "switching" | "switched" | "failed";

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "无法连接 daemon";
}

interface ConnectionValue {
  state: ConnectionState;
  focusResult?: { sourceID: string; phase: FocusPhase };
  refresh: () => Promise<void>;
  switchAgent: (service: Service, agent: DemoAgent) => Promise<void>;
}

const ConnectionContext = createContext<ConnectionValue | undefined>(undefined);

export function useConnection(): ConnectionValue {
  const value = useContext(ConnectionContext);
  if (!value) throw new Error("useConnection 必须在 ConnectionProvider 内使用");
  return value;
}

export function ConnectionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConnectionState>({ phase: "discovering" });
  const servicesRef = useRef(new Map<string, Service>());
  const selectedKeyRef = useRef<string | undefined>(undefined);
  const requestRef = useRef<AbortController | undefined>(undefined);
  const discoveryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mountedRef = useRef(true);
  const [focusResult, setFocusResult] = useState<{ sourceID: string; phase: FocusPhase }>();

  const switchAgent = useCallback(async (service: Service, agent: DemoAgent) => {
    setFocusResult({ sourceID: agent.source_id, phase: "switching" });
    try {
      await focusDemoAgent(service, agent.source_id);
      setFocusResult({ sourceID: agent.source_id, phase: "switched" });
    } catch {
      setFocusResult({ sourceID: agent.source_id, phase: "failed" });
    }
  }, []);

  const clearDiscoveryTimer = useCallback(() => {
    if (discoveryTimerRef.current) clearTimeout(discoveryTimerRef.current);
    discoveryTimerRef.current = undefined;
  }, []);

  const connect = useCallback(
    async (service: Service) => {
      const key = serviceKey(service);
      selectedKeyRef.current = key;
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      clearDiscoveryTimer();

      try {
        const data = await fetchDemoAgents(service, controller.signal);
        if (mountedRef.current && selectedKeyRef.current === key && !controller.signal.aborted) {
          setState({ phase: "connected", service, data });
        }
      } catch (error) {
        if (mountedRef.current && selectedKeyRef.current === key && !controller.signal.aborted) {
          setState({ phase: "failed", message: errorMessage(error) });
        }
      }
    },
    [clearDiscoveryTimer],
  );

  const beginNotFoundCountdown = useCallback(() => {
    clearDiscoveryTimer();
    discoveryTimerRef.current = setTimeout(() => {
      if (mountedRef.current && servicesRef.current.size === 0) {
        const sourceCode = NativeModules.SourceCode as
          | { scriptURL?: string; getConstants?: () => { scriptURL?: string } }
          | undefined;
        const scriptURL = sourceCode?.getConstants?.().scriptURL ?? sourceCode?.scriptURL;
        const fallback = devServerFallbackService(scriptURL);
        if (fallback) {
          void connect(fallback);
        } else {
          setState({ phase: "not_found" });
        }
      }
    }, DISCOVERY_WAIT_MS);
  }, [clearDiscoveryTimer, connect]);

  const refresh = useCallback(async () => {
    requestRef.current?.abort();
    selectedKeyRef.current = undefined;
    servicesRef.current.clear();
    setState({ phase: "discovering" });
    beginNotFoundCountdown();

    try {
      await ServiceDiscovery.stopSearch(SERVICE_TYPE);
      await ServiceDiscovery.startSearch(SERVICE_TYPE);
    } catch (error) {
      if (mountedRef.current) setState({ phase: "failed", message: errorMessage(error) });
    }
  }, [beginNotFoundCountdown]);

  useEffect(() => {
    mountedRef.current = true;
    const foundListener = ServiceDiscovery.addEventListener("serviceFound", (service) => {
      const key = serviceKey(service);
      servicesRef.current.set(key, service);
      if (!selectedKeyRef.current) void connect(service);
    });
    const lostListener = ServiceDiscovery.addEventListener("serviceLost", (service) => {
      const key = serviceKey(service);
      servicesRef.current.delete(key);
      if (selectedKeyRef.current !== key) return;

      requestRef.current?.abort();
      selectedKeyRef.current = undefined;
      const nextService = servicesRef.current.values().next().value as Service | undefined;
      if (nextService) {
        void connect(nextService);
      } else {
        setState({ phase: "not_found" });
      }
    });

    beginNotFoundCountdown();
    void ensureAndroidLocalNetworkPermission()
      .then(() => ServiceDiscovery.startSearch(SERVICE_TYPE))
      .catch((error: unknown) => {
        if (mountedRef.current) setState({ phase: "failed", message: errorMessage(error) });
      });

    return () => {
      mountedRef.current = false;
      clearDiscoveryTimer();
      requestRef.current?.abort();
      foundListener.remove();
      lostListener.remove();
      void ServiceDiscovery.stopSearch(SERVICE_TYPE);
    };
  }, [beginNotFoundCountdown, clearDiscoveryTimer, connect]);

  const value = useMemo(
    () => ({ state, focusResult, refresh, switchAgent }),
    [state, focusResult, refresh, switchAgent],
  );

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}
