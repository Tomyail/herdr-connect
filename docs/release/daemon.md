# Go daemon 发布与安装

Herdr Connect 的 Go daemon 通过 GitHub Releases 提供预编译压缩包。普通用户不需要安装 Go、Node.js 或 pnpm。

## 支持的发行目标

每个 `v*` tag 会触发 `.github/workflows/daemon-release.yml`，生成以下资产：

- macOS Apple Silicon：`darwin_arm64`
- macOS Intel：`darwin_amd64`
- Linux ARM64：`linux_arm64`
- Linux x86-64：`linux_amd64`
- Windows x86-64：`windows_amd64`
- 所有资产的 SHA-256 校验文件：`SHA256SUMS`

带连字符的版本 tag，例如 `v0.1.0-preview.1`，会创建 GitHub prerelease；稳定 tag，例如 `v0.1.0`，会创建正式 Release。

## 下载与运行

从项目的 GitHub Releases 页面下载与系统匹配的压缩包，解压后直接运行：

```bash
./herdr-connect --source fake capabilities
./herdr-connect --source herdr diagnostics
./herdr-connect --source herdr demo-lan
```

Windows 使用 `herdr-connect.exe`。`herdr` source 要求机器上已经安装 `herdr`，并且该命令位于当前进程的 `PATH` 中；`fake` source 只用于演示和诊断。

`demo-lan` 是 MVP 预览能力，目前没有认证和加密，只应在可信局域网中运行。退出前台进程可按 `Ctrl+C`。

## 校验下载文件

macOS 和 Linux 可以在下载目录运行：

```bash
sha256sum -c SHA256SUMS --ignore-missing
```

macOS 如果没有 `sha256sum`，可以使用：

```bash
shasum -a 256 herdr-connect_*.tar.gz
```

然后与 `SHA256SUMS` 中对应记录比较。

## 维护者发布流程

先在本地完成验证，再推送 tag：

```bash
gofmt -w cmd/herdr-connect
go test ./...
go build ./cmd/herdr-connect
git tag v0.1.0-preview.1
git push origin v0.1.0-preview.1
```

工作流会先测试真实入口，再交叉编译、压缩、生成校验和并创建或更新 GitHub Release。工作流只使用 GitHub 自动提供的 `github.token`，不需要额外发布 secret。

当前工作流不对二进制做 Apple notarization 或 Windows code signing。用户可能会看到系统来源确认提示，这是 MVP 阶段的已知限制。
