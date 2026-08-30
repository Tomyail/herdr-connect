/**
 * 设备 token 吊销的编排决策(issue #55,Seam B,纯逻辑)。
 *
 * #52 交付了服务端自吊销端点 `DELETE /v1/device`(Bearer 认证,成功
 * 204,未认证 401)。本模块决定两个调用方如何消费它的结果:
 *
 * - **忘记实例**:吊销结果分类 → 是否继续本地删除、需要哪种用户提示。
 *   关键决策:401 也算"目标态已达成"——本地持有 token 而服务端不认,
 *   说明服务端本就没有该 token 的有效记录(CLI 已吊销/数据库重置),
 *   继续本地删除即可;只有传输失败与其他 HTTP 错误才需要用户裁决
 *   (仅本地删除 / 重试 / 取消),不静默。
 * - **重复配对替换**:对已配对 fingerprint 再次配对拿到新 token 后,
 *   是否需要主动吊销旧 token(服务端设备表不残留僵尸条目)。顺序由
 *   调用方保证:先完成新配对入库,再吊销旧 token。吊销失败不阻断
 *   配对成功,只提示。
 *
 * 网络 I/O(revokeDevice)在 network.ts;副作用编排(何时调用、本地
 * 凭据/别名的增删)在 connection.tsx / PairingScreen。本模块保持无
 * 依赖纯函数(见 instance-revocation.test.ts)。
 */

import type { NetworkErrorCode } from "./i18n/errors";

/**
 * 一次吊销尝试的语义分类:
 *
 * - `revoked`:204——token 已在服务端吊销,目标态达成。
 * - `already_invalid`:401 unauthorized/revoked——服务端本就没有该
 *   token 的有效记录(CLI 已吊销/数据库重置/从未存在)。目标态(服务端
 *   无此 token)已达成。
 * - `unreachable`:传输层失败(daemon 离线/TLS 握手失败/超时)——结果
 *   未知,重试可能有效。
 * - `failed`:其他 HTTP/协议错误(如 5xx、426)。
 */
export type RevocationClassification = "revoked" | "already_invalid" | "unreachable" | "failed";

/**
 * 吊销请求失败(NetworkError code)→ 语义分类。
 *
 * `revoked`/`unauthorized` 是 authPinnedFetch 对 401 body 的既有映射;
 * `revoke_tls`/`revoke_timeout` 覆盖全部传输层失败(PinnedFetchError
 * 的 network_error 在 network.ts 被并入 tls 桶);`no_address` 是没有
 * 可用地址,与不可达同义。其余(4xx/5xx/协议错)归 `failed`。
 */
export function classifyRevocationFailure(code: NetworkErrorCode): RevocationClassification {
  if (code === "revoked" || code === "unauthorized") return "already_invalid";
  if (code === "revoke_tls" || code === "revoke_timeout" || code === "no_address") return "unreachable";
  return "failed";
}

/** 忘记实例:吊销分类 → 本地删除与用户提示决策。 */
export interface ForgetPlan {
  /** 是否继续删除本地凭据(吊销已达成或本就无效 → true)。 */
  readonly removeLocal: boolean;
  /** 需要的用户提示:`none` = 静默完成;其余交给 UI 呈现三选(仅本地删除/重试/取消)。 */
  readonly prompt: "none" | "revocation_unavailable" | "revocation_failed";
}

/**
 * 忘记实例的编排决策:
 *
 * - 吊销成功或服务端本就无效 → 删除本地凭据,静默完成;
 * - daemon 不可达 / 其他失败 → **不**动本地凭据,明确提示,由用户选择
 *   仅本地删除、重试或取消(不静默失败)。
 */
export function planForgetInstance(classification: RevocationClassification): ForgetPlan {
  switch (classification) {
    case "revoked":
    case "already_invalid":
      return { removeLocal: true, prompt: "none" };
    case "unreachable":
      return { removeLocal: false, prompt: "revocation_unavailable" };
    case "failed":
      return { removeLocal: false, prompt: "revocation_failed" };
  }
}

/** 重复配对替换:是否需要吊销旧 token。 */
export type ReplacementRevocationPlan = "revoke_after_store" | "skip";

/**
 * 对已配对 fingerprint 再次配对拿到新 token 后的旧 token 处置:
 *
 * - 无旧凭据(首次配对)→ 跳过;
 * - 旧 token 与新 token 相同(daemon 理论上不会复用 token,防御性)→
 *   跳过,吊销等于吊销自己;
 * - 其余 → `revoke_after_store`:新凭据**入库之后**再吊销旧 token,
 *   避免中间态失去访问权(调用方负责顺序)。
 */
export function planReplacementRevocation(
  previous: { readonly token: string } | undefined,
  newToken: string,
): ReplacementRevocationPlan {
  if (!previous) return "skip";
  return previous.token === newToken ? "skip" : "revoke_after_store";
}

/**
 * 替换语义下吊销失败的提示决策:吊销已达成或服务端本就无效 → 不提示;
 * 不可达/其他失败 → 提示(但不阻断配对成功——新凭据已入库可用)。
 */
export function replacementRevocationNotice(classification: RevocationClassification): boolean {
  return classification === "unreachable" || classification === "failed";
}
