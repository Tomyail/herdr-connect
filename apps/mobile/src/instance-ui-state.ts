/**
 * 每实例界面状态独立记忆(Seam B,纯逻辑)。
 *
 * issue #54:切换活动实例瞬间完成、界面原样恢复。App 的可记忆界面状态是
 * AppShell 提升的"当前目标页(Agents/Settings)+ 选中的 Agent"——窄屏由
 * React Navigation 树呈现(镜像回提升状态),宽屏由 SplitLayout 直接消费。
 * 本模块把这份提升状态组织为 reducer:
 *
 * - selection:用户操作(切 tab、进/出 Agent 详情)更新当前显示状态;
 * - focusSwitch:切换活动实例时,先把当前状态存入旧实例的记忆槽,再恢复
 *   新实例槽(无记忆则回默认页)。切换不触碰连接——会话并行保活,这里
 *   只决定"焦点看向哪份已就绪的数据";
 * - prune:实例解绑后清理其记忆槽,防止随时间泄漏。
 *
 * 记忆是内存态(app 会话内),与 Keychain 凭据不同:实例消失即丢弃。
 */

import type { SidebarDestination } from "./navigation";

/** 单个实例的界面状态快照(所在页面 + 展开的 Agent)。 */
export interface InstanceUiSnapshot {
  readonly destination: SidebarDestination;
  readonly selectedAgentId: string | undefined;
}

/** fingerprint → 界面状态快照。 */
export type InstanceUiStateMap = Record<string, InstanceUiSnapshot>;

/** 无记忆实例的默认快照:Agents 列表、无展开详情。 */
export const DEFAULT_INSTANCE_UI_SNAPSHOT: InstanceUiSnapshot = {
  destination: "Agents",
  selectedAgentId: undefined,
};

/** reducer 全量状态:记忆槽 + 当前(焦点实例的)显示状态。 */
export interface InstanceUiState {
  readonly map: InstanceUiStateMap;
  readonly destination: SidebarDestination;
  readonly selectedAgentId: string | undefined;
}

export const initialInstanceUiState: InstanceUiState = {
  map: {},
  destination: DEFAULT_INSTANCE_UI_SNAPSHOT.destination,
  selectedAgentId: DEFAULT_INSTANCE_UI_SNAPSHOT.selectedAgentId,
};

export type InstanceUiAction =
  | { readonly type: "destination"; readonly destination: SidebarDestination }
  | { readonly type: "selectedAgent"; readonly selectedAgentId: string | undefined }
  /** 焦点切换:previousFingerprint 为 null(冷启动/全部解绑)时只做恢复。 */
  | {
      readonly type: "focusSwitch";
      readonly previousFingerprint: string | null;
      readonly nextFingerprint: string | null;
    }
  /** 实例集合收缩:清理不在 liveFingerprints 中的记忆槽。 */
  | { readonly type: "prune"; readonly liveFingerprints: readonly string[] };

/** 读取某实例的记忆快照;无记忆返回默认值(不写入)。 */
export function resolveInstanceUiState(
  map: InstanceUiStateMap,
  fingerprint: string | null,
): InstanceUiSnapshot {
  if (!fingerprint) return DEFAULT_INSTANCE_UI_SNAPSHOT;
  return map[fingerprint] ?? DEFAULT_INSTANCE_UI_SNAPSHOT;
}

export function instanceUiReducer(
  state: InstanceUiState,
  action: InstanceUiAction,
): InstanceUiState {
  switch (action.type) {
    case "destination":
      return { ...state, destination: action.destination };
    case "selectedAgent":
      return { ...state, selectedAgentId: action.selectedAgentId };
    case "focusSwitch": {
      const { previousFingerprint, nextFingerprint } = action;
      let map = state.map;
      // 记忆旧焦点的当前界面(惰性写入:只在切走时落槽)。
      if (previousFingerprint) {
        map = {
          ...map,
          [previousFingerprint]: {
            destination: state.destination,
            selectedAgentId: state.selectedAgentId,
          },
        };
      }
      // 恢复新焦点的记忆(无记忆 → 默认页)。
      const snapshot = resolveInstanceUiState(map, nextFingerprint);
      return { map, destination: snapshot.destination, selectedAgentId: snapshot.selectedAgentId };
    }
    case "prune": {
      const live = new Set(action.liveFingerprints);
      let map = state.map;
      for (const fingerprint of Object.keys(map)) {
        if (live.has(fingerprint)) continue;
        if (map === state.map) map = { ...map };
        delete map[fingerprint];
      }
      return map === state.map ? state : { ...state, map };
    }
  }
}
