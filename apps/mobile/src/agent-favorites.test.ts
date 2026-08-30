import assert from "node:assert/strict";
import test from "node:test";

import {
  isFavoriteSourceId,
  parseFavoriteSourceIds,
  pruneFavoriteSourceIds,
  serializeFavoriteSourceIds,
  toggleFavoriteSourceId,
} from "./agent-favorites";

// ---------------------------------------------------------------------------
// toggleFavoriteSourceId —— 收藏增删(幂等、保序)
// ---------------------------------------------------------------------------

test("新增收藏追加到尾部,集合内无重复项", () => {
  let favorites: readonly string[] = [];
  favorites = toggleFavoriteSourceId(favorites, "pane-1");
  favorites = toggleFavoriteSourceId(favorites, "pane-2");
  assert.deepEqual(favorites, ["pane-1", "pane-2"]);
  // 幂等:对已有项再 toggle 是取消开关(下个用例),集合内同一 pane
  // 永远只出现一次——追加分支永不产生重复。
  assert.equal(favorites.filter((id) => id === "pane-1").length, 1);
});

test("取消收藏即移除;再次取消空转(集合回到移除后状态)", () => {
  let favorites = toggleFavoriteSourceId(toggleFavoriteSourceId([], "pane-1"), "pane-2");
  favorites = toggleFavoriteSourceId(favorites, "pane-1");
  assert.deepEqual(favorites, ["pane-2"]);
  // 再点同一项 = 重新收藏(开关语义,不是越点越少)。
  favorites = toggleFavoriteSourceId(favorites, "pane-1");
  assert.deepEqual(favorites, ["pane-2", "pane-1"]);
});

test("toggle 往返:收藏后取消回到空集合(与初始同构)", () => {
  const favorites = toggleFavoriteSourceId(toggleFavoriteSourceId([], "pane-1"), "pane-1");
  assert.deepEqual(favorites, []);
});

test("isFavoriteSourceId:星标与长按菜单共用的唯一判定", () => {
  const favorites = ["pane-1", "pane-2"];
  assert.equal(isFavoriteSourceId(favorites, "pane-1"), true);
  assert.equal(isFavoriteSourceId(favorites, "pane-3"), false);
  assert.equal(isFavoriteSourceId([], "pane-1"), false);
});

// ---------------------------------------------------------------------------
// pruneFavoriteSourceIds —— 悬空收藏剔除(pane 消失立即清理)
// ---------------------------------------------------------------------------

test("剔除快照中已消失的 source_id,保留仍存活的", () => {
  const favorites = ["pane-1", "pane-gone", "pane-2"];
  const pruned = pruneFavoriteSourceIds(favorites, ["pane-1", "pane-2", "pane-new"]);
  assert.deepEqual(pruned, ["pane-1", "pane-2"]);
});

test("无需剔除时返回原引用(调用方可跳过写入)", () => {
  const favorites = ["pane-1"];
  assert.equal(pruneFavoriteSourceIds(favorites, ["pane-1", "pane-2"]), favorites);
});

test("全部悬空时清空集合(pane 全关 → 收藏即死引用)", () => {
  const pruned = pruneFavoriteSourceIds(["pane-1", "pane-2"], ["pane-9"]);
  assert.deepEqual(pruned, []);
});

test("空快照不剔除:断线/加载瞬间防误清,直通原引用", () => {
  const favorites = ["pane-1", "pane-2"];
  // live 为空 = 快照不可信(断线/加载中),绝不能据此清空收藏。
  assert.equal(pruneFavoriteSourceIds(favorites, []), favorites);
  // 空集合也直通原引用(无操作可做)。
  const empty: readonly string[] = [];
  assert.equal(pruneFavoriteSourceIds(empty, ["pane-1"]), empty);
});

// ---------------------------------------------------------------------------
// parse / serialize —— MMKV 落盘 round-trip 与容错
// ---------------------------------------------------------------------------

test("serialize → parse round-trip 保序保持集合不变", () => {
  const favorites = ["pane-2", "pane-1", "pane-3"];
  assert.deepEqual(parseFavoriteSourceIds(serializeFavoriteSourceIds(favorites)), favorites);
  assert.deepEqual(parseFavoriteSourceIds(serializeFavoriteSourceIds([])), []);
});

test("parse 容错:undefined/空串/非 JSON/非数组一律回到空集合", () => {
  assert.deepEqual(parseFavoriteSourceIds(undefined), []);
  assert.deepEqual(parseFavoriteSourceIds(""), []);
  assert.deepEqual(parseFavoriteSourceIds("not json"), []);
  assert.deepEqual(parseFavoriteSourceIds("42"), []);
  assert.deepEqual(parseFavoriteSourceIds('{"a":1}'), []);
  assert.deepEqual(parseFavoriteSourceIds('"pane-1"'), []);
});

test("parse 丢弃非字符串/空串元素并保序去重", () => {
  assert.deepEqual(
    parseFavoriteSourceIds(JSON.stringify(["pane-1", 42, null, "", "pane-1", "pane-2", true])),
    ["pane-1", "pane-2"],
  );
});
