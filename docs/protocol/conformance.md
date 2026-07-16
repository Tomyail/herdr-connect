# Protocol v1 Conformance

Protocol v1 同时维护 Go 与 TypeScript 实现。任何 wire format 修改必须通过单语言行为测试、双向跨语言测试和固定向量测试。

## 公共 seam

- Go：`protocol.Seal` 与 `protocol.Open`。
- TypeScript：`seal` 与 `open`。
- 跨语言：两个 `protocol-conformance` JSON CLI。

测试不直接调用 canonical encoding、签名输入或 HPKE adapter 等内部 helper，因此内部实现可以重构而不改变行为契约。

## 运行测试

```sh
GOMODCACHE=/tmp/herdr-connect-go-mod-cache \
GOCACHE=/tmp/herdr-connect-go-cache \
go test ./protocol -count=1

pnpm --filter @herdr-connect/protocol typecheck
pnpm --filter @herdr-connect/protocol test
pnpm test:conformance
```

跨语言测试会验证：

- Go seal、TypeScript open。
- TypeScript seal、Go open。
- 首次配对请求在没有预信任 Device 公钥时能双向自举验签，但不会因此获得授权。
- 错误 pairing secret 在调用原子 `PairingGuard` 前失败；有效候选才可提交一次性 session。
- 两端都把受保护头、ciphertext、signature、HPKE `enc`/nonce 上下文、recipient 篡改和错 Device 私钥收敛为 `authentication_failed`。
- 同一逻辑事件面向两台 Device 时保持 `event_id`、`event_seq`，并产生不同 ciphertext。
- 两端逐字节复现固定向量。
- 两端在 `expires_at_ms` 精确到期时拒绝消息。
- 两端对重放、未知版本和未知消息类型返回相同稳定错误码。
- Go 产生的 pairing challenge signature 可由 TypeScript 验证，反向亦然，且确定性 signature 逐字节相同。

## 固定向量

固定向量位于：

```text
protocol/testdata/v1/envelope.json
```

文件中的私钥是一次性合成测试数据，不属于任何真实 Installation 或 Device。它包含固定 header、plaintext、收件人 X25519 密钥、发送方 Ed25519 密钥、HPKE ephemeral key material 和期望 envelope。

生产代码不能使用固定向量中的密钥或 `ephemeral_key_material`。注入随机源只用于测试，以及由 Expo/平台 CSPRNG 适配公共 `RandomSource`；实现不得使用可预测随机数。

## CLI 协议

CLI 从 stdin 读取一个 JSON 请求，向 stdout 写一个 JSON 结果；错误写入 stderr 并以状态码 1 退出。支持：

- `generate_identity`
- `seal`
- `open`
- `open_replay`（仅用于在单个进程内验证重放 guard）
- `sign_pairing_challenge`
- `verify_pairing_challenge`

Go CLI：

```sh
go run ./cmd/protocol-conformance
```

TypeScript CLI 构建后入口：

```sh
node packages/protocol/dist/src/conformance-cli.js
```

这些 CLI 是开发和 CI 工具，不是 daemon 或 App 的生产密钥管理入口。

## 修改规则

- 修复实现但不改变线上字节时，固定向量必须保持不变。
- 若预期 envelope 字节变化，先判断是否实际上需要 Protocol v2。
- 禁止仅更新 fixture 让失败测试变绿；必须用中文记录变化原因，并让两种独立实现重新通过动态互操作。
- 增加消息类型或字段前，先更新 `docs/protocol/v1.md` 的版本演进判断。
