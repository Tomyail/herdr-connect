import {
  BonjourFail,
  BonjourScanner,
  type ScanResult,
} from "@dawidzawada/bonjour-zeroconf";

const SERVICE_TYPE = "_herdr-connect._tcp";
const SERVICE_DOMAIN = "local";
const ADDRESS_RESOLVE_TIMEOUT_MS = 5_000;

const scanner = new BonjourScanner({ id: "herdr-connect" });

export interface DiscoveredService {
  name: string;
  type: string;
  domain: string;
  hostName: string;
  addresses: string[];
  port: number;
  txt: Record<string, string>;
}

export interface DiscoveryFailure {
  stage: "search" | "resolve";
  code: number;
}

function toDiscoveredService(result: ScanResult): DiscoveredService | undefined {
  if (result.port == null) return undefined;
  const addresses = [result.ipv4, result.ipv6].filter(
    (address): address is string => Boolean(address),
  );
  if (addresses.length === 0) return undefined;

  return {
    name: result.name,
    type: `${SERVICE_TYPE}.`,
    domain: `${SERVICE_DOMAIN}.`,
    hostName: result.hostname ?? "",
    addresses,
    port: result.port,
    txt: {},
  };
}

export function startDiscoverySearch(): void {
  if (scanner.isScanning) scanner.stop();
  scanner.scan(SERVICE_TYPE, SERVICE_DOMAIN, {
    addressResolveTimeout: ADDRESS_RESOLVE_TIMEOUT_MS,
  });
}

export function stopDiscoverySearch(): void {
  scanner.stop();
}

export function listenForDiscoveredServices(
  listener: (services: DiscoveredService[]) => void,
): { remove: () => void } {
  return scanner.listenForScanResults((results) => {
    listener(results.flatMap((result) => {
      const service = toDiscoveredService(result);
      return service ? [service] : [];
    }));
  });
}

export function listenForDiscoveryFailure(
  listener: (failure: DiscoveryFailure) => void,
): { remove: () => void } {
  return scanner.listenForScanFail((failure) => {
    listener({
      stage: failure === BonjourFail.DISCOVERY_FAILED ? "search" : "resolve",
      code: failure,
    });
  });
}
