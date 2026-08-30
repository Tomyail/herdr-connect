import AppKit
import SwiftUI

private enum DeviceKind: String {
    case iphone
    case ipad

    var canvasSize: CGSize {
        switch self {
        case .iphone:
            CGSize(width: 1284, height: 2778)
        case .ipad:
            CGSize(width: 2064, height: 2752)
        }
    }

    var screenWidth: CGFloat {
        switch self {
        case .iphone:
            950
        case .ipad:
            1580
        }
    }

    var deviceTop: CGFloat {
        switch self {
        case .iphone:
            650
        case .ipad:
            590
        }
    }

    var screenCornerRadius: CGFloat {
        switch self {
        case .iphone:
            76
        case .ipad:
            48
        }
    }

    var bezel: CGFloat {
        switch self {
        case .iphone:
            22
        case .ipad:
            18
        }
    }

    var outerCornerRadius: CGFloat {
        switch self {
        case .iphone:
            104
        case .ipad:
            70
        }
    }

    var displayFontSize: CGFloat {
        switch self {
        case .iphone:
            78
        case .ipad:
            100
        }
    }

    var kickerFontSize: CGFloat {
        switch self {
        case .iphone:
            27
        case .ipad:
            32
        }
    }

    var subtitleFontSize: CGFloat {
        switch self {
        case .iphone:
            28
        case .ipad:
            34
        }
    }
}

private struct ScreenshotCopy {
    let scene: String
    let number: String
    let section: String
    let kicker: String
    let titleLineOne: String
    let titleLineTwo: String
    let subtitle: String
    let topbarLabel: String
}

private extension ScreenshotCopy {
    static let englishUS: [String: ScreenshotCopy] = [
        "agents": ScreenshotCopy(
            scene: "agents",
            number: "01",
            section: "AGENTS",
            kicker: "ONE CONTROL SURFACE FOR EVERY AGENT.",
            titleLineOne: "Your agents.",
            titleLineTwo: "One clear view.",
            subtitle: "See what’s working, waiting, or blocked from one local control surface.",
            topbarLabel: "LOCAL CONTROL"
        ),
        "detail": ScreenshotCopy(
            scene: "detail",
            number: "02",
            section: "HISTORY",
            kicker: "STAY CLOSE TO THE WORK.",
            titleLineOne: "Every thread.",
            titleLineTwo: "One clear history.",
            subtitle: "Keep context, recent activity, and the next step in view.",
            topbarLabel: "LOCAL CONTROL"
        ),
        "settings": ScreenshotCopy(
            scene: "settings",
            number: "03",
            section: "SETTINGS",
            kicker: "TUNE THE EXPERIENCE TO YOUR WORKFLOW.",
            titleLineOne: "Your setup.",
            titleLineTwo: "Your rules.",
            subtitle: "Keep language, voice, notifications, and connection details close at hand.",
            topbarLabel: "LOCAL CONTROL"
        ),
    ]

    static let simplifiedChinese: [String: ScreenshotCopy] = [
        "agents": ScreenshotCopy(
            scene: "agents",
            number: "01",
            section: "AGENTS",
            kicker: "所有 Agent，清楚可见",
            titleLineOne: "多个 Agent，",
            titleLineTwo: "一处掌控。",
            subtitle: "在局域网内，集中查看状态、进度与下一步。",
            topbarLabel: "本地控制"
        ),
        "detail": ScreenshotCopy(
            scene: "detail",
            number: "02",
            section: "HISTORY",
            kicker: "不必在终端之间来回切换",
            titleLineOne: "每个 Agent 的历史，",
            titleLineTwo: "一目了然。",
            subtitle: "查看上下文、近期活动和下一步，不离开当前工作流。",
            topbarLabel: "本地控制"
        ),
        "settings": ScreenshotCopy(
            scene: "settings",
            number: "03",
            section: "SETTINGS",
            kicker: "按你的工作方式，调整每个细节",
            titleLineOne: "你的设置，",
            titleLineTwo: "由你掌控。",
            subtitle: "语言、语音、通知和连接信息，都能随时调整。",
            topbarLabel: "本地控制"
        ),
    ]

    static func forLocale(_ locale: String) -> [String: ScreenshotCopy] {
        locale.hasPrefix("zh") ? simplifiedChinese : englishUS
    }
}

private let canvasBackground = Color(red: 0.91, green: 0.93, blue: 0.88)
private let appBackground = Color(red: 0.953, green: 0.945, blue: 0.918)
private let ink = Color(red: 0.105, green: 0.12, blue: 0.105)
private let secondaryInk = Color(red: 0.31, green: 0.36, blue: 0.31)
private let accent = Color(red: 0.275, green: 0.392, blue: 0.278)

