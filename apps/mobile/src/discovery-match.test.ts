import assert from "node:assert/strict";
import test from "node:test";

import type { DiscoveredService } from "./discovery";
import { NetworkError } from "./i18n/errors";
import {
  classifyProbeFailure,
  hasUnknownCandidate,
  isPinnedServiceKey,
  orderCandidates,
  pinnedService,
  selectCandidates,
  serviceKey,
} from "./discovery-match";

const service = (name: string, overrides: Partial<DiscoveredService> = {}): DiscoveredService => ({
  name,
  type: "_herdr-connect._tcp.",
  domain: "local.",
  hostName: `${name.toLowerCase()}.local.`,
  addresses: ["192.168.1.10"],
  port: 9808,
  txt: {},
  ...overrides,
});

// ---------------------------------------------------------------------------
// selectCandidates —— fingerprint 匹配的候选选择
// ---------------------------------------------------------------------------

test("selectCandidates returns all services in discovery order when nothing is verified yet", () => {
  const services = [service("Herdr on A"), service("Herdr on B"), service("Herdr on C")];
  assert.deepEqual(selectCandidates(services, "fp-home", {}), services);
});

test("selectCandidates puts the service verified for the active instance first", () => {
  const homeA = service("Herdr on A");
  const homeB = service("Herdr on B");
  const office = service("Herdr on C");
  const associations = { [serviceKey(office)]: "fp-office" };
  // homeB 已验证为活动实例（如 daemon 重启后换了服务名），优先于未验证的 homeA。
  const withAssociation = { ...associations, [serviceKey(homeB)]: "fp-home" };
  const candidates = selectCandidates([homeA, office, homeB], "fp-home", withAssociation);
  assert.deepEqual(
    candidates.map((s) => s.name),
    ["Herdr on B", "Herdr on A"],
  );
});

test("selectCandidates excludes services verified as another instance's daemon", () => {
  const home = service("Herdr on A");
  const office = service("Herdr on B");
  const associations = { [serviceKey(office)]: "fp-office" };
  assert.deepEqual(selectCandidates([home, office], "fp-home", associations), [home]);
});

test("selectCandidates returns [] when every discovered service belongs to other instances", () => {
  const a = service("Herdr on A");
  const b = service("Herdr on B");
  const associations = {
    [serviceKey(a)]: "fp-office",
    [serviceKey(b)]: "fp-office",
  };
  assert.deepEqual(selectCandidates([a, b], "fp-home", associations), []);
});

test("selectCandidates returns [] for an empty discovery set", () => {
  assert.deepEqual(selectCandidates([], "fp-home", { any: "fp-home" }), []);
});

test("serviceKey is stable across name/type/domain", () => {
  assert.equal(serviceKey(service("X")), "X|_herdr-connect._tcp.|local.");
  assert.notEqual(serviceKey(service("X")), serviceKey(service("Y")));
});

// ---------------------------------------------------------------------------
// classifyProbeFailure —— 探测失败分类
// ---------------------------------------------------------------------------

test("classifyProbeFailure maps fingerprint_mismatch to wrong_daemon", () => {
  assert.equal(classifyProbeFailure(new NetworkError("fingerprint_mismatch")), "wrong_daemon");
});

test("classifyProbeFailure maps transport failures to unreachable", () => {
  assert.equal(classifyProbeFailure(new NetworkError("daemon_timeout")), "unreachable");
  assert.equal(classifyProbeFailure(new NetworkError("daemon_tls")), "unreachable");
  assert.equal(classifyProbeFailure(new NetworkError("no_address")), "unreachable");
});

test("classifyProbeFailure maps auth failures to terminal (TLS pin passed — daemon matched)", () => {
  assert.equal(classifyProbeFailure(new NetworkError("unauthorized")), "terminal");
  assert.equal(classifyProbeFailure(new NetworkError("revoked")), "terminal");
});

