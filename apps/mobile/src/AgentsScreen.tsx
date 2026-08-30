import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useMMKVString } from "react-native-mmkv";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { SafeAreaView } from "react-native-safe-area-context";

import { type Agent } from "./agent-contract";
import { agentStatus } from "./agent-status";
import {
  NO_FILTER,
  STATUS_GROUPS,
  activeFilterChipCount,
  enumerateWorkspaceOptions,
  filterAgents,
  isFilterActive,
  pruneWorkspaces,
  statusGroupLabelKey,
  toggleFavoritesOnly,
  toggleStatusGroup,
  toggleWorkspace,
  type AgentListFilter,
  type AgentStatusGroup,
  type WorkspaceOption,
} from "./agent-filter";
import {
  isFavoriteSourceId,
  parseFavoriteSourceIds,
  pruneFavoriteSourceIds,
  toggleFavoriteSourceId,
} from "./agent-favorites";
import {
  FAVORITES_INACTIVE_KEY,
  agentFavoritesStorage,
  favoritesKeyFor,
  writeFavoriteSourceIds,
} from "./agent-favorites-storage";
import { useAgentFilter } from "./AgentFilterContext";
import { AgentBrandIcon } from "./AgentBrandIcon";
import { Ionicons } from "./icons";
import { useConnection, type FocusPhase } from "./connection";
import { useRecentCompletions } from "./notifications/RecentCompletions";
import { useI18n } from "./i18n/I18nContext";
import type { MessageKey } from "./i18n/messages";
import { useTheme, useThemedStyles } from "./theme/ThemeContext";
import type { ThemeColors } from "./theme/tokens";
import { ScreenHeader } from "./ScreenHeader";
import { ConnectionStatusBar } from "./ConnectionStatusBar";
import type { RootStackParamList } from "./navigation";

// Status text/tone mapping lives in agent-status.ts, shared with AgentDetail's switcher.

const FOCUS_FEEDBACK: Record<FocusPhase, { textKey: MessageKey; icon?: "checkmark-circle" | "alert-circle"; color?: "success" | "danger" }> = {
  switching: { textKey: "agents.focus.switching" },
  switched: { textKey: "agents.focus.switched", icon: "checkmark-circle", color: "success" },
  failed: { textKey: "agents.focus.failed", icon: "alert-circle", color: "danger" },
};

function StatusPill({ agent, justCompleted }: { agent: Agent; justCompleted: boolean }) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { textKey, tone } = agentStatus(agent, justCompleted);
  const color = colors[tone];
  return (
    <View style={[styles.statusPill, { backgroundColor: `${color}1F` }]}>
      <View style={[styles.statusPillDot, { backgroundColor: color }]} />
      <Text style={[styles.statusPillText, { color }]}>{t(textKey)}</Text>
    </View>
  );
}

