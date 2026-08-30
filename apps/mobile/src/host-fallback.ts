import { PinnedFetchError } from "pinned-fetch/src/PinnedFetch.types";

import { NetworkError, NetworkErrorCode } from "./i18n/errors";

/** 将原始 PinnedFetchError 映射为调用方语义的 NetworkError。 */
export type PinnedFetchClassifier = (error: PinnedFetchError) => NetworkError;

/**
 * 按序尝试多个候选地址，直到某个地址连通（请求返回或抛出应用层错误）。
 *
 * daemon 是多宿主的（Docker 网桥、VPN、互联网共享都会给 QR payload 的
 * hosts 塞进手机不可达的地址），且 host 排序不携带可达性信息，因此
 * "单选第一个 IPv4" 在多宿主环境下必然偶发不可达。这里统一做多地址回退：
 *
 * - 连接层失败（PinnedFetchError，或已被上层映射为连接层错误码的
 *   NetworkError）→ 记录并尝试下一个地址；
 * - 应用层错误（daemon 已经给出 HTTP 业务响应）→ 直接上抛，换地址无意义；
 * - 全部候选耗尽 → 用 classify 映射最后一个连接错误抛出。
 *
 * 回退发生时打一行 warn（生产可见的运维信号），成功不打。
 */
export async function withHostFallback<T>(
  label: string,
  urls: readonly string[],
  request: (url: string) => Promise<T>,
  classify: PinnedFetchClassifier,
  connectionErrorCodes: ReadonlySet<NetworkErrorCode>,
): Promise<T> {
  if (urls.length === 0) throw new NetworkError("no_address");

  let lastPinnedError: PinnedFetchError | undefined;
  let lastConnectionError: NetworkError | undefined;

  for (const url of urls) {
    try {
      return await request(url);
    } catch (error) {
      if (error instanceof PinnedFetchError) {
        lastPinnedError = error;
        logFallback(label, url, error.code);
        continue;
      }
      if (error instanceof NetworkError && connectionErrorCodes.has(error.code)) {
        lastConnectionError = error;
        logFallback(label, url, error.code);
        continue;
      }
      // 应用层错误：该地址已连通 daemon，响应与地址选择无关。
      throw error;
    }
  }

  if (lastPinnedError) throw classify(lastPinnedError);
  if (lastConnectionError) throw lastConnectionError;
  throw new NetworkError("no_address");
}

function logFallback(label: string, url: string, code: string): void {
  console.warn(`[host-fallback] ${label} ${url} 连接失败（${code}），尝试下一候选地址`);
}
