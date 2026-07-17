import { ScrollView, StyleSheet, Text, View } from "react-native";
import type { Service } from "@inthepocket/react-native-service-discovery";

import appConfig from "../app.config";
import type { DemoAgentsResponse } from "./demo-contract";
import { Ionicons, type IoniconName } from "./icons";
import { preferredAddress } from "./network";

interface SettingsProps {
  service?: Service;
  data?: DemoAgentsResponse;
}

interface SettingsRow {
  icon: IoniconName;
  label: string;
  value: string;
}

function SettingsCard({ title, rows }: { title: string; rows: SettingsRow[] }) {
  return (
    <>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>
        {rows.map((row, index) => (
          <View
            key={row.label}
            style={[styles.row, index === rows.length - 1 && styles.rowLast]}
          >
            <View style={styles.rowLeading}>
              <Ionicons name={row.icon} size={17} color="#8A8E86" />
              <Text style={styles.rowLabel}>{row.label}</Text>
            </View>
            <Text numberOfLines={1} style={styles.rowValue}>{row.value}</Text>
          </View>
        ))}
      </View>
    </>
  );
}

export function Settings({ service, data }: SettingsProps) {
  const connectionRows: SettingsRow[] = [
    { icon: "radio-outline", label: "状态", value: service ? "已连接" : "未连接" },
  ];
  if (service) {
    connectionRows.push(
      { icon: "desktop-outline", label: "daemon", value: service.name },
      { icon: "globe-outline", label: "地址", value: `${preferredAddress(service.addresses) ?? "未知"}:${service.port}` },
    );
  }
  if (data) {
    connectionRows.push(
      { icon: "terminal-outline", label: "来源", value: data.source_name },
      { icon: "pulse-outline", label: "来源状态", value: data.source_online ? "在线" : "离线" },
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      style={styles.screen}
    >
      <SettingsCard title="连接" rows={connectionRows} />
      <SettingsCard
        title="发现"
        rows={[
          { icon: "pricetag-outline", label: "服务类型", value: "_herdr-connect._tcp" },
          { icon: "wifi-outline", label: "发现方式", value: "局域网 Bonjour / NSD" },
        ]}
      />
      <SettingsCard
        title="关于"
        rows={[
          { icon: "phone-portrait-outline", label: "应用", value: appConfig.name },
          { icon: "information-circle-outline", label: "版本", value: appConfig.version ?? "未知" },
        ]}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingBottom: 28 },
  sectionTitle: { color: "#1B1E1A", fontSize: 21, fontWeight: "700", marginBottom: 12 },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#DAD8D0",
    paddingHorizontal: 17,
    marginBottom: 26,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#ECEAE3",
  },
  rowLast: { borderBottomWidth: 0 },
  rowLeading: { flexDirection: "row", alignItems: "center", gap: 9 },
  rowLabel: { color: "#777B72", fontSize: 14 },
  rowValue: { color: "#1D201C", fontSize: 14, fontWeight: "600", flexShrink: 1 },
});