function AgentRow({
  agent,
  focusPhase,
  justCompleted,
  selected,
  favorited,
  onPress,
  onLongPress,
}: {
  agent: Agent;
  focusPhase?: FocusPhase;
  justCompleted: boolean;
  /** Wide split layout only: this row is the one currently shown in the detail column. */
  selected?: boolean;
  /** 已收藏(星标源数据):仅已收藏时渲染星标,未收藏行布局不变。 */
  favorited: boolean;
  onPress: () => void;
  /** 长按弹收藏/取消收藏菜单(与 onPress 进详情/focus 互不冲突)。 */
  onLongPress: () => void;
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const title = agent.workspace_label || agent.display_name || t("agents.row.unnamed");
  const feedback = focusPhase ? FOCUS_FEEDBACK[focusPhase] : undefined;
  const feedbackColor = feedback?.color ? colors[feedback.color] : undefined;
  const switchA11y = t("agents.row.switchA11y", { title, tab: agent.tab_label ?? "" });
  const a11yParts = [switchA11y];
  if (favorited) a11yParts.push(t("agents.row.favorited"));
  if (justCompleted) a11yParts.push(t("agents.row.justCompleted"));
  const a11yLabel = a11yParts.join(", ");
  // Persistent selection (wide layout) and the transient "just switched" feedback
  // are independent and compose: a row can be the selected one AND briefly show
  // the switched/switching/failed feedback at the same time.
  const highlighted = selected || focusPhase === "switched";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={selected ? { selected: true } : undefined}
      accessibilityLabel={a11yLabel}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [styles.agentCard, pressed && styles.agentCardPressed, highlighted && styles.agentCardSelected]}
    >
      <View style={styles.agentAvatar}>
        <AgentBrandIcon name={agent.agent_name} size={20} color={colors.textPrimary} />
        {justCompleted ? <View style={styles.completedBadge} /> : null}
      </View>
      <View style={styles.agentBody}>
        <View style={styles.agentHeading}>
          <Text numberOfLines={1} style={styles.agentName}>{title}</Text>
          {favorited ? <Ionicons name="star" size={12} color={colors.accent} /> : null}
          <StatusPill agent={agent} justCompleted={justCompleted} />
        </View>
        {agent.tab_label || feedback ? (
          <View style={styles.agentSubtitleRow}>
            {agent.tab_label ? <Text numberOfLines={1} style={styles.tabName}>{agent.tab_label}</Text> : null}
            {feedback?.icon ? <Ionicons name={feedback.icon} size={13} color={feedbackColor} /> : null}
            {feedback ? <Text style={[styles.feedbackText, feedbackColor != null && { color: feedbackColor }]}>{t(feedback.textKey)}</Text> : null}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * 过滤面板(issue #56 状态维 + #57 workspace 维 + #58 收藏维):「仅看
 * 收藏」开关置顶(跨两维的全局修饰,旁标收藏总数,选中实心星),其下
 * 两组分区各自组内多选 OR。workspace chips 显示快照全量计数并按数量
 * 降序;workspace 多时面板整体可滚动(所有分区一起滚,保持单一滚动
 * 上下文)。收藏总数不随过滤选择联动(当前实例收藏集合的全量口径)。
 */
function FilterPanel({
  agentFilter,
  workspaceOptions,
  favoritesCount,
  onToggleStatusGroup,
  onToggleWorkspace,
  onToggleFavoritesOnly,
}: {
  agentFilter: AgentListFilter;
  workspaceOptions: readonly WorkspaceOption[];
  /** 当前实例收藏总数(面板旁标;不随其他维过滤联动)。 */
  favoritesCount: number;
  onToggleStatusGroup: (group: AgentStatusGroup) => void;
  onToggleWorkspace: (workspaceKey: string) => void;
  onToggleFavoritesOnly: () => void;
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const favoritesOnly = agentFilter.favoritesOnly;
  return (
    <View style={styles.filterPanel}>
      <ScrollView
        style={styles.filterPanelScroll}
        contentContainerStyle={styles.filterPanelContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.filterChips}>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: favoritesOnly }}
            accessibilityLabel={t("agents.filter.favoritesOnly")}
            onPress={onToggleFavoritesOnly}
            style={({ pressed }) => [
              styles.filterChip,
              favoritesOnly && styles.filterChipSelected,
              pressed && styles.buttonPressed,
            ]}
          >
            <Ionicons
              name={favoritesOnly ? "star" : "star-outline"}
              size={13}
              color={favoritesOnly ? colors.onAction : colors.textSecondary}
            />
            <Text style={[styles.filterChipText, favoritesOnly && styles.filterChipTextSelected]}>
              {t("agents.filter.favoritesOnly")} ({favoritesCount})
            </Text>
          </Pressable>
        </View>
        <Text style={[styles.filterSectionTitle, styles.filterSectionTitleSpaced]}>{t("agents.filter.section.status")}</Text>
        <View style={styles.filterChips}>
          {STATUS_GROUPS.map((group) => {
            const selected = agentFilter.statusGroups.includes(group);
            return (
              <Pressable
                key={group}
                accessibilityRole="button"
                accessibilityState={selected ? { selected: true } : undefined}
                onPress={() => onToggleStatusGroup(group)}
                style={({ pressed }) => [
                  styles.filterChip,
                  selected && styles.filterChipSelected,
                  pressed && styles.buttonPressed,
                ]}
              >
                {selected ? <Ionicons name="checkmark" size={13} color={colors.onAction} /> : null}
                <Text style={[styles.filterChipText, selected && styles.filterChipTextSelected]}>
                  {t(statusGroupLabelKey[group])}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {workspaceOptions.length > 0 ? (
          <>
            <Text style={[styles.filterSectionTitle, styles.filterSectionTitleSpaced]}>
              {t("agents.filter.section.workspace")}
            </Text>
            <View style={styles.filterChips}>
              {workspaceOptions.map((option) => {
                const selected = agentFilter.workspaces.includes(option.key);
                const label = option.isUnnamed ? t("agents.filter.workspace.unnamed") : option.key;
                return (
                  <Pressable
                    key={option.key}
                    accessibilityRole="button"
                    accessibilityState={selected ? { selected: true } : undefined}
                    onPress={() => onToggleWorkspace(option.key)}
                    style={({ pressed }) => [
                      styles.filterChip,
                      selected && styles.filterChipSelected,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    {selected ? (
                      <Ionicons name="checkmark" size={13} color={colors.onAction} />
                    ) : null}
                    <Text
                      numberOfLines={1}
                      style={[styles.filterChipText, selected && styles.filterChipTextSelected]}
                    >
                      {label} ({option.count})
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

/**
 * Reusable agent-list content. Takes a resolved `onAgentPress` callback so it
 * has no navigation dependency and renders identically inside the narrow
 * bottom-tab shell (where the wrapper pushes `AgentDetail`) and inside the
 * wide split-view list column (where the wrapper updates shared selection).
 *
 * `selectedAgentId` is only meaningful in the wide layout (the detail column
 * shows one agent persistently); the narrow wrapper has no such concept and
 * leaves it undefined so no row gets a persistent selected treatment there.
 */
export function AgentsScreenContent({
  onAgentPress,
  selectedAgentId,
  onStartPairing,
}: {
  onAgentPress: (agent: Agent) => void;
  selectedAgentId?: string;
  onStartPairing: () => void;
}) {
  const { state, focusResult, refresh, switchAgent, streamStatus, activeFingerprint } = useConnection();
  const { completedIds, clearCompleted } = useRecentCompletions();
  const { agentFilter, setAgentFilter } = useAgentFilter();
  const [filterOpen, setFilterOpen] = useState(false);
  const { t, tError, formatTime } = useI18n();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const filterActive = isFilterActive(agentFilter);
  const toggleFilterGroup = useCallback(
    (group: AgentStatusGroup) => setAgentFilter(toggleStatusGroup(agentFilter, group)),
    [agentFilter, setAgentFilter],
  );
  const toggleFilterWorkspace = useCallback(
    (workspaceKey: string) => setAgentFilter(toggleWorkspace(agentFilter, workspaceKey)),
    [agentFilter, setAgentFilter],
  );
  const toggleFilterFavoritesOnly = useCallback(
    () => setAgentFilter(toggleFavoritesOnly(agentFilter)),
    [agentFilter, setAgentFilter],
  );

  // ── 收藏(issue #58,纯客户端本地行为,per-instance MMKV)──
  // 响应式读取:同 key 写入(长按菜单/悬空剔除)自动重渲染星标、计数
  // 与过滤结果。无焦点实例(未配对瞬间)订阅永不写入的哨兵 key。
  const favoritesKey = activeFingerprint ? favoritesKeyFor(activeFingerprint) : FAVORITES_INACTIVE_KEY;
  const [favoritesRaw] = useMMKVString(favoritesKey, agentFavoritesStorage);
  const favoriteSourceIds = useMemo(() => parseFavoriteSourceIds(favoritesRaw), [favoritesRaw]);

  const connected = state.phase === "connected" ? state : undefined;
  const agents = connected?.data.agents;
  // 悬空收藏剔除:pane 消失(source_id 永不复用)即从收藏集合移除;空
  // 快照不剔除(断线/加载瞬间防误清——沿用悬空 workspace 剔除的模式,
  // 守卫在纯函数 pruneFavoriteSourceIds 内)。实例切换恢复记忆槽时,本
  // effect 随新实例快照重跑,同样剔除。
  useEffect(() => {
    if (!activeFingerprint || !agents || agents.length === 0) return;
    const pruned = pruneFavoriteSourceIds(favoriteSourceIds, agents.map((agent) => agent.source_id));
    if (pruned !== favoriteSourceIds) writeFavoriteSourceIds(activeFingerprint, pruned);
  }, [activeFingerprint, agents, favoriteSourceIds]);

  // 长按菜单切换收藏:读当前集合 → 纯函数切换 → 整体覆写(写入即触发
  // 上面的响应式读取重渲,星标/计数/过滤即时生效)。
  const toggleFavorite = useCallback(
    (sourceId: string) => {
      if (!activeFingerprint) return;
      writeFavoriteSourceIds(activeFingerprint, toggleFavoriteSourceId(favoriteSourceIds, sourceId));
    },
    [activeFingerprint, favoriteSourceIds],
  );
  // 长按 AgentRow 弹收藏/取消收藏菜单(文案随当前状态切换);与 onPress
  // 进详情/focus 互不冲突(Pressable 原生区分点按与长按)。
  const showFavoriteMenu = useCallback(
    (agent: Agent) => {
      const favorited = isFavoriteSourceId(favoriteSourceIds, agent.source_id);
      const title = agent.workspace_label || agent.display_name || t("agents.row.unnamed");
      Alert.alert(title, undefined, [
        {
          text: favorited ? t("agents.favorite.remove") : t("agents.favorite.add"),
          onPress: () => toggleFavorite(agent.source_id),
        },
        { text: t("common.cancel"), style: "cancel" },
      ]);
    },
    [favoriteSourceIds, t, toggleFavorite],
  );

  // workspace 集合随快照动态枚举(全量计数,不随过滤选择联动);
  // 快照引用不变时复用同一结果。
  const workspaceOptions = useMemo(
    () => (agents ? enumerateWorkspaceOptions(agents) : []),
    [agents],
  );
  // 防悬空选择:选择中已不在快照枚举集合里的 workspace 自动剔除——
  // 同时覆盖快照刷新(workspace 消失)与实例切换恢复记忆槽两个场景。
  // 空快照不剔除(断线/加载瞬间不清空记忆)。
  useEffect(() => {
    if (workspaceOptions.length === 0) return;
    const pruned = pruneWorkspaces(agentFilter, workspaceOptions.map((option) => option.key));
    if (pruned !== agentFilter) setAgentFilter(pruned);
  }, [workspaceOptions, agentFilter, setAgentFilter]);

  // 归并与状态 pill 同源:completedIds 提供“刚完成”瞬态;未过滤时原引用直通。
  // 收藏维命中查当前实例收藏集合(第三维 AND)。
  const visibleAgents = connected
    ? filterAgents(connected.data.agents, completedIds, agentFilter, favoriteSourceIds)
    : [];
  const statusTitleKey: MessageKey =
    state.phase === "discovering"
      ? "agents.status.discovering"
      : state.phase === "not_found"
        ? "agents.status.notFound"
        : state.phase === "not_paired"
          ? "agents.status.notPaired"
          : state.phase === "revoked"
            ? "agents.status.revoked"
            : state.phase === "fingerprint_mismatch"
              ? "agents.status.fingerprintMismatch"
              : state.phase === "daemon_outdated"
                ? "agents.status.daemonOutdated"
                : state.phase === "app_outdated"
                  ? "agents.status.appOutdated"
                  : state.phase === "failed"
                    ? "agents.status.failed"
                    : "agents.status.connected";
  const statusDetail =
    state.phase === "discovering"
      ? t("agents.detail.discovering")
      : state.phase === "not_found"
        ? t("agents.detail.notFound")
        : state.phase === "not_paired"
          ? t("agents.detail.notPaired")
          : state.phase === "revoked"
            ? t("agents.detail.revoked")
            : state.phase === "fingerprint_mismatch"
              ? t("agents.detail.fingerprintMismatch")
              : state.phase === "daemon_outdated"
                ? t("agents.detail.daemonOutdated")
                : state.phase === "app_outdated"
                  ? t("agents.detail.appOutdated")
                  : state.phase === "failed"
                    ? tError(state.code, { status: state.status })
                    : `${state.data.source_name} · ${state.service.name}`;

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <View style={styles.screen}>
        <ScreenHeader
          title={t("agents.screenTitle")}
          right={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("agents.refreshA11y")}
              onPress={() => void refresh()}
              style={({ pressed }) => [styles.refreshButton, pressed && styles.buttonPressed]}
            >
              <Ionicons name="refresh" size={20} color={colors.onAction} />
            </Pressable>
          }
        />

        <ConnectionStatusBar
          statusTitle={t(statusTitleKey)}
          statusDetail={statusDetail}
          phase={state.phase}
          streamStatus={streamStatus}
          onStartPairing={onStartPairing}
        />

        {connected ? (
          <>
            <View style={styles.summaryRow}>
              <Text style={styles.sectionTitle}>{t("tab.agents")}</Text>
              <View style={styles.summaryRight}>
                <Text numberOfLines={1} style={styles.summaryText}>
                  {connected.data.source_online ? t("agents.summary.sourceOnline") : t("agents.summary.sourceOffline")} · {filterActive ? t("agents.summary.filteredCount", { shown: visibleAgents.length, total: connected.data.agents.length }) : t("agents.summary.count", { count: connected.data.agents.length })} · {formatTime(connected.data.refreshed_at)}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("agents.filter.openA11y")}
                  accessibilityState={{ expanded: filterOpen }}
                  onPress={() => setFilterOpen((open) => !open)}
                  style={({ pressed }) => [
                    styles.filterButton,
                    (filterActive || filterOpen) && styles.filterButtonActive,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Ionicons
                    name={filterActive || filterOpen ? "funnel" : "funnel-outline"}
                    size={16}
                    color={colors.onAction}
                  />
                  {filterActive ? (
                    <View style={styles.filterBadge}>
                      <Text style={styles.filterBadgeText}>{activeFilterChipCount(agentFilter)}</Text>
                    </View>
                  ) : null}
                </Pressable>
              </View>
            </View>
            {filterOpen ? (
              <FilterPanel
                agentFilter={agentFilter}
                workspaceOptions={workspaceOptions}
                favoritesCount={favoriteSourceIds.length}
                onToggleStatusGroup={toggleFilterGroup}
                onToggleWorkspace={toggleFilterWorkspace}
                onToggleFavoritesOnly={toggleFilterFavoritesOnly}
              />
            ) : null}
            <FlatList
              data={visibleAgents}
              keyExtractor={(agent) => agent.source_id}
              renderItem={({ item }) => (
                <AgentRow
                  agent={item}
                  focusPhase={focusResult?.sourceID === item.source_id ? focusResult.phase : undefined}
                  justCompleted={completedIds.has(item.source_id)}
                  selected={selectedAgentId === item.source_id}
                  favorited={isFavoriteSourceId(favoriteSourceIds, item.source_id)}
                  onPress={() => {
                    clearCompleted([item.source_id]);
                    onAgentPress(item);
                    void switchAgent(connected.service, item);
                  }}
                  onLongPress={() => showFavoriteMenu(item)}
                />
              )}
              contentContainerStyle={
                visibleAgents.length === 0 ? styles.emptyList : styles.list
              }
              ListEmptyComponent={
                filterActive ? (
                  <View style={styles.emptyFiltered}>
                    <Text style={styles.emptyText}>{t("agents.filter.noMatch")}</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("agents.filter.clear")}
                      onPress={() => setAgentFilter(NO_FILTER)}
                      style={({ pressed }) => [styles.clearFilterButton, pressed && styles.buttonPressed]}
                    >
                      <Text style={styles.clearFilterText}>{t("agents.filter.clear")}</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Text style={styles.emptyText}>{t("agents.empty")}</Text>
                )
              }
              showsVerticalScrollIndicator={false}
            />
          </>
        ) : (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderTitle}>{t("agents.placeholder.title")}</Text>
            <Text style={styles.placeholderText}>{t("agents.placeholder.text")}</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

/** Narrow-mode screen: pushes `AgentDetail` onto the root stack when a row is tapped. */
export function AgentsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const onAgentPress = useCallback(
    (agent: Agent) => navigation.navigate("AgentDetail", { agent }),
    [navigation],
  );
  const onStartPairing = useCallback(() => navigation.navigate("Pairing"), [navigation]);
  return <AgentsScreenContent onAgentPress={onAgentPress} onStartPairing={onStartPairing} />;
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: colors.background },
    screen: { flex: 1, paddingHorizontal: 20, paddingTop: 18 },
    refreshButton: { backgroundColor: colors.actionBg, borderRadius: 20, width: 40, height: 40, alignItems: "center", justifyContent: "center" },
    buttonPressed: { opacity: 0.72 },
    summaryRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 },
    sectionTitle: { color: colors.textPrimary, fontSize: 21, fontWeight: "700", flexShrink: 0 },
    summaryRight: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 1 },
    summaryText: { color: colors.textSecondary, fontSize: 12, flexShrink: 1, minWidth: 0 },
    filterButton: { backgroundColor: colors.actionBg, borderRadius: 16, width: 32, height: 32, alignItems: "center", justifyContent: "center", flexShrink: 0 },
    filterButtonActive: { backgroundColor: colors.accent },
    filterBadge: { position: "absolute", top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, backgroundColor: colors.danger, borderWidth: 1.5, borderColor: colors.actionBg, alignItems: "center", justifyContent: "center" },
    filterBadgeText: { color: colors.onDanger, fontSize: 10, fontWeight: "700" },
    filterPanel: { backgroundColor: colors.card, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.cardBorder, marginBottom: 12 },
    // workspace 多时面板整体可滚动(状态区 + workspace 区同一滚动上下文)。
    filterPanelScroll: { maxHeight: 232 },
    filterPanelContent: { padding: 10 },
    filterSectionTitle: { color: colors.textSecondary, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
    filterSectionTitleSpaced: { marginTop: 12 },
    filterChips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
    filterChip: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7, backgroundColor: colors.background, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.cardBorder, maxWidth: "100%" },
    filterChipSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
    filterChipText: { color: colors.textSecondary, fontSize: 13, fontWeight: "600" },
    filterChipTextSelected: { color: colors.onAction },
    emptyFiltered: { alignItems: "center", gap: 14 },
    clearFilterButton: { borderRadius: 999, borderWidth: 1, borderColor: colors.accent, paddingHorizontal: 14, paddingVertical: 8 },
    clearFilterText: { color: colors.accent, fontSize: 14, fontWeight: "600" },
    list: { paddingBottom: 28, gap: 10 },
    emptyList: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
    emptyText: { color: colors.textSecondary, fontSize: 15 },
    agentCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.card, borderRadius: 18, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.cardBorder },
    agentCardPressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
    agentCardSelected: { borderColor: colors.selectedCardBorder, backgroundColor: colors.selectedCard },
    agentAvatar: { width: 38, height: 38, borderRadius: 11, backgroundColor: colors.separator, alignItems: "center", justifyContent: "center" },
    completedBadge: { position: "absolute", top: -3, right: -3, width: 11, height: 11, borderRadius: 5.5, backgroundColor: colors.statusDotConnected, borderWidth: 2, borderColor: colors.card },
    agentBody: { flex: 1 },
    agentHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
    agentName: { color: colors.textPrimary, fontSize: 16, fontWeight: "700", flexShrink: 1 },
    agentSubtitleRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 },
    tabName: { color: colors.textSecondary, fontSize: 13, flexShrink: 1 },
    feedbackText: { color: colors.textSecondary, fontSize: 12 },
    statusPill: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3.5 },
    statusPillDot: { width: 6, height: 6, borderRadius: 3 },
    statusPillText: { fontSize: 11, fontWeight: "600" },
    placeholder: { marginTop: 62, paddingHorizontal: 25, alignItems: "center" },
    placeholderTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: "700", marginBottom: 8 },
    placeholderText: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, textAlign: "center" },
  });
