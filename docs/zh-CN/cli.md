# Herdr Connect CLI

[English](../cli.md)

`herdr-connect` CLI 帮助所有者检查本地 Herdr 安装实例并启动同一局域网预览。建议从以下命令开始：

```sh
herdr-connect doctor
herdr-connect service install
herdr-connect service status
```

运行 `herdr-connect help` 可查看完整命令、全局选项、示例和安全边界。`help <command>`、`<command> --help` 和 `<command> -h` 显示具体命令的用法。`herdr-connect version` 与 `herdr-connect --version` 显示发布版本；没有注入发布元数据的源码 build 会明确显示 `development`。

## 诊断安装实例

`doctor` 是面向普通使用者的默认入口。它检查 SQLite 数据库能否打开并通过校验、所选 Herdr 来源是否可达、是否能看到至少一个 Agent，以及 TCP `9808` 能否用于 LAN preview，并在结尾给出所有者可直接执行的下一步命令：

```console
$ herdr-connect doctor
Herdr Connect doctor
[OK] Database: /home/owner/.config/herdr-connect/daemon.db (schema v1)
[OK] Herdr CLI/source: herdr-cli-v0.7 is online
[OK] Agents: 2 found
[OK] LAN preview port: TCP 9808 is available
Next: Ready. Run '/home/owner/.local/bin/herdr-connect service install' to install and start the background service.
```

如果 Herdr 缺失或不可用，请先让 `herdr agent list` 正常工作。如果没有发现 Agent，请启动一个 Agent，再重试 `herdr-connect doctor`。如果 `9808` 上已经运行另一个 Herdr Connect preview，doctor 会报告它已在运行，而不会要求所有者重复启动；如果端口属于其他程序，doctor 会以退出码 1 结束并提示如何检查占用者。新自动化可以使用结构化的 `doctor --json` 获得相同检查。

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

`logs` 输出最近 100 行；`--tail` 持续输出新增内容。`uninstall` 停止服务并且只移除受管理的配置，保留 CLI 二进制、数据库和日志。再次执行 `service install` 会原子更新 Herdr Connect 自己生成的配置。macOS 使用 `~/Library/LaunchAgents/com.tomyail.herdr-connect.plist`；Linux 要求 systemd user service，并使用 `~/.config/systemd/user/herdr-connect.service`。当前预览不支持 Windows 服务管理。

`diagnostics` 继续作为现有脚本的兼容命令，其默认输出仍为 JSON；`diagnostics --json` 是含义相同的显式写法。既有字段为 `database`、`schema_version`、`source_name`、`source_online`、`agent_count` 和 `through_event_seq`；来源不可用时会增加稳定标记 `source_error: "source_unavailable"`。

## 命令与选项

全局选项必须放在命令之前：

```text
--source herdr|fake   来源适配器，默认为 herdr
--db PATH             SQLite 路径，默认为所有者的配置目录
-h, --help            显示帮助，不连接 Herdr 或打开 SQLite
--version             显示 build 版本，不连接 Herdr 或打开 SQLite
```

面向所有者的命令包括 `doctor`、`service`、`demo-lan`、`diagnostics`、`status`、`agents`、`capabilities`、`migrations` 和 `daemon`。`daemon --once` 只同步一次，可用于脚本化健康检查。`trace` 和 `--source fake` 属于开发工具。

CLI 输出遵循统一约定：

- JSON 以及明确请求的 help/version 输出到 stdout。
- 警告与错误输出到 stderr；`doctor` 的检查结果属于请求的报告，因此输出到 stdout。
- 退出码 0 表示成功，1 表示运行时或健康检查失败，2 表示命令行用法错误。
- `service status` 等生命周期命令在服务尚未安装时使用退出码 3。
- help、version、未知命令和参数错误都会在连接 Herdr 或打开 SQLite 前处理。未知命令与已有命令接近时会给出建议。

## LAN preview 安全边界

`demo-lan` 监听 TCP `9808` 并广播 `_herdr-connect._tcp`。它没有配对、设备认证、传输加密或端到端加密，会通过未加密 HTTP 暴露近期终端输出并接受文本输入。

只能在可信、可控的局域网运行；测试期间不得输入秘密，结束后用 `Ctrl+C` 停止。不要把端口暴露到互联网。局域网发现只能证明安装实例可达，不建立信任，也不授予读取或操作 Agent 的权限。

二进制安装与平台说明见 [daemon 安装指南](release/daemon.md)。
