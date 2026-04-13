import type { TaskAgentManifest } from "./types";

export interface TaskAgentPluginSettingsSlice {
	taskAgentsEnabled: boolean;
	taskAgentOverrides: Record<string, boolean>;
}

export function isTaskAgentRunnable(
	manifest: TaskAgentManifest,
	settings: TaskAgentPluginSettingsSlice,
): boolean {
	if (!settings.taskAgentsEnabled) return false;
	const o = settings.taskAgentOverrides[manifest.id];
	if (o === false) return false;
	if (o === true) return true;
	return manifest.enabledDefault;
}