private struct GridPattern: View {
    var body: some View {
        Canvas { context, size in
            let spacing: CGFloat = 92
            let lineColor = Color(red: 0.275, green: 0.392, blue: 0.278).opacity(0.075)

            for x in stride(from: spacing / 2, through: size.width, by: spacing) {
                var path = Path()
                path.move(to: CGPoint(x: x, y: 0))
                path.addLine(to: CGPoint(x: x, y: size.height))
                context.stroke(path, with: .color(lineColor), lineWidth: 1)
            }

            for y in stride(from: spacing / 2, through: size.height, by: spacing) {
                var path = Path()
                path.move(to: CGPoint(x: 0, y: y))
                path.addLine(to: CGPoint(x: size.width, y: y))
                context.stroke(path, with: .color(lineColor), lineWidth: 1)
            }
        }
        .allowsHitTesting(false)
    }
}

private func cleanedScreenshot(_ image: NSImage, for device: DeviceKind) -> NSImage {
    guard device == .ipad, let tiffData = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiffData) else {
        return image
    }

    // iPadOS 26 adds a neutral-gray window-resize handle to Simulator captures.
    // It occupies only the final ~50 px of the lower-right corner. Replace just
    // those neutral pixels instead of painting a rectangular patch over the app
    // UI, which keeps the rounded screen edge and the Stop button intact.
    let sourceBackground = NSColor(
        calibratedRed: 243 / 255,
        green: 241 / 255,
        blue: 234 / 255,
        alpha: 1
    )
    let startX = max(0, bitmap.pixelsWide - 80)
    let startY = max(0, bitmap.pixelsHigh - 80)

    for x in startX..<bitmap.pixelsWide {
        for y in startY..<bitmap.pixelsHigh {
            guard let color = bitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else {
                continue
            }

            let red = color.redComponent
            let green = color.greenComponent
            let blue = color.blueComponent
            let maximum = max(red, green, blue)
            let minimum = min(red, green, blue)
            let isResizeHandlePixel = maximum < 0.92 && maximum - minimum < 0.04
            if isResizeHandlePixel {
                bitmap.setColor(sourceBackground, atX: x, y: y)
            }
        }
    }

    let cleaned = NSImage(size: image.size)
    cleaned.addRepresentation(bitmap)
    return cleaned
}

private struct DeviceMockup: View {
    let screenshot: NSImage
    let device: DeviceKind

    private var screenHeight: CGFloat {
        device.screenWidth * device.canvasSize.height / device.canvasSize.width
    }

    var body: some View {
        Image(nsImage: screenshot)
            .resizable()
            .aspectRatio(contentMode: .fit)
            .frame(width: device.screenWidth, height: screenHeight)
            .clipShape(
            RoundedRectangle(
                cornerRadius: device.screenCornerRadius,
                style: .continuous
            )
        )
        .padding(device.bezel)
        .background {
            RoundedRectangle(
                cornerRadius: device.outerCornerRadius,
                style: .continuous
            )
            .fill(Color(red: 0.055, green: 0.065, blue: 0.058))
            .overlay {
                RoundedRectangle(
                    cornerRadius: device.outerCornerRadius,
                    style: .continuous
                )
                .stroke(Color.black.opacity(0.82), lineWidth: 8)
            }
        }
        .overlay {
            RoundedRectangle(
                cornerRadius: device.outerCornerRadius,
                style: .continuous
            )
            .stroke(Color.white.opacity(0.15), lineWidth: 2)
        }
        .shadow(color: .black.opacity(0.23), radius: 42, y: 28)
    }
}

private struct MarketingHeader: View {
    let copy: ScreenshotCopy
    let device: DeviceKind

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(copy.kicker)
                .font(
                    .system(
                        size: device.kickerFontSize,
                        weight: .bold,
                        design: .monospaced
                    )
                )
                .tracking(device == .iphone ? 1.4 : 1.8)
                .foregroundStyle(accent)
                .lineLimit(1)
                .minimumScaleFactor(0.65)

            HStack(alignment: .top, spacing: device == .iphone ? 18 : 24) {
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .fill(accent)
                    .frame(
                        width: device == .iphone ? 10 : 12,
                        height: device == .iphone ? 166 : 208
                    )

                VStack(alignment: .leading, spacing: 0) {
                    Text(copy.titleLineOne)
                        .font(
                            .system(
                                size: device.displayFontSize,
                                weight: .black,
                                design: .rounded
                            )
                        )
                        .tracking(-1.7)
                        .lineLimit(1)
                        .minimumScaleFactor(0.58)
                        .foregroundStyle(ink)
                    Text(copy.titleLineTwo)
                        .font(
                            .system(
                                size: device.displayFontSize,
                                weight: .black,
                                design: .rounded
                            )
                        )
                        .tracking(-1.7)
                        .lineLimit(1)
                        .minimumScaleFactor(0.58)
                        .foregroundStyle(accent)

                    Text(copy.subtitle)
                        .font(
                            .system(
                                size: device.subtitleFontSize,
                                weight: .medium,
                                design: .rounded
                            )
                        )
                        .tracking(0)
                        .foregroundStyle(secondaryInk)
                        .lineSpacing(device == .iphone ? 5 : 7)
                        .lineLimit(2)
                        .minimumScaleFactor(0.72)
                        .padding(.top, device == .iphone ? 20 : 24)
                }
            }
            .padding(.top, device == .iphone ? 16 : 20)
        }
    }
}

