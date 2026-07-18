import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_LOCALE,
  isAppLanguage,
  localeForTime,
  parseStoredLanguage,
  resolveLocale,
  resolveSystemLocale,
} from "./locale";

test("resolveSystemLocale maps Simplified Chinese variants to zh-Hans", () => {
  for (const tag of ["zh-CN", "zh-Hans", "zh-Hans-CN", "zh-SG", "zh-MY"]) {
    assert.equal(resolveSystemLocale(tag), "zh-Hans", `expected ${tag} -> zh-Hans`);
  }
  assert.equal(resolveSystemLocale("ZH-cn"), "zh-Hans");
});

test("resolveSystemLocale does not substitute Simplified Chinese for Traditional Chinese", () => {
  for (const tag of ["zh", "zh-TW", "zh-Hant", "zh-Hant-TW", "zh-HK", "zh-MO"]) {
    assert.equal(resolveSystemLocale(tag), DEFAULT_LOCALE, `expected ${tag} -> English`);
  }
});

test("resolveSystemLocale maps English variants to en", () => {
  for (const tag of ["en", "en-US", "en-GB", "en-AU"]) {
    assert.equal(resolveSystemLocale(tag), "en", `expected ${tag} -> en`);
  }
});

test("resolveSystemLocale falls back to English for unsupported locales", () => {
  assert.equal(resolveSystemLocale("fr-FR"), DEFAULT_LOCALE);
  assert.equal(resolveSystemLocale("ja-JP"), DEFAULT_LOCALE);
  assert.equal(resolveSystemLocale("de"), DEFAULT_LOCALE);
  assert.equal(resolveSystemLocale("ko-KR"), DEFAULT_LOCALE);
});

test("resolveSystemLocale falls back to English for missing input", () => {
  assert.equal(resolveSystemLocale(undefined), DEFAULT_LOCALE);
  assert.equal(resolveSystemLocale(null), DEFAULT_LOCALE);
  assert.equal(resolveSystemLocale(""), DEFAULT_LOCALE);
});

test("resolveLocale honors explicit choices regardless of system locale", () => {
  assert.equal(resolveLocale("zh-Hans", "en-US"), "zh-Hans");
  assert.equal(resolveLocale("en", "zh-CN"), "en");
});

test("resolveLocale follows the system locale when choice is 'system'", () => {
  assert.equal(resolveLocale("system", "zh-CN"), "zh-Hans");
  assert.equal(resolveLocale("system", "en-US"), "en");
  assert.equal(resolveLocale("system", "fr-FR"), DEFAULT_LOCALE);
  assert.equal(resolveLocale("system", undefined), DEFAULT_LOCALE);
});

test("isAppLanguage accepts the three choices and rejects everything else", () => {
  for (const value of ["system", "zh-Hans", "en"]) {
    assert.equal(isAppLanguage(value), true, `expected ${value} to be valid`);
  }
  const invalid: unknown[] = ["zh", "zh_CN", "zh-Hant", "english", "", null, undefined, 0, {}];
  for (const value of invalid) {
    assert.equal(isAppLanguage(value), false, `expected ${JSON.stringify(value)} to be invalid`);
  }
});

test("parseStoredLanguage keeps valid choices and falls back to 'system'", () => {
  assert.equal(parseStoredLanguage("system"), "system");
  assert.equal(parseStoredLanguage("zh-Hans"), "zh-Hans");
  assert.equal(parseStoredLanguage("en"), "en");
  assert.equal(parseStoredLanguage("garbage"), "system");
  assert.equal(parseStoredLanguage("zh-CN"), "system");
  assert.equal(parseStoredLanguage(undefined), "system");
  assert.equal(parseStoredLanguage(null), "system");
});

test("localeForTime maps locales to BCP-47 time tags", () => {
  assert.equal(localeForTime("zh-Hans"), "zh-CN");
  assert.equal(localeForTime("en"), "en-US");
});
