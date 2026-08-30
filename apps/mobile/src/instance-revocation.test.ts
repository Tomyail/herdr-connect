import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyRevocationFailure,
  planForgetInstance,
  planReplacementRevocation,
  replacementRevocationNotice,
  type RevocationClassification,
} from "./instance-revocation";

// ---------------------------------------------------------------------------
// classifyRevocationFailure —— 吊销失败(NetworkError code)的语义分类
// ---------------------------------------------------------------------------

test("classifyRevocationFailure maps 401 (unauthorized/revoked) to already_invalid", () => {
  // 本地持有 token 而服务端不认:CLI 已吊销/数据库重置,目标态已达成。
  assert.equal(classifyRevocationFailure("unauthorized"), "already_invalid");
  assert.equal(classifyRevocationFailure("revoked"), "already_invalid");
});

test("classifyRevocationFailure maps transport failures to unreachable", () => {
  assert.equal(classifyRevocationFailure("revoke_tls"), "unreachable");
  assert.equal(classifyRevocationFailure("revoke_timeout"), "unreachable");
  assert.equal(classifyRevocationFailure("no_address"), "unreachable");
});

test("classifyRevocationFailure maps other HTTP/protocol errors to failed", () => {
  assert.equal(classifyRevocationFailure("revoke_http"), "failed");
  assert.equal(classifyRevocationFailure("app_outdated"), "failed");
});

// ---------------------------------------------------------------------------
// planForgetInstance —— 忘记实例的本地/远端编排决策
// ---------------------------------------------------------------------------

test("planForgetInstance removes local credentials silently once the server side is clean", () => {
  assert.deepEqual(planForgetInstance("revoked"), { removeLocal: true, prompt: "none" });
  // 401 同样是"服务端无此 token"目标态:静默继续本地删除。
  assert.deepEqual(planForgetInstance("already_invalid"), { removeLocal: true, prompt: "none" });
});

test("planForgetInstance keeps local credentials and prompts when revocation fails", () => {
  // 不静默:daemon 不可达/其他失败 → 用户裁决(仅本地删除/重试/取消)。
  assert.deepEqual(planForgetInstance("unreachable"), {
    removeLocal: false,
    prompt: "revocation_unavailable",
  });
  assert.deepEqual(planForgetInstance("failed"), {
    removeLocal: false,
    prompt: "revocation_failed",
  });
});

test("planForgetInstance is total over every classification", () => {
  const all: readonly RevocationClassification[] = ["revoked", "already_invalid", "unreachable", "failed"];
  for (const classification of all) {
    const plan = planForgetInstance(classification);
    assert.equal(plan.removeLocal, plan.prompt === "none");
  }
});

// ---------------------------------------------------------------------------
// planReplacementRevocation —— 重复配对替换的旧 token 处置
// ---------------------------------------------------------------------------

test("planReplacementRevocation skips when there is no previous credential (first pairing)", () => {
  assert.equal(planReplacementRevocation(undefined, "tok-new"), "skip");
});

test("planReplacementRevocation revokes the stale token when it differs from the fresh one", () => {
  assert.equal(
    planReplacementRevocation({ token: "tok-old" }, "tok-new"),
    "revoke_after_store",
  );
});

test("planReplacementRevocation skips when daemon handed back the same token", () => {
  // 防御性:吊销"旧"token 等于吊销自己,新凭据会立刻失效。
  assert.equal(planReplacementRevocation({ token: "tok-same" }, "tok-same"), "skip");
});

// ---------------------------------------------------------------------------
// replacementRevocationNotice —— 替换语义下失败是否提示
// ---------------------------------------------------------------------------

test("replacementRevocationNotice stays quiet when the goal state holds", () => {
  assert.equal(replacementRevocationNotice("revoked"), false);
  assert.equal(replacementRevocationNotice("already_invalid"), false);
});

test("replacementRevocationNotice warns on unreachable/failed without blocking pairing", () => {
  assert.equal(replacementRevocationNotice("unreachable"), true);
  assert.equal(replacementRevocationNotice("failed"), true);
});
