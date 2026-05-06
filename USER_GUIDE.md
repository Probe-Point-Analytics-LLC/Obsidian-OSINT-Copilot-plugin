# OSINT Copilot Plugin - User Guide

## Table of Contents

1. [Introduction](#introduction)
2. [Installation](#installation)
3. [Configuration](#configuration)
4. [Core Features](#core-features)
5. [Workflow Examples](#workflow-examples)
6. [Troubleshooting](#troubleshooting)
7. [Tips and Best Practices](#tips-and-best-practices)

---

## Introduction

**OSINT Copilot** helps **SOC analysts**, **threat intelligence researchers**, and **investigators** work inside Obsidian with a **local-first** model:

1. **Local workspace** — Entities, relationships, graph, timeline, and map are **Markdown in your vault** (default entity folder `OSINTCopilot/`). No cloud account is required for these.
2. **Local AI** — Chat always uses a **unified agent turn**: **Claude Code** by default, or **Hermes Agent** / **custom runtimes** from Settings. The **chat header** runtime dropdown lists reachable CLIs (**Agent runtime**). The agent returns JSON (`answer_markdown`, optional `graph_operations`, `retrieval_hits`, optional `custom_vault_operations`); the plugin applies proposed vault/graph changes only after you confirm. **Vault prompts** under **`OSINTCopilot/custom/`** augment the agent. **Chat history** defaults to **`OSINTCopilot/conversations/`**.
3. **No remote investigation API** — This build does not call a vendor backend for reports, dark-web jobs, digital-footprint search, or hosted evidence analysis. AI calls go through your selected **local** CLI (Claude Code and/or Hermes as configured).

### Who is this for?

- SOC analysts and IR teams documenting cases in Obsidian  
- Threat intel researchers building entity-centric notes  
- Anyone who wants **graph + timeline + map** on top of structured investigation notes  

---

## Installation

### Method 1: BRAT (recommended)

1. **Settings → Community plugins** — disable **Restricted mode** / safe mode so third-party plugins are allowed.  
2. **Browse** — install and enable **BRAT** (TfTHacker).  
3. **Settings → BRAT → Add Beta plugin** — paste:

   `https://github.com/Probe-Point-Analytics-LLC/Obsidian-OSINT-Copilot-plugin`

4. **Settings → Community plugins** — enable **OSINT Copilot**.  
5. BRAT stores files under `.obsidian/plugins/` (folder name may be `osint-copilot` or similar). Ensure `main.js`, `manifest.json`, and `styles.css` are present, then restart if the plugin does not load.

**If BRAT install fails:**
- Re-add the exact repo URL in BRAT:
  `https://github.com/Probe-Point-Analytics-LLC/Obsidian-OSINT-Copilot-plugin`
- Ensure only one active OSINT Copilot folder is enabled under `.obsidian/plugins/`
- Verify `main.js`, `manifest.json`, `styles.css` exist directly in that folder
- Reload/restart Obsidian

### Method 2: Manual install

1. Download **`main.js`**, **`manifest.json`**, and **`styles.css`** from [GitHub Releases](https://github.com/Probe-Point-Analytics-LLC/Obsidian-OSINT-Copilot-plugin/releases).  
2. Create **one** folder under `<vault>/.obsidian/plugins/`, e.g. `osint-copilot` or `Obsidian-OSINT-Copilot-plugin`.  
3. Copy the **three files** into that folder (not nested deeper).  
4. **Reload** plugins or restart Obsidian, then enable **OSINT Copilot**.

### Method 3: Build from source

```bash
git clone https://github.com/Probe-Point-Analytics-LLC/Obsidian-OSINT-Copilot-plugin.git
cd Obsidian-OSINT-Copilot-plugin
npm install
npm run build
```

Copy `main.js`, `manifest.json`, and `styles.css` from the repo root into your vault’s plugin folder as in Method 2.

### Verify installation

- Ribbon icons for **chat**, **graph**, **timeline**, **map** (when graph features are enabled)  
- **Command Palette** (`Ctrl/Cmd + P`) — commands starting with **OSINT Copilot**  
- **Settings → OSINT Copilot**  

---

## Configuration

Open **Settings → OSINT Copilot**.

### 1. Unified chat agent (Claude default, Hermes/custom optional)

Under **Settings → OSINT Copilot → Unified chat agent**:

| Setting | Purpose |
|--------|---------|
| **Agent runtime** | **Claude Code** (default), **Hermes Agent**, or any enabled **custom runtime** — which CLI receives the unified JSON prompt on stdin. |
| **Hermes CLI path** / **extra args** / **timeout** / **health-check args** | Used only when Agent runtime is **Hermes**. Extra args are split on whitespace and prepended before stdin is sent (your Hermes build may require a subcommand — set it here). |
| **Custom runtimes** | Add/remove custom CLI runtimes in Settings. Each runtime has display name, id, path, args, timeout, health-check args, and enabled toggle. Enabled + reachable runtimes appear in the chat header dropdown. |
| **Test agent runtime** | Health check for the **selected** runtime. |

Runtime-specific controls are now conditional: Hermes fields show only when **Hermes** is selected, custom runtime fields show only when that **custom runtime** is selected, and Claude selection shows a pointer to Claude CLI/model controls.

Install **Claude Code** per [Anthropic’s Claude Code documentation](https://docs.anthropic.com/en/docs/claude-code). For **Hermes**, install your Hermes Agent CLI and point **Hermes CLI path** at it; adjust **extra args** so the process accepts a prompt on stdin and prints **one JSON object** matching schema version `osint_copilot_agent_turn_v1` (see developer docs / `build-unified-agent-prompt.ts`).

**Graph extraction (Claude Code)** settings configure the `claude` binary used for **bulk** extraction (vault ingest, attachment pipeline, task agents) and for unified chat when **Agent runtime** is Claude.

### 1b. Claude Code CLI (graph extraction & fallback)

- **Claude Code CLI path** — Default `claude` if the binary is on your `PATH`; otherwise the full path to the executable.  
- **Model** — Passed through to the CLI (e.g. `sonnet`).  

Used for **entity extraction** when not using the unified Hermes-only setup, and for **task agents**. When **Agent runtime** is Claude, unified chat also uses this service.

### 2. Vault prompts (first run + edits)

On load, the plugin creates missing files under **`OSINTCopilot/custom/prompts/`** (path configurable):

| Path | Purpose |
|------|---------|
| `rules/global.md` | Extra instructions merged into the **unified agent** prompt |
| `agents/<id>.md` | **Agent** body + YAML frontmatter (`id`, `name`, …) |
| `skills/graph-extraction.md` | Instructions for **entity/graph extraction** |

**Settings:** **Prompts folder**, **Active agent id** (matches `agents/<id>.md`).

**Commands:** **Reload vault prompts**; **Install missing vault prompt files** (adds defaults without overwriting your edits).

### 3. HTTP enrichers (strict approval)

Use command **OSINT Copilot: Draft HTTP enricher skill from API documentation** to draft API enrichers as tools.

- Draft flow prompts with **Install** / **Cancel** before any create/update write to the enricher JSON and companion skill.
- Specs are stored in `OSINTCopilot/custom/enrichers/*.json`.
- Companion skill docs are stored in `OSINTCopilot/custom/skills/*.md`.
- Planner tool IDs are exposed as `ENRICH_<id>`.
- Store secrets in the vault **credentials** folder and reference them with `bearer_vault` / `header_vault` / `query_vault` in the enricher JSON (or use `*_env` types if you manage keys outside the vault). Never paste API keys into chat, skills, or `answer_markdown`.

**Unified chat — calling enrichers without Bash:** The agent’s JSON response can include `enricher_invocations`, e.g. `[{ "enricher_id": "leakcheck", "query": "user@domain.com" }]`. The plugin then runs those HTTP requests **inside Obsidian** (Node), so you do not need `curl` or shell approval. Prefer this for APIs like LeakCheck instead of vault skills that tell Claude Code to run terminal commands.

**Id must match the spec:** `enricher_id` is resolved with the same rules as the `id` field inside each `OSINTCopilot/custom/enrichers/*.json` file (normalized to lowercase and hyphenated). The model’s guessed name is not enough — e.g. `leakcheck_v2` in the agent JSON will not resolve if your file only has `"id": "leakcheck"`. If you see **Unknown enricher**, check the message’s **Available enricher ids** line or copy `id` exactly from the JSON. The chat progress bar shows **Enricher i/n** while enrichers run.

**Truthfulness:** The markdown answer is produced before enrichers run. Read **Plugin status** and **Enricher results** at the bottom for what actually happened.

**If you see “Shell execution blocked” / Bash approval:** Claude Code is trying to run `curl` or other shell from a skill. Obsidian has no terminal to click **Allow**. Fix by (1) using an enricher JSON + `enricher_invocations`, or (2) only if you accept the risk: **Settings → OSINT Copilot → Graph extraction (Claude Code) → Claude Code extra CLI args** — for example `--permission-mode bypassPermissions` (see [Anthropic permission modes](https://docs.anthropic.com/en/docs/claude-code/permission-modes)). That disables interactive gating and allows unattended shell; use only in environments you trust.

Detailed setup + example spec mapping: `docs/ENRICHERS_SETUP.md`.

### 4. Skills folder (vault skills)

Default **`OSINTCopilot/custom/skills`**. On first run the plugin creates **`README.md`** and **`example-skill.md`** if missing.

Each file uses YAML frontmatter (`skill_kind: vault`, `id`, `name`, `description`) plus a body. The unified agent can propose creating or updating skills via **`custom_vault_operations`** (confirm in chat); HTTP enrichers also use companion skills in this folder.

**Settings:** **Skills folder** under **OSINT Copilot**.

### 3b. Custom YAML types (Person, Company, relationships)

For a detailed custom-type setup guide with complete YAML examples, see:

- [`docs/CUSTOM_TYPES_SETUP.md`](docs/CUSTOM_TYPES_SETUP.md)

### 4. Entity base path

Default **`OSINTCopilot`**. Entity types become subfolders; **`Connections/`** holds relationship notes.

### 5. Conversation folder

Default **`OSINTCopilot/conversations`**. Each chat is a **Markdown** note with metadata and messages stored in an embedded **JSON** block (human-readable plus machine-parseable).

### 6. Max notes

Caps how many notes are pulled into context for **local search** and related flows (typical range **5–30**).

### 7. System prompt

Default text for vault-oriented answers; combine with **vault rules/agents** for orchestration.

### What needs what?

| Capability | Local AI |
|------------|----------|
| Graph / timeline / map | No (pure Obsidian) |
| Default chat (unified agent) | **Claude Code** by default; can switch to **Hermes** or enabled **custom runtime** (Settings → Agent runtime) |
| Bulk graph extraction / vault ingest / task agents | **Claude Code** CLI (Graph extraction settings) |

---

## Core Features

### First Investigation Workflow (recommended)

1. Open **OSINT Copilot: Open Chat**.
2. Attach source files/images and send a focused prompt.
3. Watch progress and expand **Extraction logs** for diagnostics.
4. Review/confirm proposed graph changes.
5. Open Graph/Timeline/Map views to validate entities and links.

If extraction fails with Claude access messages, fix CLI auth first (see Troubleshooting), then retry the same workflow.

### Opening the OSINT Copilot Interface

Access the main chat interface via:
- **Ribbon Icon**: Click the OSINT Copilot icon in the left sidebar
- **Command Palette**: `Ctrl/Cmd + P` → "OSINT Copilot: Open Chat"

### Orchestration and runtime

Each message runs **one** **Agent runtime** turn (Claude, Hermes, or custom CLI). The process prints JSON matching `osint_copilot_agent_turn_v1` so the plugin can show **proposed graph changes** and optional **vault skill/credential** proposals for you to confirm. Behavior follows your **message and attachments** plus **vault prompts** (`rules/global.md`, agents) as **vault augmentation**.

Vault markdown skills live under **`OSINTCopilot/custom/skills/`**; you can add files by hand or approve agent-proposed **`custom_vault_operations`**.

---

### Feature 1: Vault Q&A (unified agent)

**Purpose:** Ask questions over your vault.

Type your question; the selected **Agent runtime** returns Markdown plus optional retrieval hits and optional graph or vault proposals.

**Tips:** Use **Reload vault prompts** after editing rules under `OSINTCopilot/custom/prompts/`.

**Example Queries**:
```
What do we know about APT29's infrastructure?
Summarize the IOCs from the SolarWinds investigation
What TTPs are associated with Lazarus Group?
```

**Response Format**:
- AI-generated answer based on your notes
- "Referenced notes" section with clickable links
- Real-time streaming for faster feedback

---

### Feature 2: Entity Graph

**Purpose**: Visualize relationships between entities (threat actors, infrastructure, campaigns) as an interactive graph.

**Accessing the Graph**:
- **Command Palette**: "OSINT Copilot: Open Graph View"
- **Ribbon**: Click the graph icon

**Entity Types Supported**:

| Type | Color | Use Case |
|------|-------|----------|
| Person | Blue | Threat actors, researchers, contacts |
| Company | Green | Organizations, APT groups |
| Event | Orange | Incidents, campaigns, attacks |
| Location | Purple | Geographic locations, countries |
| Email | Cyan | Email addresses |
| Phone | Pink | Phone numbers |
| Username | Yellow | Online handles, aliases |
| Vehicle | Brown | Vehicles (for physical investigations) |
| Website | Teal | Domains, URLs, C2 infrastructure |
| Evidence | Red | Digital evidence, artifacts |
| Image | Magenta | Screenshots, photos |
| Text | Gray | Text snippets, notes |

**Graph Interactions**:
- **Click** an entity to view its note
- **Drag** to reposition nodes
- **Box Select** to select multiple entities
- **Right-click** for context menu options
- **Zoom/Pan** with mouse wheel and drag

**Graph workspaces**: Use the **Graph** dropdown in the graph toolbar to switch between saved layouts (each workspace stores its own node positions in `OSINTCopilot/graph-positions.json`). **+ new** creates another workspace; **✕** removes the current one (not **Default**).

**Provenance (confidence)**:
- Entity notes include optional YAML: **`osint_sources`**, **`osint_confidence`**, **`osint_contradictions`** (see graph extraction and orchestration flows).
- **`osint_confidence`** is one of: `unverified`, `low`, `medium`, `high`, `conflicted`.
- The graph toolbar has **Confidence** checkboxes to show or hide nodes by level. **Conflicted** nodes are styled with a stronger, distinct border.
- When the assistant creates graph entities without explicit citations, the plugin still writes **inferred** source rows so nothing is “sourceless.”
- For HTTP(S) URLs in `osint_sources`, the plugin may resolve an **Internet Archive** snapshot URL in the background and store it as **`archive_url`** on that source.

**Locking notes from the graph**:
- Enter **box select**, select entities and/or relationship edges, then click **🔒 lock area**. Those notes become **read-only** in Obsidian (preview only; edit actions hidden) until you **unlock** via the lock button in the note header or **Unlock all** under plugin settings (**Graph note lock**).
- **Orchestration** and **task agents** will not overwrite locked paths. Deleting or editing entities through the plugin is blocked until unlock.
- Locks are stored in plugin data (paths survive restarts). Renaming a locked note in the vault updates the lock entry. Deleting a file outside the plugin still removes the file from disk.

**Creating Entities**:
1. In chat, describe extraction intent and attach or paste source text; the unified agent runtime handles extraction via the JSON contract (`graph_operations`) when appropriate.
2. Manually create via Command Palette: "Create Entity"
3. Entities are saved as markdown notes with YAML frontmatter

**YAML export (FollowTheMoney-style mirror)** — The plugin also maintains **`<entity base path>/graph-yaml/`** (e.g. `OSINTCopilot/graph-yaml/`): one **`.yaml` file per entity** under `entities/<schemaFamily>/<type>/<id>.yaml`, and one **per connection** under `connections/<id>.yaml`. These files are **auto-synced** when you create, edit, or delete graph data (and refreshed after load). Edit the **Markdown notes** for day-to-day work; use the YAML folder for diffs, scripts, or external FTM-style tooling.

**Multi-schema types (FTM, STIX 2, MITRE, user YAML)**:
- **FTM (FollowTheMoney)** types ship inside the plugin. **STIX 2**- and **MITRE ATT&CK**-style starter types load from vault YAML under `OSINTCopilot/schemas/` (default files are created on first run if missing).
- Add or override definitions in `OSINTCopilot/schemas/user/` using `.yaml` with `family: user` (see `schemas/README.md` in the vault).
- Under plugin settings (**Graph view** → **Schema families in type pickers**), choose which families appear in the entity and connection type dialogs.
- New notes are stored under `OSINTCopilot/<family>/<type>/` (for example `ftm/Person/` or `stix2/threat-actor/`). Older vaults that use the flat layout `OSINTCopilot/Person/` still work; those notes are treated as **FTM** unless frontmatter sets `schemaFamily`.
- **Custom FTM types** in `OSINTCopilot/custom/custom-types.json` continue to work as before. Editing files under `schemas/` triggers a catalog refresh (or reload the plugin).

**Standards and format references**
- **FollowTheMoney (FTM):** [https://followthemoney.tech](https://followthemoney.tech)
- **STIX 2.1 (OASIS CTI):** [https://oasis-open.github.io/cti-documentation/stix/intro](https://oasis-open.github.io/cti-documentation/stix/intro)
- **MITRE ATT&CK:** [https://attack.mitre.org](https://attack.mitre.org)

**How this maps to the settings shown in Graph view**
- **Schema families in type pickers** = select schema *sources* (bundled FTM/OIDSF, vault `stix2`, vault `mitre`, vault `user`).
- **OIDSF bundled schema layers** = filter only bundled OIDSF-derived classes:
  - `World` = common OSINT entities
  - `Links` = relationship/interval classes
  - `Cyber` = STIX/CTI-aligned bundled classes
  - `Analysis` = analytic objects (claims, ACH, evidence-chain style)

These filters affect type pickers; they do not delete existing notes. Existing entities in the vault continue to resolve in graph rendering.

---

### Feature 3: Entity extraction (graph generation)

**Purpose:** Turn unstructured text into **entity notes** and **relationships** using **Claude Code CLI**. Extraction instructions can be edited in **`OSINTCopilot/custom/prompts/skills/graph-extraction.md`**.

**How to use**
**Extraction logs panel**
- During attachment processing, open **Extraction logs** on the assistant message.
- `minimal` verbosity: milestones only.
- `detailed` verbosity: stage-level log events + sanitized snippets.
- Optional debug: **Extraction debug: raw CLI output** (use only for troubleshooting; may expose sensitive content).

Settings path: **Settings → OSINT Copilot → Graph extraction (Claude Code)**.
1. Attach files, paste a URL (or text), and say clearly if you want entities extracted into the graph.
2. Ensure the assistant message has attachment/context so extraction has material to work with.
3. Bulk vault ingest and the attachment pipeline use **local** `claude` with **Graph extraction** settings; default chat uses your selected **Agent runtime** (Claude, Hermes, or custom) for the unified JSON turn.

**Extracted Information**:
- Entity type and properties
- Relationships between entities (e.g., "director_of", "controls_wallet")
- Optional **`sources`** per entity and per connection in the extraction JSON (URL or vault path, rationale, optional structured **claims**). The plugin derives persisted **`osint_confidence`** from sources and detected disagreements (`conflicted` when material fields disagree).

**Relationship Types**:
```
director_of, shareholder_of, subsidiary_of, controls_wallet,
member_of, employed_by, associated_with, located_at,
owns, operates, communicates_with, targets, and more...
```

---

### Feature 4: Timeline View

**Purpose**: Visualize events chronologically for incident timeline analysis.

**Accessing Timeline**:
- **Command Palette**: "OSINT Copilot: Open Timeline View"

**Features**:
- Displays Event entities with dates
- Color-coded by entity type
- Click events to open associated notes
- Zoom and pan through time periods

**Best For**:
- Incident timelines
- Campaign tracking
- Attack sequence analysis

---

### Feature 5: Map View

**Purpose**: Visualize Location entities geographically using Leaflet maps.

**Accessing Map**:
- **Command Palette**: "OSINT Copilot: Open Map View"

**Features**:
- Displays Location entities with coordinates
- Interactive markers
- Click to view location details
- Zoom and pan controls

**Best For**:
- Geographic threat analysis
- Infrastructure mapping
- Physical security investigations

---

### Feature 6: Conversation Management

**Purpose**: Organize and persist your research conversations.

**Sidebar Features**:
- Toggle sidebar with ☰ button
- View all saved conversations
- Timestamps and previews (mode is stored per conversation)

**Actions**:
- **New Chat**: Start fresh conversation
- **Rename**: ✏️ button to rename conversations
- **Delete**: 🗑️ button to remove conversations
- **Load**: Click any conversation to resume

**Persistence**:
- Conversations saved as Markdown files with embedded JSON
- Survives Obsidian restarts
- Includes mode settings and chat history

---

## Workflow Examples

### Example 1: Investigating a Threat Actor

**Scenario**: You need to research APT29 (Cozy Bear) for a threat briefing.

**Steps**:

1. **Gather initial intelligence**
   - Select **Local search** and ask: "What do we know about APT29?"
   - Review the answer and referenced notes

2. **Structure findings**
   - Switch to **Graph generation** and paste new intel (or summarize in chat first, then extract)
   - Confirm entities and relationships in your vault

3. **Visualize relationships**
   - Open Graph View
   - Explore connections between APT29 and related entities
   - Identify infrastructure patterns

### Example 2: IOC Analysis

**Scenario**: You received a list of suspicious IPs and domains to investigate.

**Steps**:

1. **Extract entities**
   - Select **Graph generation**
   - Paste your IOC list:
     ```
     Suspicious IPs: 192.168.1.100, 10.0.0.50
     Domains: malware-c2.evil.com, phishing-site.bad.org
     Email: attacker@phishing.bad
     ```
   - Entities are automatically created

2. **Research each IOC**
   - Select **Local search**
   - Query: "What do we know about malware-c2.evil.com?"
   - Cross-reference with your existing notes

3. **Document findings**
   - Write a summary note in the vault or ask **General agent** to draft a structured summary from context
   - Keep entities linked via the graph and connections notes

### Example 3: Incident Response Documentation

**Scenario**: Document a security incident as it unfolds.

**Steps**:

1. **Create an event entity**
   - Use **Graph generation** with incident text to create an **Event** (and related entities)
   - Include date, description, and initial findings

2. **Link Related Entities**
   - As you identify IOCs, create entities
   - Relationships are automatically tracked

3. **Build Timeline**
   - Open Timeline View
   - Visualize incident progression
   - Identify attack sequence

4. **Write the incident report**
   - Use **General agent** or **Local search** with your vault context, or compose a note manually from the timeline and entities



---

## Troubleshooting

### Claude Code CLI (local AI)

**Problem:** Extraction or Q&A fails with CLI / spawn errors.

**Solutions:**
1. In a terminal run `claude --version` (or your full path).  
2. **Settings → OSINT Copilot** — set **Claude Code CLI path** to that executable.  
3. Complete Anthropic’s login / API setup for Claude Code.  
4. Restart Obsidian after changing PATH or installing the CLI.

If you see `organization does not have access`, this is an account/org entitlement issue in Claude CLI, not a vault path issue.

**Problem:** Old behavior cached after editing vault prompts.

**Solutions:** Run command **OSINT Copilot: Reload vault prompts** or restart Obsidian.

**Problem:** After updating the plugin, settings still point at old **`.osint-copilot/`** paths.

**Solutions:** New installs default to **`OSINTCopilot/conversations/`** and **`OSINTCopilot/custom/`** (prompts, skills, task agents, outputs). Either update **Settings → OSINT Copilot** paths manually or move your existing folders in the vault file explorer to match the new defaults, then reload.

---

### Entity Creation Failures

**Problem**: Entities not being created or "Unknown entity type" errors

**Solutions**:
1. Ensure the Entity Base Path exists in your vault
2. Check that the entity type is valid (Person, Company, Event, etc.)
3. Review the console (Ctrl+Shift+I) for detailed error messages
4. Verify you have write permissions to the vault folder

### YAML duplicate-key parse warnings (graph skipping entities/connections)

**Problem:** warnings like `YAML parse failed` from duplicate frontmatter keys (often `type`).

**Fix:**
1. Run command: **OSINT Copilot: Normalize entity frontmatter reserved keys (props namespace)**.
2. Then run **Reload entities from notes**.
3. Re-open Graph view.

**What changed:** colliding properties are now stored under `props.<key>` so top-level reserved keys remain unique.

---

### Plugin not loading

**Problem:** Plugin does not appear or fails to enable.

**Solutions:**
1. Confirm `main.js`, `manifest.json`, and `styles.css` are **directly** inside **one** folder under `.obsidian/plugins/` (e.g. `osint-copilot`).  
2. **Community plugins** — restricted mode off; plugin toggle on.  
3. Obsidian **1.5.0+** (see `manifest.json` `minAppVersion`).  
4. Restart Obsidian; open developer console (`Ctrl/Cmd + Shift + I`) for errors.

---

### Slow Performance

**Problem**: Plugin is slow or Obsidian becomes unresponsive

**Solutions**:
1. Reduce "Max Notes" setting (try 5-10)
2. Close unused views (Graph, Timeline, Map)
3. Large vaults may take time to index initially
4. Consider excluding large folders from indexing

---

## Tips and Best Practices

### Organizing Your Research

1. **Use Consistent Naming**
   - Name entity notes descriptively
   - Use prefixes for easy filtering (e.g., "APT-", "IOC-", "INC-")

2. **Leverage Tags**
   - Tag notes with relevant categories
   - Use tags like `#threat-actor`, `#malware`, `#campaign`
   - Tags improve search and Q&A accuracy

3. **Structure Your Vault**
   ```
   Vault/
   ├── Entities/
   │   ├── Person/
   │   ├── Company/
   │   ├── Event/
   │   └── ...
   ├── Reports/
   ├── Investigations/
   └── OSINT-Copilot-Conversations/
   ```

### Maximizing AI Accuracy

1. **Be Specific in Queries**
   - ❌ "Tell me about the attack"
   - ✅ "What TTPs did APT29 use in the SolarWinds campaign?"

2. **Provide Context**
   - Reference specific entities or timeframes
   - Mention relevant campaigns or incidents

3. **Iterate on Results**
   - Ask follow-up questions
   - Request clarification or more detail
   - Use **Graph generation** to capture key findings

### Building Knowledge Over Time

1. **Create Entities Consistently**
   - Use **Graph generation** regularly to build your knowledge base
   - Relationships accumulate and become more valuable

2. **Review Graph Periodically**
   - Visualize connections to spot patterns
   - Identify gaps in your research

3. **Summarize periodically**
   - Use **Local search** or **General agent** to produce summaries from your vault notes

### Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Send message | Enter |
| New line in message | Shift + Enter |
| Open Command Palette | Ctrl/Cmd + P |
| Open Settings | Ctrl/Cmd + , |

### Security considerations

1. **Claude** — Text you send in chat is processed by **Claude Code** per Anthropic’s terms.  
2. **Vault** — Entities, conversations, and `OSINTCopilot/custom/` (prompts, skills, etc.) are normal Markdown/JSON on disk.  
3. **Geocoding** — Map view may send address strings to **Nominatim** (OpenStreetMap); see README privacy section.

### Vault prompts hygiene

- Keep `rules/global.md` short and policy-aligned.  
- Use **Reload vault prompts** after edits.  
- Use **Install missing vault prompt files** to restore defaults you deleted (does not overwrite edits).

---

## Getting help

- **README.md** — Overview, BRAT install, privacy summary  
- **This guide** — Configuration and features  
- **GitHub** — [Obsidian-OSINT-Copilot-plugin](https://github.com/Probe-Point-Analytics-LLC/Obsidian-OSINT-Copilot-plugin) issues and releases  

---

*OSINT Copilot — local-first investigation workspace with Claude Code CLI. See `manifest.json` for the current plugin version.*