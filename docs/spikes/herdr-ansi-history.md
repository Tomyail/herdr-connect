# Spike: 用 herdr `--format ansi` 取代 text 历史

## 背景与问题

daemon 目前通过 `herdr agent read <id> --source recent-unwrapped --lines N` 取历史，使用默认的 `--format text`
（`internal/herdrsource/herdr_cli.go` `ReadAgentHistory`）。text 丢失了所有样式信息（颜色、粗体、dim、反显），
由此衍生出一批靠猜的逻辑：

| 现有逻辑 | 位置 | 为什么脆弱 |
| --- | --- | --- |
| `stripTUIChrome`：按框线字符占比、键盘提示词汇、裸提示符剥离尾部输入框/状态栏 | `internal/herdrsource/tui_chrome.go` | 每个 agent CLI 的 chrome 不同，靠结构启发式，误删/漏删都会发生 |
| 手机端把终端抓取当 markdown 渲染（粗体、行内代码、fence、`#` 标题） | `apps/mobile/src/history-markdown.ts` | 终端输出并非 markdown；tail 窗口截断导致 fence 失配，需要专门补丁 |
| 无法识别交互提示（权限确认菜单的当前选项） | 无 | text 中"选中项"只体现为反显/颜色，已丢失 |
| 无法还原 diff 红绿、dim 的次要信息 | 无 | 同上 |

ANSI 保留 SGR 样式信号，这些问题大多可以从"猜"变成"读"。

## 本次调研的局限

- 沙箱里没有 `herdr` 二进制，且 `herdr.dev` 被出口代理拦截，**未能抓取真实 ANSI 样本，也未能核对 `--format ansi` 的精确语义**。
- 以下待验证项必须在有 herdr 的机器上确认，再决定细节（见"待验证"）。

## 待验证（在有 herdr 的机器上执行）

```sh
herdr agent read <pane_id> --source recent-unwrapped --lines 40 --format ansi > ansi.txt
herdr agent read <pane_id> --source recent-unwrapped --lines 40 --format text > text.txt
cat -v ansi.txt | head -80
```

1. ANSI 输出是否只有 SGR（`ESC[...m`），还是也含光标移动/清除序列？（决定要不要屏幕模型）
2. `recent-unwrapped` 在 ansi 下是否仍是"逻辑行"（未按终端宽度折行），样式是否跨行延续？
3. 反显（`ESC[7m`）是否保留？它是输入框、选中项的最可靠信号。
4. 是否有 `--format ansi` 之外的结构化来源（光标位置、屏幕尺寸、alt-screen 标记）？
5. 每行是否带尾部空白/用背景色填充整行（影响宽度与换行）？

## 方案

### 分层

```
herdr --format ansi
      │
daemon: 解析 ANSI → 行 + 样式 run（Go，一处解析，所有客户端共享）
      │  协议新增字段，保留 text
      ▼
mobile: 按样式 run 渲染（RN <Text> 嵌套 span）
```

**解析放 daemon 而不是手机端**：协议只下发结构化样式 run，不把原始转义序列交给客户端。
这样客户端不必各自实现 ANSI 状态机，也避免把未清洗的控制序列发到手机（安全面更小——OSC/CSI 非 SGR 序列在 daemon 就丢弃）。

### 协议

`HistoryResponse`（`internal/demolan/server.go`）保留 `text` 不变（向后兼容旧客户端），新增可选字段，例如：

```json
{
  "text": "...",
  "lines": [
    { "runs": [ { "text": "⏺ Bash", "fg": "green", "bold": true }, { "text": "(ls)" } ] }
  ]
}
```

- `api_version` 或 capability 位用于协商；旧 daemon 无 `lines` 时手机端回退到 `text` + markdown 渲染。
- 颜色用语义（16 色索引 / 256 / RGB 三种之一的紧凑表示），由手机主题映射，保证明暗主题可读。
- 需同步 `protocol/` 的 conformance 测试与 `docs/protocol`。

### daemon

- 新增 `ansi.go`：SGR 状态机，支持重置、粗体、dim、斜体、下划线、反显、前景/背景（16/256/truecolor）；忽略其他 CSI/OSC。
- `ReadAgentHistory` 改 `--format ansi`；同时保留由 ANSI 去样式得到的 `text`，沿用 `Truncated` 与 `Revision` 逻辑。
- `stripTUIChrome` 改为基于样式信号：优先用"尾部连续的反显/dim 整行 + 框线"判定 chrome，旧启发式降级为 fallback，逐步删除。
  - 迁移期保留旧测试夹具（`testdata/pane-*.txt`），**新增 ANSI 夹具**，两者对同一场景断言结果一致后再删旧规则。

### mobile

- 新增 `HistoryRuns.tsx`，沿用现有"单个 selectable `<Text>` + 嵌套 span"的结构，保证跨行选择不退化。
- 样式映射进 `theme/tokens.ts`；有 `lines` 用 runs 渲染，否则回退 `HistoryMarkdown`。
- markdown 渲染对终端输出本就不准确，ANSI 路径稳定后可去掉对 agent 输出的 markdown 解析（保留 fallback）。

### 解锁的能力（分期）

1. **样式还原**（颜色、粗体、dim、diff 红绿）——纯渲染，风险最低。
2. **可靠的 chrome 识别**——用反显/dim 替代字符比例启发式。
3. **交互提示识别**——识别选中项反显，映射为手机端按钮并经 `send-keys` 回传（需另做安全评审）。
4. **光标/覆盖重绘**——若 ANSI 含光标移动，才需要真正的屏幕模型（vt 仿真）。成本最高，等待验证 #1 后再决定，默认不做。

## 风险

- ANSI 体积比 text 大，历史轮询（2s，`HISTORY_REFRESH_MS`）带宽上升；可用 `Revision` 去重或增量。
- 不同 agent CLI 的 SGR 用法不一致，chrome 判定仍需夹具覆盖（claude / grok / pi 至少三种）。
- 若 `recent-unwrapped` 的 ANSI 含光标定位序列，则 SGR-only 解析不够，需回到屏幕模型方案。

## 建议的落地顺序

1. 在有 herdr 的环境抓 ANSI 夹具，回答"待验证"五点，补充到本文。
2. daemon 解析器 + 协议新增字段 + 夹具测试（不改行为，仅新增字段）。
3. mobile 样式渲染（期 1）。
4. 用样式信号重写 chrome 剥离（期 2），删除旧启发式。
5. 视需要做交互提示（期 3）。
