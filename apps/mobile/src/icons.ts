import type { ComponentProps } from "react";
import { Ionicons } from "@expo/vector-icons";

export type IoniconName = NonNullable<ComponentProps<typeof Ionicons>["name"]>;

export const ICON_SIZE = 22;

export { Ionicons };