private struct MarketingScreenshot: View {
    let screenshot: NSImage
    let copy: ScreenshotCopy
    let device: DeviceKind

    var body: some View {
        ZStack(alignment: .top) {
            canvasBackground
            GridPattern()

            // A quiet ring gives the otherwise flat canvas a physical, editorial
            // anchor without competing with the product screen.
            Circle()
                .stroke(accent.opacity(0.13), lineWidth: 2)
                .frame(width: device == .iphone ? 820 : 1320)
                .offset(
                    x: device == .iphone ? 620 : 1110,
                    y: device == .iphone ? -270 : -460
                )

            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .center) {
                    Text("HERDR CONNECT")
                        .font(
                            .system(
                                size: device == .iphone ? 23 : 27,
                                weight: .bold,
                                design: .monospaced
                            )
                        )
                        .tracking(device == .iphone ? 4.6 : 5.4)
                        .foregroundStyle(ink)

                    Spacer()

                    Text("\(copy.topbarLabel)  /  \(copy.number)")
                        .font(
                            .system(
                                size: device == .iphone ? 20 : 24,
                                weight: .semibold,
                                design: .monospaced
                            )
                        )
                        .tracking(1.4)
                        .foregroundStyle(accent)
                }

                MarketingHeader(copy: copy, device: device)
                    .padding(.top, device == .iphone ? 66 : 62)
            }
            .frame(
                width: device.canvasSize.width - (device == .iphone ? 148 : 184),
                alignment: .leading
            )
            .padding(.top, device == .iphone ? 76 : 82)

            HStack {
                Spacer(minLength: 0)
                DeviceMockup(screenshot: screenshot, device: device)
                Spacer(minLength: 0)
            }
            .frame(width: device.canvasSize.width)
            .offset(y: device.deviceTop)
        }
        .frame(width: device.canvasSize.width, height: device.canvasSize.height)
        .clipped()
    }
}

@main
private enum ScreenshotComposer {
    @MainActor
    static func main() throws {
        guard CommandLine.arguments.count == 5 else {
            throw ComposerError.invalidArguments
        }

        let rawDirectory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
        let outputDirectory = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
        let locale = CommandLine.arguments[3]
        guard let device = DeviceKind(rawValue: CommandLine.arguments[4]) else {
            throw ComposerError.invalidDevice(CommandLine.arguments[4])
        }

        try FileManager.default.createDirectory(
            at: outputDirectory,
            withIntermediateDirectories: true
        )

        let copies = ScreenshotCopy.forLocale(locale)
        for copy in copies.values.sorted(by: { $0.number < $1.number }) {
            let sourceURL = rawDirectory.appendingPathComponent("\(copy.scene).png")
            guard let screenshot = NSImage(contentsOf: sourceURL) else {
                // --scene agents is allowed to generate only one screenshot. Do
                // not fail because the other scene is intentionally absent.
                if !FileManager.default.fileExists(atPath: sourceURL.path) {
                    continue
                }
                throw ComposerError.unreadableImage(sourceURL.path)
            }

            let renderer = ImageRenderer(
                content: MarketingScreenshot(
                    screenshot: cleanedScreenshot(screenshot, for: device),
                    copy: copy,
                    device: device
                )
            )
            renderer.scale = 1

            guard
                let image = renderer.nsImage,
                let tiffData = image.tiffRepresentation,
                let bitmap = NSBitmapImageRep(data: tiffData),
                let pngData = bitmap.representation(using: .png, properties: [:])
            else {
                throw ComposerError.renderFailed(copy.scene)
            }

            try pngData.write(
                to: outputDirectory.appendingPathComponent("\(copy.scene).png"),
                options: .atomic
            )
        }
    }
}

private enum ComposerError: LocalizedError {
    case invalidArguments
    case invalidDevice(String)
    case unreadableImage(String)
    case renderFailed(String)

    var errorDescription: String? {
        switch self {
        case .invalidArguments:
            "用法：compose_app_store_screenshots RAW_DIR OUTPUT_DIR LOCALE DEVICE"
        case let .invalidDevice(device):
            "不支持的设备类型：\(device)"
        case let .unreadableImage(path):
            "无法读取原始截图：\(path)"
        case let .renderFailed(scene):
            "无法渲染商店截图：\(scene)"
        }
    }
}
