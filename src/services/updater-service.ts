import { App, Notice, requestUrl, Plugin } from "obsidian";

interface GitHubRelease {
    tag_name: string;
    assets: GitHubAsset[];
}

interface GitHubAsset {
    name: string;
    browser_download_url: string;
}

export class UpdaterService {
    private plugin: Plugin;
    private app: App;
    private readonly REPO_URL = "https://api.github.com/repos/Probe-Point-Analytics-LLC/Obsidian-OSINT-Copilot-plugin/releases/latest";

    private readonly PLUGIN_FOLDER = ".obsidian/plugins/osint-copilot";

    constructor(plugin: Plugin) {
        this.plugin = plugin;
        this.app = plugin.app;
    }

    /**
     * Checks GitHub for the latest release and compares it with the current version.
     * Returns the release object if a newer version exists, otherwise null.
     */
    async checkLatestRelease(): Promise<GitHubRelease | null> {
        try {
            const response = await requestUrl({ url: this.REPO_URL });

            if (response.status !== 200) {
                console.error("Failed to fetch latest release from GitHub", response.text);
                return null;
            }

            const release: GitHubRelease = response.json;
            const latestVersion = release.tag_name.replace(/^v/, "");
            const currentVersion = this.plugin.manifest.version;

            if (this.compareVersions(latestVersion, currentVersion) > 0) {
                return release;
            }
            return null;
        } catch (error) {
            console.error("Error checking for updates:", error);
            return null;
        }
    }

    /**
     * Downloads the release assets and overwrites the local plugin files.
     */
    async downloadReleaseAssets(release: GitHubRelease): Promise<boolean> {
        try {
            const assetsToDownload = ["main.js", "manifest.json", "styles.css"];

            for (const assetName of assetsToDownload) {
                const asset = release.assets.find(a => a.name === assetName);
                if (!asset) continue; // Not all releases might have styles.css

                const response = await requestUrl({ url: asset.browser_download_url });

                if (response.status === 200) {
                    const filePath = `${this.PLUGIN_FOLDER}/${assetName}`;
                    // Use Obsidian's File System Adapter to write binary data robustly
                    await this.app.vault.adapter.writeBinary(filePath, response.arrayBuffer);
                } else {
                    console.error(`Failed to download ${assetName}`);
                    return false;
                }
            }
            return true;
        } catch (error) {
            console.error("Error downloading release assets:", error);
            return false;
        }
    }

    /**
     * Reloads the plugin dynamically without requiring an Obsidian restart.
     */
    async reloadPlugin(): Promise<void> {
        try {
            const plugins = (this.app as any).plugins;
            const pluginId = this.plugin.manifest.id;

            // Disable the plugin in memory
            await plugins.disablePlugin(pluginId);

            // Small pause to ensure processes are cleared
            await new Promise(resolve => setTimeout(resolve, 500));

            // Re-enable the plugin
            await plugins.enablePlugin(pluginId);
        } catch (error) {
            console.error("Error reloading plugin:", error);
            new Notice("Error hot-reloading plugin. Please restart Obsidian.");
        }
    }

    /**
     * Downloads the newest version of the plugin directly from the GitHub main branch,
     * regardless of the last official release.
     */
    async updateFromMain(): Promise<boolean> {
        try {
            const baseUrl = "https://raw.githubusercontent.com/Probe-Point-Analytics-LLC/Obsidian-OSINT-Copilot-plugin/main";
            const filesToDownload = ["main.js", "manifest.json", "styles.css"];
            let success = true;

            for (const fileName of filesToDownload) {
                const url = `${baseUrl}/${fileName}`;
                const fileSuccess = await this.downloadRawFile(url, fileName);
                if (!fileSuccess && fileName !== "styles.css") {
                    // styles.css is optional, but main.js and manifest.json are critical
                    success = false;
                }
            }

            return success;
        } catch (error) {
            console.error("Error updating from main branch:", error);
            return false;
        }
    }

    /**
     * Downloads a raw file from GitHub and writes it to the plugin folder.
     */
    private async downloadRawFile(url: string, fileName: string): Promise<boolean> {
        try {
            const response = await requestUrl({ url });

            if (response.status === 200) {
                const filePath = `${this.PLUGIN_FOLDER}/${fileName}`;
                await this.app.vault.adapter.writeBinary(filePath, response.arrayBuffer);
                return true;
            } else {
                console.error(`Failed to download ${fileName} from ${url} (Status: ${response.status})`);
                return false;
            }
        } catch (error) {
            console.error(`Error downloading ${fileName}:`, error);
            return false;
        }
    }

    /**
     * Compares two semantic version strings.
     * Returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal.
     */
    compareVersions(v1: string, v2: string): number {
        const parts1 = v1.split('.').map(Number);
        const parts2 = v2.split('.').map(Number);

        for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
            const p1 = parts1[i] || 0;
            const p2 = parts2[i] || 0;
            if (p1 > p2) return 1;
            if (p1 < p2) return -1;
        }
        return 0;
    }
}
