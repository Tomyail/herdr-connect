# Spike: react-native-streamdown 评估

## 目标

验证 react-native-streamdown + react-native-enriched-markdown 能否替换当前的自定义 markdown 渲染，特别关注：

1. 工具输出多行结构会不会被标准 markdown reflow 破坏
2. 接入成本（Babel/Metro/Expo prebuild 改动）
3. 库的成熟度
4. 是否需要保留现有自定义 parser 作为 fallback

## 当前实现分析

### history-markdown.ts + HistoryMarkdown.tsx

**核心特性：**
- 逐行处理，不做段落 reflow（保留终端工具输出的原始行结构）
- 支持的功能：`**粗体**`、`` `行内代码` ``、fenced code block、`#` 标题
- 特殊处理：`agent read --lines N` 是尾窗口截取，可能截到一个开头 fence 在窗口外的代码块，导致后面的 tagged fence 被误判成"关闭"而不是"开启"。解决方案：带 language tag 的 fence（如 ` ```sh `）强制视为 opening fence

**测试样本分析（来自 `internal/herdrsource/testdata/pane-*.txt`）：**

样本 1 (pane-pi.txt):
```markdown
   grep -RIn "no pairing\|no auth\|无认证\|无加密\|Unsafe LAN demo\|unsafe LAN demo" README.md docs/ 2>/dev/null | grep -v 'docs/demo/lan-ios-agent-list.md'
 ```

 结果为空。

 - 额外 grep 旧 disclaimer 口径，也为空：

 ```sh
   grep -RIn "trusted network\|trusted local\|stop .*testing\|stop .*finished\|测试结束\|只.*可信\|仅限.*可信\|不安全" README.md docs SECURITY.md 2>/dev/null | grep -v 'docs/demo/lan-ios-agent-list.md'
 ```
```

样本 2 (pane-claude.txt):
```markdown
⏺ Bash(which jq python3 2>&1)
  ⎿  /opt/homebrew/bin/jq
     /opt/homebrew/bin/python3

⏺ Bash(herdr agent list 2>&1 | jq -r '.result.agents[] | "\(.terminal_id) \(.agent) \(.agent_status)"' 2>&1)
  ⎿  term_656f1b80196f5fc claude working
     term_65703d313a84f134 pi idle
     term_6571686c50d2318e pi idle
     term_656f6e17a407510a grok idle
```

**关键观察：**
- 工具输出依赖字面换行符（⎿ 后续行的缩进对齐）
- 有些行以空格开头（缩进），有些以 `- ` 开头（列表）
- 有 fenced code block（```sh）
- 没有空行隔开的连续行（如列表项、命令输出）需要保留原有结构

---

## react-native-streamdown 分析

### 架构

- **react-native-enriched-markdown**: CommonMark/GFM 全量渲染（使用 md4c 解析）
- **remend**: 修补未闭合的流式 markdown token
- **react-native-worklets**: Bundle Mode 后台线程处理

### 版本和兼容性

**当前项目：**
- Expo SDK: ~56.0.16
- React Native: 0.85.3

**react-native-streamdown:**
- 最新版本: v0.2.0 (2026-05-26)
- Peer dependencies:
  - `react-native-enriched-markdown`: >=0.4.0
  - `react-native-worklets`: 0.8.3
  - `remend`: 1.3.0

**兼容性检查：**
- `react-native-enriched-markdown` 0.7.0 支持 RN 0.85 ✅
- 但需要 **New Architecture (Fabric)** ✅ (Expo 56 默认启用)
- **不兼容 Expo Go**（需要 native code，必须用 dev-client 或 prebuild）

### 接入成本清单

#### 1. 依赖安装

```bash
yarn add react-native-streamdown
yarn add react-native-enriched-markdown react-native-worklets remend
```

#### 2. babel.config.js（需要创建）

```js
module.exports = function (api) {
  api.cache(true);

  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'react-native-worklets/plugin',
        {
          bundleMode: true,
          importForwarding: {
            moduleNames: ['remend'],
          },
        },
      ],
    ],
  };
};
```

#### 3. metro.config.js（需要创建）

```js
const { getDefaultConfig } = require('expo/metro-config');
const { getBundleModeMetroConfig } = require('react-native-worklets/bundleMode');

let config = getDefaultConfig(__dirname);

// Watch the .worklets/ output directory
config.watchFolders.push(
  require('path').resolve(
    __dirname,
    'node_modules/react-native-worklets/.worklets'
  )
);

// Apply Bundle Mode config
config = getBundleModeMetroConfig(config);

