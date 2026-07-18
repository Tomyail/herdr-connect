import assert from "node:assert/strict";
import test from "node:test";

import {
  APPEARANCE_CHOICES,
  isAppearanceChoice,
  parseStoredAppearance,
  resolveTheme,
} from "./appearance";

test("isAppearanceChoice accepts exactly the selectable choices", () => {
  for (const choice of APPEARANCE_CHOICES) {
    assert.ok(isAppearanceChoice(choice), `expected valid: ${choice}`);
  }
  assert.equal(isAppearanceChoice("auto"), false);
  assert.equal(isAppearanceChoice(""), false);
  assert.equal(isAppearanceChoice(undefined), false);
  assert.equal(isAppearanceChoice(0), false);
});

test("parseStoredAppearance falls back to system for unknown values", () => {
  assert.equal(parseStoredAppearance("light"), "light");
  assert.equal(parseStoredAppearance("dark"), "dark");
  assert.equal(parseStoredAppearance("system"), "system");
  assert.equal(parseStoredAppearance("blue"), "system");
  assert.equal(parseStoredAppearance(undefined), "system");
  assert.equal(parseStoredAppearance(null), "system");
});

test("an explicit choice wins regardless of the device scheme", () => {
  assert.equal(resolveTheme("light", "dark"), "light");
  assert.equal(resolveTheme("dark", "light"), "dark");
  assert.equal(resolveTheme("dark", null), "dark");
});

test("system follows the device scheme and defaults to light", () => {
  assert.equal(resolveTheme("system", "dark"), "dark");
  assert.equal(resolveTheme("system", "light"), "light");
  assert.equal(resolveTheme("system", null), "light");
  assert.equal(resolveTheme("system", undefined), "light");
});
