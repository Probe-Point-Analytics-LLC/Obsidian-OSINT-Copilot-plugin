// eslint.config.mjs
import tsparser from "@typescript-eslint/parser";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

// Extract rules from recommended config (assuming it's a rule object or contains them)
const recommendedRules = obsidianmd.configs.recommended.rules || obsidianmd.configs.recommended;

// Filter out non-rule keys just in case (like 'plugins' or 'extends' if they exist at top level)
const rules = {};
for (const [key, value] of Object.entries(recommendedRules)) {
    if (key.includes('/')) { // Simple heuristic: plugin rules usually contain '/'
        rules[key] = value;
    }
}

export default [
    {
        files: ["**/*.ts"],
        languageOptions: {
            parser: tsparser,
            parserOptions: { project: "./tsconfig.json" },
        },
        plugins: {
            "obsidianmd": obsidianmd,
            "@typescript-eslint": tseslint.plugin
        },
        rules: {
            ...rules,
            // User requested overrides
            "obsidianmd/sample-names": "off",
            "obsidianmd/prefer-file-manager-trash-file": "error",
            "@typescript-eslint/no-explicit-any": "warn",
            "obsidianmd/ui/sentence-case": ["error", { "allowAutoFix": true }],
            "obsidianmd/no-static-styles-assignment": "warn"
        }
    }
];