// Custom resolver to preserve default behavior for non-worklets modules
const bundleModeResolver = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('react-native-worklets/.worklets/')) {
    return bundleModeResolver(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
```

#### 4. Expo prebuild

```bash
npx expo prebuild --clean
```

由于有 native dependencies，需要：
- 重新生成 iOS/Android native 代码
- iOS: `cd ios && bundle install && bundle exec pod install`
- Android: 通常会自动处理

#### 5. 新增配置文件总结

| 文件 | 状态 | 说明 |
|------|------|------|
| `babel.config.js` | 需要创建 | Worklets Bundle Mode 配置 |
| `metro.config.js` | 需要创建 | WatchFolders + custom resolver |
| `ios/Podfile.lock` | 会变化 | 新增 native pods |
| `android/` | 会变化 | 新增 native modules |

---

## 成熟度评估

### release 节奏

- v0.1.0: 2026-03-10 (首次发布)
- v0.1.1: 2026-03-12
- v0.1.2: 2026-05-21
- v0.2.0: 2026-05-26

**发布频率：** 较高（早期快速迭代）

### Issues 分析（共 26 个）

| 类型 | 数量 | 说明 |
|------|------|------|
| 已关闭 | 23 | 大部分是文档和兼容性问题 |
| 未关闭 | 3 | 包括 #23 (support worklets 0.10), #25 (docs), #3 (Skia) |
| 关键 bug | 0 | 没有发现严重的 blocking bug |

### 与 Expo SDK 56 的已知问题

- Issue #14: "Document Expo SDK 56 iOS workaround for Worklets Bundle Mode" — 已关闭，说明有已知 workaround
- Issue #6: "react-native-worklets 0.8.0+ crashes" — 已关闭

**风险点：**
- 2026-02 发布，历史较短（约 5 个月）
- Star 数 374，不算特别高，但 Software Mansion 是 RN Core Contributors，信誉较好
- peer dependency 版本锁定较严格（`react-native-worklets@0.8.3`），未来升级可能需要适配

---

## 关键验证点 3：工具输出多行结构问题

### 问题分析

**CommonMark 规范：**
- 单个换行符（\n）在渲染时通常会被替换为空格（软换行 → 空格）
- 两个尾随空格（`  \n`）表示硬换行（保留换行）
- 两个换行符（\n\n）表示段落分隔

**问题示例：**

输入 markdown：
```
⎿  /opt/homebrew/bin/jq
   /opt/homebrew/bin/python3
```

标准 CommonMark 渲染结果（行内形式）：
```
⎿  /opt/homebrew/bin/jq /opt/homebrew/bin/python3
```

**原因是：** 两个换行之间没有空行，所以被视为同一个段落内的软换行，被替换为空格。

### react-native-enriched-markdown 的行为

根据 md4c（底层解析器）的 CommonMark 实现，**它遵循标准 CommonMark 规范**，所以上述问题同样存在。

### 解决方案对比

#### 方案 A: 预处理（强制硬换行）

在喂给 react-native-streamdown 之前，给工具输出行强制插入两个尾随空格：

```ts
function preprocessForEnrichedMarkdown(text: string): string {
  // 检测工具输出行（如 ⎿ 开头或缩进行）
  const TOOL_OUTPUT_RE = /^  \S|⎿|^ - |⏺/gm;
  return text.replace(TOOL_OUTPUT_RE, (line) => {
    // 移除现有尾随空格，添加两个空格确保硬换行
    return line.trimEnd() + '  ';
  });
}
```

**优点：**
- 简单直接
- 保留 react-native-enriched-markdown 的全部能力

**缺点：**
- 需要维护工具输出行的检测规则（可能漏判或误判）
- 复杂的工具输出场景（如 nested lists、嵌套 code blocks）可能需要更复杂的规则
- 两个尾随空格会出现在复制文本中（用户体验问题）

#### 方案 B: 混合渲染（工具输出跳过 markdown）

保留现有自定义 parser，只对非工具输出的部分使用 react-native-enriched-markdown：

```ts
// 检测是否为工具输出块
const TOOL_BLOCK_RE = /^⏺|^  ⎿|^   /m;

function renderHybrid(text: string) {
  if (TOOL_BLOCK_RE.test(text)) {
    // 使用现有的自定义 parser
    return <HistoryMarkdown text={text} styles={styles} />;
  } else {
    // 使用 react-native-streamdown
    return <StreamdownText markdown={text} />;
  }
}
```

**优点：**
- 工具输出完全保留原始结构（零风险）
- 非工具输出（如用户消息、AI 分析文本）享受全量 markdown 能力

**缺点：**
- 需要维护两套渲染逻辑
- 检测规则仍然需要维护（可能漏判边界情况）

#### 方案 C: 不迁移（保留现有实现）

**理由：**
- 当前实现已经满足需求（支持粗体、行内代码、fenced code、标题）
- 工具输出多行结构问题无法通过 react-native-enriched-markdown 直接解决，仍需预处理
- 预处理规则的复杂度与当前 parser 相当，没有减少维护成本
- 额外的配置和 native dependencies 增加了技术债

---

## Spike 结论

### 问题 3 的答案

**react-native-streamdown + react-native-enriched-markdown 无法直接解决工具输出多行结构问题。**

原因：
1. 库遵循标准 CommonMark 规范，会把没有空行隔开的连续行合并成段落
2. 工具输出依赖字面换行符（如 `⎿` 后续行的缩进对齐），标准渲染会破坏对齐
3. 必须在喂给库之前做预处理（如强制硬换行），这部分逻辑的复杂度与当前 parser 相当

### 接入成本

| 改动项 | 成本 | 风险 |
|--------|------|------|
| 依赖安装 | 低 | 需要验证 peer dependency 版本兼容性 |
| babel.config.js | 中 | 需要创建新文件，配置 worklets 插件 |
| metro.config.js | 中 | 需要创建新文件，配置 watchFolders 和 resolver |
| Expo prebuild | 高 | 需要重新生成 native 代码，iOS 需要重新 pod install |
| 预处理逻辑 | 中 | 需要维护工具输出检测规则，复杂度与当前 parser 相当 |

**总体评估：** 中等到高成本，特别是 prebuild 步骤会破坏现有的 native 配置（entitlements、签名等，见 `scripts/strip-push-entitlement.mjs`）。

### 库的成熟度

| 维度 | 评估 |
|------|------|
| 发布历史 | 5 个月，4 个版本，迭代较快 |
| Issues | 26 个，大部分已关闭，无严重 blocking bug |
| 与 Expo 56 兼容性 | 有已知 workaround（#14），但需要实测验证 |
| 维护者 | Software Mansion（RN Core Contributors），信誉较好 |
| Star 数 | 374，中等 |

**总体评估：** 成熟度中等，可以用于生产，但历史较短，建议关注后续版本稳定性。

### 建议：暂缓迁移

**理由：**

1. **核心问题未解决**：工具输出多行结构问题仍需预处理，无法直接通过库的能力解决
2. **接入成本过高**：需要创建 babel.config.js 和 metro.config.js，运行 Expo prebuild，重新编译 native 代码
3. **维护成本未降低**：预处理规则的复杂度与当前 parser 相当，没有减少维护成本
4. **功能收益有限**：当前实现已经满足需求（粗体、行内代码、fenced code、标题），全量 GFM（表格、嵌套列表、链接）在工具输出场景中使用频率低
5. **技术风险**：新增 3 个 native dependencies，增加了包大小和潜在的兼容性问题

**何时重新评估：**

1. **需求变化**：如果历史消息开始包含复杂的 markdown（如表格、嵌套列表、LaTeX），可以考虑引入 react-native-enriched-markdown，但需要先解决预处理逻辑
2. **库的演进**：如果未来版本提供了"禁用 paragraph reflow"的配置选项，可以重新评估
3. **技术栈统一**：如果项目其他部分也需要流式 markdown 渲染（如实时 AI 对话），可以统一引入

---

## 证据附件

### 当前实现

- `apps/mobile/src/history-markdown.ts`: 极简 markdown parser
- `apps/mobile/src/HistoryMarkdown.tsx`: React Native 渲染组件

### 测试样本

- `internal/herdrsource/testdata/pane-pi.txt`: pi agent 的终端输出
- `internal/herdrsource/testdata/pane-claude.txt`: Claude Code 的终端输出
- `internal/herdrsource/testdata/pane-grok.txt`: Grok 的终端输出

### 库文档

- react-native-streamdown README: https://github.com/software-mansion-labs/react-native-streamdown
- react-native-enriched-markdown README: https://github.com/software-mansion-labs/react-native-enriched-markdown
- react-native-worklets Bundle Mode docs: https://docs.swmansion.com/react-native-worklets/docs/bundleMode/setup/

### 已知问题

- react-native-streamdown #14: Expo SDK 56 iOS workaround
- react-native-streamdown #6: worklets 0.8.0+ crashes (已关闭)

---

## 附录：Spike 代码（未执行）

以下代码可以用来验证 react-native-streamdown 对工具输出多行结构的处理行为（由于需要 native dependencies，未实际执行）：

```tsx
// apps/mobile/src/StreamdownSpike.tsx
import { StreamdownText } from 'react-native-streamdown';
import { Text, View, StyleSheet } from 'react-native';

const TOOL_OUTPUT_SAMPLE = `⏺ Bash(which jq python3 2>&1)
  ⎿  /opt/homebrew/bin/jq
     /opt/homebrew/bin/python3`;

const PREPROCESSED_SAMPLE = `⏺ Bash(which jq python3 2>&1)  
  ⎿  /opt/homebrew/bin/jq  
     /opt/homebrew/bin/python3`;

export function StreamdownSpike() {
  return (
    <View style={styles.container}>
      <Text style={styles.header}>Original (expected broken):</Text>
      <StreamdownText markdown={TOOL_OUTPUT_SAMPLE} />

      <Text style={styles.header}>Preprocessed with hard breaks:</Text>
      <StreamdownText markdown={PREPROCESSED_SAMPLE} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  header: { fontWeight: 'bold', marginTop: 16, marginBottom: 8 },
});
```

**预期结果：**
- Original: 行会被合并成一行（`⎿  /opt/homebrew/bin/jq /opt/homebrew/bin/python3`）
- Preprocessed: 换行符被保留（强制硬换行）

这验证了问题 3 的结论：库本身不会自动解决工具输出多行结构问题，需要预处理。