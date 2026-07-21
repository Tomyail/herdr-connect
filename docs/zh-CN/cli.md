# Herdr Connect CLI

[English](../cli.md)

`herdr-connect` CLI 帮助所有者检查本地 Herdr 安装实例并启动同一局域网 daemon。建议从以下命令开始：

```sh
herdr-connect doctor
herdr-connect service install
herdr-connect service status
```

运行 `herdr-connect help` 可查看完整命令、全局选项、示例和安全边界。`help <command>`、`<command> --help` 和 `<command> -h` 显示具体命令的用法。`herdr-connect version` 与 `herdr-connect --version` 显示发布版本；没有注入发布元数据的源码 build 会明确显示 `development`。

## 诊断安装实例

`doctor` 是面向普通使用者的默认入口。它检查 SQLite 数据库能否打开并通过校验、所选 Herdr 来源是否可达、是否能看到至少一个 Agent，以及 TCP `9808` 能否用于 LAN daemon，并在结尾给出所有者可直接执行的下一步命令：

```console
$ herdr-connect doctor
Herdr Connect doctor
[OK] Database: /home/owner/.config/herdr-connect/daemon.db (schema v2)
[OK] Herdr CLI/source: herdr-cli-v0.7 is online
[OK] Agents: 2 found
[OK] LAN daemon port: TCP 9808 is available
Next: Ready. Run '/home/owner/.local/bin/herdr-connect service install' to install and start the background service.
```

如果 Herdr 缺失或不可用，请先让 `herdr agent list` 正常工作。如果没有发现 Agent，请启动一个 Agent，再重试 `herdr-connect doctor`。如果 `9808` 上已经运行另一个 Herdr Connect daemon，doctor 会报告它已在运行，而不会要求所有者重复启动；如果端口属于其他程序，doctor 会以退出码 1 结束并提示如何检查占用者。新自动化可以使用结构化的 `doctor --json` 获得相同检查。

安装版会显示实际可执行文件路径。临时的 `go run` 二进制不能安装为永久服务；源码开发仍可使用前台命令 `go run ./cmd/herdr-connect --source herdr demo-lan`。

## 管理后台服务

在 macOS 和 Linux 上，显式安装并立即启动所有者级服务：

```sh
herdr-connect service install
herdr-connect service status
```

安装命令会把 Herdr Connect 二进制和当前 `herdr` 都解析为绝对路径并写入服务配置。服务安装期间不要移动或删除任一可执行文件。需要时可用 `service install --herdr /absolute/path/to/herdr` 覆盖 Herdr。Herdr 可以暂时离线，但可执行文件必须存在且可执行。命令拒绝覆盖不受管理的同名服务文件，也不会接管占用 TCP `9808` 的其他进程。

完整生命周期为：

```sh
herdr-connect service status --json
herdr-connect service logs
herdr-connect service logs --tail
herdr-connect service restart
herdr-connect service uninstall
```

`logs` 输出最近 100 行；`--tail` 持续输出新增内容。`uninstall` 停止服务并且只移除受管理的配置，保留 CLI 二进制、数据库和日志。再次执行 `service install` 会原子更新 Herdr Connect 自己生成的配置。macOS 使用 `~/Library/LaunchAgents/com.tomyail.herdr-connect.plist`；Linux 要求 systemd user service，并使用 `~/.config/systemd/user/herdr-connect.service`。Windows 服务管理尚未支持。

`diagnostics` 继续作为现有脚本的兼容命令，其默认输出仍为 JSON；`diagnostics --json` 是含义相同的显式写法。既有字段为 `database`、`schema_version`、`source_name`、`source_online`、`agent_count` 和 `through_event_seq`；来源不可用时会增加稳定标记 `source_error: "source_unavailable"`。

## 通过局域网配对设备

`pair` 签发一个一次性 QR 码，供 Herdr Connect 设备扫描以建立该设备专属的 token。它要求 LAN daemon 已经在运行。在一个终端启动 daemon，然后在另一个终端执行：

```sh
herdr-connect --source herdr demo-lan   # 终端 1
herdr-connect pair                       # 终端 2
```

`pair` 首先探活 daemon 是否在监听 `9808`；如果未运行，命令以非零退出码退出并提示先启动 `demo-lan`。等待期间它会打印可扫描的终端 QR，其 payload 包含安装实例证书指纹（`fp`）、候选 LAN 主机地址、固定端口 `9808` 和一次性 `secret`。设备扫码后将 secret 提交到 `/v1/pair` 即可完成配对；命令会轮询直到配对完成或 secret 超时，随后打印已配对的设备名和 `device_id`。明文设备 token 只会返回给配对设备，绝不会在主机端打印。

## 命令与选项

全局选项必须放在命令之前：

```text
--source herdr|fake   来源适配器，默认为 herdr
--db PATH             SQLite 路径，默认为所有者的配置目录
-h, --help            显示帮助，不连接 Herdr 或打开 SQLite
--version             显示 build 版本，不连接 Herdr 或打开 SQLite
```

面向所有者的命令包括 `doctor`、`service`、`demo-lan`、`pair`、`diagnostics`、`status`、`agents`、`capabilities`、`migrations` 和 `daemon`。`daemon --once` 只同步一次，可用于脚本化健康检查。`trace` 和 `--source fake` 属于开发工具。

CLI 输出遵循统一约定：

- JSON 以及明确请求的 help/version 输出到 stdout。
- 警告与错误输出到 stderr；`doctor` 的检查结果属于请求的报告，因此输出到 stdout。
- 退出码 0 表示成功，1 表示运行时或健康检查失败，2 表示命令行用法错误。
- `service status` 等生命周期命令在服务尚未安装时使用退出码 3。
- help、version、未知命令和参数错误都会在连接 Herdr 或打开 SQLite 前处理。未知命令与已有命令接近时会给出建议。

## LAN-only 安全边界

`demo-lan` 监听 TCP `9808` 并广播 `_herdr-connect._tcp`。传输层为 HTTPS，使用自签的 ECDSA P-256 证书，其证书指纹 SHA-256 即为设备 pin 的安装实例身份。除 `/v1/pair` 外的所有端点都要求携带已配对设备的 `Authorization: Bearer <token>`；缺失/未知 token 返回 `401 unauthorized`，已撤销设备返回 `401 revoked`。配对通过一次性 QR secret 在 `/v1/pair` 换取每设备专属 token。近期终端输出与文本输入都只能通过这些已认证端点访问。

受支持的产品范围是本地优先的 LAN 控制：请把 daemon 放在你管理的网络或 VPN 中，不要把 TCP `9808` 直接暴露到公网，并及时撤销不再使用的设备。局域网发现只能证明安装实例可达；信任由 QR 配对和证书 pinning 建立。信任模型、证书生命周期与配对流程详见 [LAN TLS 与配对](../security/lan-tls-pairing.md)。

二进制安装与平台说明见 [daemon 安装指南](release/daemon.md)。
