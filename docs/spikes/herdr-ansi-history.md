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

## 真实样本结论（pi / claude 空闲 / claude 权限弹窗）

- 三份样本都**只有 SGR**（含 `38;5;n`、`38;2;r;g;b`、`48;2;…`、`1`、`7`），没有光标移动或 OSC；每行以 `ESC[0m` 开头，样式不跨行。
- 两个 agent 的正文都已被 TUI 硬折行，`recent-unwrapped` 在 alt-screen 的 agent 上与 `recent` 等价。
- 选中项在 claude 弹窗里不是反显，而是强调色加 `❯` 标记；text 里 `❯ 1. Yes` 同样可识别，菜单识别不依赖 ANSI。
- 规则线颜色不稳定（pi 紫色；claude 空闲灰色、弹窗强调色），chrome 识别必须用结构，不能用颜色。弹窗态只有上方一条规则线，没有下方那条。
- ANSI 多出来的信号：用户消息的背景块、`⏺` 颜色对应工具状态（绿完成 / 灰等待）、行内强调色、diff 红绿。

## Collie（AltanS/collie，MIT）调研

结论：**Collie 同样以 ANSI 为主数据**，我之前"它主要用 text"的判断是错的（其 `ARCHITECTURE.md` 里"服务端剥 ANSI"的描述已过时，代码为准）。

- 镜像读取用 `pane.read(source=recent, format=ansi)`，客户端 `parseAnsi → splitLines → StyledLine[] → buildBlocks`，只解析 SGR（`web/src/lib/ansi.ts`），不做终端模拟；其 ADR 0008 明确拒绝 xterm.js / 桥接侧模拟器，理由是 herdr 已经渲染好网格。
- 语义识别（对话框、输入框）几乎全靠文本模式匹配；全部 grammar 里只有一处读样式（`wizard.ts` 用背景色找当前 stepper 项）。样式用于渲染，语义来自文本。
- 按 harness 分适配器（claude 一套约 9.7k 行：prompt-select、wizard、multi-select、preview-select、menu、autocomplete），无法识别时回落到原始镜像，这是安全方向。配套 34+ 份字节级抓取作为测试夹具。
- ADR 0048：输入框靠"自身边框"定位（最低的整行规则线、框线与 `❯` 行位于第 0 列、草稿续行缩进），因为按行数向上走的做法已经坏了三次。与我们样本的结构一致。
- **scroll 采集问题**：`recent` / `recent_unwrapped` 加 `format=text` 且 `lines > viewport_rows` 时，herdr 会驱动 agent 自己的滚动接口，操作者的终端会上翻再回弹（0.85s 到 13.8s）；`ansi` 格式从未观察到，`visible` 天然免疫。
- alt-screen 的 agent 没有终端回滚，`pane.read` 只返回视口。Collie 的"历史"从 agent 自己的会话日志（如 `~/.claude/projects/<cwd>/<session>.jsonl`，会话 id 来自 herdr 的 `agent_session`）读取，得到真正的轮次、时间戳和工具调用。
- `revision` 在 herdr 0.7.x 上恒为 0，不可作变更检测依据。
- 光标位置是 Collie 向上游提的需求，不自行模拟。

### 对我们的影响

1. **待验证的潜在 bug**：`ReadAgentHistory` 用 `agent read --source recent-unwrapped --lines 120`（默认 text）。claude 的 `viewport_rows` 通常小于 120，可能触发上述滚动采集，手机每 2 秒轮询一次。需要在有 herdr 的机器上对比 `--format text` 与 `--format ansi` 的耗时，并观察终端是否抖动。若成立，改 ansi 本身就是修复。
2. `recent-unwrapped` 对 alt-screen agent 是 no-op，可以不再依赖其"反折行"语义。
3. 长历史应来自 agent 会话日志而不是屏幕；这是独立的、更大的方向。
4. 手机端暗/亮主题：真彩色占绝大多数且无法按调色板换色，Collie 选择整体反相（ADR 0002），我们需要同样的决策。
5. 分层方式可借鉴：ANSI 解析 → 行 + 样式 run → 按 agent 的文本 grammar 识别块 → 渲染，grammar 与夹具一起演进，未识别则回落原始行。