test("classifyProbeFailure maps version and protocol errors to terminal", () => {
  assert.equal(classifyProbeFailure(new NetworkError("daemon_outdated")), "terminal");
  assert.equal(classifyProbeFailure(new NetworkError("app_outdated")), "terminal");
  assert.equal(classifyProbeFailure(new NetworkError("daemon_http", 500)), "terminal");
  assert.equal(classifyProbeFailure(new NetworkError("response_invalid")), "terminal");
});

test("classifyProbeFailure maps unknown errors to terminal", () => {
  assert.equal(classifyProbeFailure(new Error("boom")), "terminal");
  assert.equal(classifyProbeFailure(undefined), "terminal");
});

// ---------------------------------------------------------------------------
// orderCandidates —— `pair --host` 固定地址优先
// ---------------------------------------------------------------------------

test("orderCandidates equals selectCandidates when there is no pinned host", () => {
  const services = [service("Herdr on A"), service("Herdr on B")];
  assert.deepEqual(orderCandidates(services, "fp-home", {}, undefined), selectCandidates(services, "fp-home", {}));
});

test("orderCandidates puts the pinned host first and keeps mDNS candidates as fallback", () => {
  const lan = service("Herdr on A", { addresses: ["192.0.2.10"] });
  const candidates = orderCandidates([lan], "fp-home", {}, { host: "198.51.100.20", port: 9808 });
  assert.deepEqual(
    candidates.map((s) => s.addresses[0]),
    ["198.51.100.20", "192.0.2.10"],
  );
});

test("orderCandidates yields the pinned host even when mDNS discovered nothing", () => {
  const candidates = orderCandidates([], "fp-home", {}, { host: "198.51.100.20", port: 9808 });
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0]?.addresses, ["198.51.100.20"]);
  assert.equal(candidates[0]?.port, 9808);
});

test("pinnedService is stable per host and distinct from discovered services", () => {
  const pinned = { host: "198.51.100.20", port: 9808 };
  assert.equal(serviceKey(pinnedService(pinned)), serviceKey(pinnedService(pinned)));
  assert.notEqual(serviceKey(pinnedService(pinned)), serviceKey(service("Herdr on A")));
});

// ---------------------------------------------------------------------------
// isPinnedServiceKey / hasUnknownCandidate —— 固定地址探测在途/已连时的守卫
// ---------------------------------------------------------------------------

test("isPinnedServiceKey is true only for the key of the pinned service", () => {
  const pinned = { host: "198.51.100.20", port: 9808 };
  assert.equal(isPinnedServiceKey(serviceKey(pinnedService(pinned)), pinned), true);
  assert.equal(isPinnedServiceKey(serviceKey(service("Herdr on A")), pinned), false);
});

test("isPinnedServiceKey is false when there is no pinned host", () => {
  const pinned = { host: "198.51.100.20", port: 9808 };
  assert.equal(isPinnedServiceKey(serviceKey(pinnedService(pinned)), undefined), false);
});

test("hasUnknownCandidate is false when every candidate key is already known", () => {
  const pinned = { host: "198.51.100.20", port: 9808 };
  const known = new Set([serviceKey(pinnedService(pinned))]);
  assert.equal(hasUnknownCandidate([pinnedService(pinned)], known), false);
});

test("hasUnknownCandidate is true when a candidate's key is not in the known set", () => {
  const pinned = { host: "198.51.100.20", port: 9808 };
  const lan = service("Herdr on A");
  const known = new Set([serviceKey(pinnedService(pinned))]);
  // A fresh mDNS snapshot arriving while a pinned-only probe is in flight
  // must be treated as new information so the session can fall back to it
  // immediately instead of waiting out the pinned attempt's own timeout.
  assert.equal(hasUnknownCandidate(orderCandidates([lan], "fp-home", {}, pinned), known), true);
});

test("hasUnknownCandidate is true for any candidate when nothing was known yet", () => {
  assert.equal(hasUnknownCandidate([service("Herdr on A")], undefined), true);
});

test("hasUnknownCandidate is false for an empty candidate list", () => {
  assert.equal(hasUnknownCandidate([], undefined), false);
});
