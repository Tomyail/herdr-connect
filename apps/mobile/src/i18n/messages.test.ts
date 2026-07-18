import assert from "node:assert/strict";
import test from "node:test";

import { NETWORK_ERROR_CODES } from "./errors";
import { RESOLVED_LOCALES } from "./locale";
import {
  errorMessageBundles,
  formatTemplate,
  messageBundles,
  translateError,
  translateUi,
  type MessageKey,
} from "./messages";

const englishUiKeys = Object.keys(messageBundles.en) as MessageKey[];

test("every locale exposes exactly the same UI keys as English", () => {
  for (const locale of RESOLVED_LOCALES) {
    const keys = Object.keys(messageBundles[locale]).sort();
    assert.deepEqual(keys, [...englishUiKeys].sort(), `UI key mismatch for ${locale}`);
  }
});

test("no UI message is empty in any locale", () => {
  for (const locale of RESOLVED_LOCALES) {
    for (const key of englishUiKeys) {
      const value = messageBundles[locale][key];
      assert.ok(value && value.length > 0, `empty UI message: ${locale}.${key}`);
    }
  }
});

test("every locale error bundle covers every NetworkErrorCode and nothing more", () => {
  for (const locale of RESOLVED_LOCALES) {
    const codes = Object.keys(errorMessageBundles[locale]).sort();
    assert.deepEqual(codes, [...NETWORK_ERROR_CODES].sort(), `error code mismatch for ${locale}`);
  }
});

test("no error message is empty in any locale", () => {
  for (const locale of RESOLVED_LOCALES) {
    for (const code of NETWORK_ERROR_CODES) {
      const value = errorMessageBundles[locale][code];
      assert.ok(value && value.length > 0, `empty error message: ${locale}.${code}`);
    }
  }
});

test("formatTemplate interpolates placeholders and leaves unknowns intact", () => {
  assert.equal(formatTemplate("no params"), "no params");
  assert.equal(formatTemplate("{count} 个", { count: 3 }), "3 个");
  assert.equal(formatTemplate("HTTP {status}", { status: 404 }), "HTTP 404");
  assert.equal(formatTemplate("{a} {b}", { a: "x" }), "x {b}");
  assert.equal(formatTemplate("{n}", { n: 0 }), "0");
});

test("translateUi returns the locale-specific message with interpolation", () => {
  assert.equal(translateUi("en", "tab.settings"), "Settings");
  assert.equal(translateUi("zh-Hans", "tab.settings"), "设置");
  assert.equal(translateUi("en", "agents.summary.count", { count: 5 }), "5");
  assert.equal(translateUi("zh-Hans", "agents.summary.count", { count: 5 }), "5 个");
});

test("translateError localizes codes and interpolates status", () => {
  assert.equal(translateError("en", "connect_failed"), "Unable to connect to daemon");
  assert.equal(translateError("zh-Hans", "connect_failed"), "无法连接 daemon");
  assert.equal(translateError("en", "daemon_http", { status: 500 }), "daemon returned HTTP 500");
  assert.equal(translateError("zh-Hans", "daemon_http", { status: 500 }), "daemon 返回 HTTP 500");
});

test("translateError works for every code in both locales", () => {
  for (const locale of RESOLVED_LOCALES) {
    for (const code of NETWORK_ERROR_CODES) {
      const value = translateError(locale, code, { status: 418 });
      assert.ok(value.length > 0, `missing translation: ${locale}.${code}`);
    }
  }
});
