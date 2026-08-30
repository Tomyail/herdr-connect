import assert from "node:assert/strict";
import test from "node:test";

import type { DiscoveredService } from "./discovery";
import { NetworkError } from "./i18n/errors";
import { classifyProbeFailure, selectCandidates, serviceKey } from "./discovery-match";

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
