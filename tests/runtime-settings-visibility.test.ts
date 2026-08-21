import { describe, it, expect } from "vitest";
import { runtimeSettingsVisibility } from "../main";

describe("runtimeSettingsVisibility", () => {
  it("shows Claude hint only for Claude runtime", () => {
    expect(runtimeSettingsVisibility("claude-code")).toEqual({
      showClaudeRuntimeHint: true,
      showCodexRuntimeHint: false,
      showHermesSettings: false,
      showSelectedCustomSettings: false,
    });
  });

  it("shows Codex hint only for Codex runtime", () => {
    expect(runtimeSettingsVisibility("codex")).toEqual({
      showClaudeRuntimeHint: false,
      showCodexRuntimeHint: true,
      showHermesSettings: false,
      showSelectedCustomSettings: false,
    });
  });

  it("shows Hermes settings only for Hermes runtime", () => {
    expect(runtimeSettingsVisibility("hermes-agent")).toEqual({
      showClaudeRuntimeHint: false,
      showCodexRuntimeHint: false,
      showHermesSettings: true,
      showSelectedCustomSettings: false,
    });
  });

  it("shows custom settings only for custom runtime ids", () => {
    expect(runtimeSettingsVisibility("custom:my-runtime")).toEqual({
      showClaudeRuntimeHint: false,
      showCodexRuntimeHint: false,
      showHermesSettings: false,
      showSelectedCustomSettings: true,
    });
  });
});
