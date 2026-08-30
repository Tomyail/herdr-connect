/**
 * Keychain 写入顺序规划(Seam B,纯逻辑)。
 *
 * writeModel(credentials.ts)的多步 Keychain 写入在任意一步之间都可能被打
 * 断(进程崩溃/系统杀进程)。本模块的顺序规则保证每个中断窗口都收敛到
 * 既有自愈路径,而不是产生无人清理的孤儿键:
 *
 * - readModel 把「索引有引用、实例键缺失/损坏」的条目按不存在处理
 *   (跳过),writeModel 下次执行会把它从索引清除——自愈路径;
 * - 反过来「索引无引用、实例键存在」的孤儿键没有任何清理路径
 *   (writeModel 的清理只遍历索引)。
 *
 * 顺序约束:
 *
 * 1. 先删除从模型中消失的实例键(此刻索引仍引用它们——中断后走
 *    「索引有、条目缺失」自愈路径,下次写入从索引清掉该 fingerprint);
 * 2. 再写索引(含全部新 fingerprint)——新增条目在实例键落盘前被打断,
 *    同样落在自愈路径上;绝不把实例键写到索引之外(孤儿键);
 * 3. 再写各实例键;
 * 4. 最后同步活动实例指针(stale 指针由 resolveActiveInstance 的最近
 *    配对回退自愈)。
 *
 * 由 keychain-write-plan.test.ts 锁定;本模块无副作用,可在 node:test
 * 下运行。
 */

import type { PairedInstancesModel } from "./paired-instances";

/** 单条 Keychain 写入步骤;writeModel 按返回顺序执行。 */
export type KeychainWriteStep =
  /** 删除一个不再存在于模型中的实例键。 */
  | { readonly kind: "delete_instance"; readonly fingerprint: string }
  /** 覆写实例索引(JSON fingerprint 数组)。 */
  | { readonly kind: "write_index"; readonly fingerprints: readonly string[] }
  /** 写入/更新一个实例键。 */
  | { readonly kind: "write_instance"; readonly fingerprint: string }
  /** 同步活动实例指针(null = 删除该键)。 */
  | { readonly kind: "set_active"; readonly fingerprint: string | null };

/**
 * 旧索引 → 新模型的写入步骤序列。确定性:delete_instance 保持旧索引
 * 序,write_instance 与 write_index 保持模型键序(Object.keys)。
 */
export function planKeychainWrites(
  previousIndex: readonly string[],
  model: PairedInstancesModel,
): readonly KeychainWriteStep[] {
  const fingerprints = Object.keys(model.instances);
  const steps: KeychainWriteStep[] = [];
  for (const fingerprint of previousIndex) {
    if (!(fingerprint in model.instances)) {
      steps.push({ kind: "delete_instance", fingerprint });
    }
  }
  steps.push({ kind: "write_index", fingerprints });
  for (const fingerprint of fingerprints) {
    steps.push({ kind: "write_instance", fingerprint });
  }
  steps.push({ kind: "set_active", fingerprint: model.activeFingerprint });
  return steps;
}
