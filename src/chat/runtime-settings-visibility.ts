import { CLAUDE_RUNTIME_ID, HERMES_RUNTIME_ID } from "../services/agent-runtime/runtime-registry";

export interface RuntimeSettingsVisibility {
	showClaudeRuntimeHint: boolean;
	showHermesSettings: boolean;
	showSelectedCustomSettings: boolean;
}

export function runtimeSettingsVisibility(selectedRuntimeId: string): RuntimeSettingsVisibility {
	const isCustom = typeof selectedRuntimeId === "string" && selectedRuntimeId.startsWith("custom:");
	return {
		showClaudeRuntimeHint: selectedRuntimeId === CLAUDE_RUNTIME_ID,
		showHermesSettings: selectedRuntimeId === HERMES_RUNTIME_ID,
		showSelectedCustomSettings: isCustom,
	};
}
