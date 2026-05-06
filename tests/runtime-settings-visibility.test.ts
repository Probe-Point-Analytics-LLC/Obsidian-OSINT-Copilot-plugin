import { describe, it, expect } from "vitest";
import { runtimeSettingsVisibility } from "../main";

describe("runtimeSettingsVisibility", () => {
  it("shows Claude hint only for Claude runtime", () => {
    expect(runtimeSettingsVisibility("claude-code")).toEqual({
      showClaudeRuntimeHint: true,
      showHermesSettings: false,
      showSelectedCustomSettings: false,
    });
  });

  it("shows Hermes settings only for Hermes runtime", () => {
    expect(runtimeSettingsVisibility("hermes-agent")).toEqual({
      showClaudeRuntimeHint: false,
      showHermesSettings: true,
      showSelectedCustomSettings: false,
    });
  });

  it("shows custom settings only for custom runtime ids", () => {
    expect(runtimeSettingsVisibility("custom:my-runtime")).toEqual({
      showClaudeRuntimeHint: false,
      showHermesSettings: false,
      showSelectedCustomSettings: true,
    });
  });
});
