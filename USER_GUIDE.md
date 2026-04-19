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
2. **Local AI** — **Orchestration** (planner + tools) uses the **Claude Code CLI** (`claude`) on your machine. Enable **Local search**, **Graph generation**, and **custom skills** from the chat **Skills** menu. Customization files live under **`OSINTCopilot/custom/`** (prompts, skills, task agents, outputs — visible in the vault). **Chat history** defaults to **`OSINTCopilot/conversations/`**.
3. **No remote investigation API** — This build does not call a vendor backend for reports, dark-web jobs, digital-footprint search, or hosted evidence analysis. All AI traffic goes through **Claude Code** when you use AI features.

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

### 1. Claude Code CLI (local AI)

- **Claude Code CLI path** — Default `claude` if the binary is on your `PATH`; otherwise the full path to the executable.  
- **Model** — Passed through to the CLI (e.g. `sonnet`).  

Install and authenticate per [Anthropic’s Claude Code documentation](https://docs.anthropic.com/en/docs/claude-code). Without a working CLI, **entity extraction** and most **vault Q&A / orchestration** paths will not run.

### 2. Vault prompts (first run + edits)

On load, the plugin creates missing files under **`OSINTCopilot/custom/prompts/`** (path configurable):

| Path | Purpose |
|------|---------|
| `rules/global.md` | Extra instructions for the **orchestration planner** |
| `agents/<id>.md` | **Agent** body + YAML frontmatter (`id`, `name`, …) |
| `skills/graph-extraction.md` | Instructions for **entity/graph extraction** |

**Settings:** **Prompts folder**, **Active agent id** (matches `agents/<id>.md`).

**Commands:** **Reload vault prompts**; **Install missing vault prompt files** (adds defaults without overwriting your edits).

### 3. Skills folder (custom planner skills)

Default **`OSINTCopilot/custom/skills`**. On first run the plugin creates **`README.md`** and **`example-skill.md`** if missing.

Each custom skill is a Markdown file with YAML frontmatter (`skill_kind: vault`, `id`, `name`, `description`). The orchestration planner may propose **`SKILL_<id>`** when that skill is enabled in the chat **Skills** menu.

**Settings:** **Skills folder** under **OSINT Copilot**.

### 4. Entity base path

Default **`OSINTCopilot`**. Entity types become subfolders; **`Connections/`** holds relationship notes.

### 5. Conversation folder

Default **`OSINTCopilot/conversations`**. Each chat is a **Markdown** note with metadata and messages stored in an embedded **JSON** block (human-readable plus machine-parseable).

### 6. Max notes

Caps how many notes are pulled into context for **local search** and related flows (typical range **5–30**).

### 7. System prompt

Default text for vault-oriented answers; combine with **vault rules/agents** for orchestration.

### What needs what?

| Capability | Claude CLI |
|------------|------------|
| Graph / timeline / map | No |
| Graph generation (extract entities from pasted text) | Yes |
| Local search (vault Q&A) | Yes |
| General agent (orchestration) | Yes |

---

## Core Features

### Opening the OSINT Copilot Interface

Access the main chat interface via:
- **Ribbon Icon**: Click the OSINT Copilot icon in the left sidebar
- **Command Palette**: `Ctrl/Cmd + P` → "OSINT Copilot: Open Chat"

### Orchestration and Skills

The chat uses a **single orchestration agent**: the planner proposes which **tools** to run; you choose which capabilities are available via the **Skills** button in the chat header.

| Built-in skill | Planner tool | Role |
|----------------|--------------|------|
| **Local search** | `LOCAL_VAULT` | Search across your vault notes for relevant snippets |
| **Graph generation** | `EXTRACT_TO_GRAPH` | Extract entities into the graph (when you attach files, URLs, or pasted text the orchestration pipeline includes as context) |

**Custom skills** live as Markdown under **`OSINTCopilot/custom/skills/`** (configurable in **Settings → OSINT Copilot → Skills folder**). Each file uses `skill_kind: vault` and an `id` in frontmatter; the planner can invoke them as `SKILL_<id>`. Use **Add new skill…** in the Skills menu to create a template file.

Toggle skills on or off per vault; the planner only sees **enabled** skills. Your **vault prompts** (rules, agents under the prompts folder) still apply to orchestration.

---

### Feature 1: Vault Q&A (local search via orchestration)

**Purpose:** Ask questions over your vault; the orchestration planner may use the **Local search** skill (`LOCAL_VAULT`) and synthesize answers with **Claude Code CLI**.

**How it works**
1. Ensure **Local search** is enabled under **Skills**.
2. Type your question; the planner proposes tools — approve the plan when prompted.
3. Use **Reload vault prompts** after editing rules under `OSINTCopilot/custom/prompts/`.

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
1. Enable **Graph generation** under **Skills**, attach or paste source text, and run orchestration so the planner can use `EXTRACT_TO_GRAPH`
2. Manually create via Command Palette: "Create Entity"
3. Entities are saved as markdown notes with YAML frontmatter

**Multi-schema types (FTM, STIX 2, MITRE, user YAML)**:
- **FTM (FollowTheMoney)** types ship inside the plugin. **STIX 2**- and **MITRE ATT&CK**-style starter types load from vault YAML under `OSINTCopilot/schemas/` (default files are created on first run if missing).
- Add or override definitions in `OSINTCopilot/schemas/user/` using `.yaml` with `family: user` (see `schemas/README.md` in the vault).
- Under plugin settings (**Graph view** → **Schema families in type pickers**), choose which families appear in the entity and connection type dialogs.
- New notes are stored under `OSINTCopilot/<family>/<type>/` (for example `ftm/Person/` or `stix2/threat-actor/`). Older vaults that use the flat layout `OSINTCopilot/Person/` still work; those notes are treated as **FTM** unless frontmatter sets `schemaFamily`.
- **Custom FTM types** in `OSINTCopilot/custom/custom-types.json` continue to work as before. Editing files under `schemas/` triggers a catalog refresh (or reload the plugin).

---

### Feature 3: Entity extraction (graph generation)

**Purpose:** Turn unstructured text into **entity notes** and **relationships** using **Claude Code CLI**. Extraction instructions can be edited in **`OSINTCopilot/custom/prompts/skills/graph-extraction.md`**.

**How to use**
1. Enable **Graph generation** under **Skills**.
2. Attach files, paste a URL (or text), or include content so the orchestration run has attachment/context for `EXTRACT_TO_GRAPH`.
3. The plugin runs **local** `claude` with the graph-extraction skill when that tool is executed.

**A. Entity-focused** — Paste raw intel with **Graph generation** enabled.  
**B. After vault search** — Run a turn with **Local search** enabled, then continue in the same thread with attachments if you need extraction.

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