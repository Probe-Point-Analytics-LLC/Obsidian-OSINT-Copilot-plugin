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
2. **Local AI** — **Entity extraction**, **vault Q&A**, and **orchestration** (planner + follow-up) use the **Claude Code CLI** (`claude`) on your machine. You control prompts partly via **vault Markdown** under `.osint-copilot/prompts/`.
3. **Optional hosted API** — **Report**, **dark web**, **digital footprint / OSINT search**, and **evidence analysis** use your configured **Graph API URL** and **license/API key** when you enable those modes.

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

On load, the plugin creates missing files under **`.osint-copilot/prompts/`** (path configurable):

| Path | Purpose |
|------|---------|
| `rules/global.md` | Extra instructions for the **orchestration planner** |
| `agents/<id>.md` | **Agent** body + YAML frontmatter (`id`, `name`, …) |
| `skills/graph-extraction.md` | Instructions for **entity/graph extraction** |

**Settings:** **Prompts folder**, **Active agent id** (matches `agents/<id>.md`).

**Commands:** **Reload vault prompts**; **Install missing vault prompt files** (adds defaults without overwriting your edits).

### 3. License / Graph API (optional hosted modes)

- **Graph API URL** — Base URL for hosted report / dark web / footprint / evidence endpoints (default may point to the vendor cloud).  
- **License or API key** — Sent as `Authorization: Bearer …` for those modes only.  

Not required for **graph / timeline / map** or for **local Claude** extraction and Q&A.

### 4. Entity base path

Default **`OSINTCopilot`**. Entity types become subfolders; **`Connections/`** holds relationship notes.

### 5. Conversation folder

Default **`.osint-copilot/conversations`**. Chat sessions as JSON.

### 6. Report output directory

Default **`Reports`**. Used when **Report** mode completes successfully.

### 7. Max notes

Caps how many notes are pulled into context for Q&A-style flows (typical range **5–30**).

### 8. System prompt

Default text for vault-oriented answers; combine with **vault rules/agents** for orchestration.

### What needs what?

| Capability | License/API | Claude CLI |
|------------|-------------|------------|
| Graph / timeline / map | No | No |
| Entity extraction from chat | No | Yes |
| Vault Q&A / local orchestration | No | Yes |
| Report / dark web / footprint / evidence | Yes (hosted) | No* |

\*Hosted modes use the remote service; local Claude is separate.

---

## Core Features

### Opening the OSINT Copilot Interface

Access the main chat interface via:
- **Ribbon Icon**: Click the OSINT Copilot icon in the left sidebar
- **Command Palette**: `Ctrl/Cmd + P` → "OSINT Copilot: Open Chat"

### Operating modes

Toggles in the chat header (labels may vary slightly by version):

| Mode | Role |
|------|------|
| **Lookup** | Vault-oriented Q&A — uses **local Claude** + indexed notes |
| **Dark web** | **Hosted API** — requires URL + key |
| **Report** | **Hosted API** — job-based reports |
| **Entity generation** | **Local Claude** — extract entities from pasted text or responses |

Lookup, dark web, and report are mutually exclusive as “main” modes; **entity** can stack with others.

---

### Feature 1: Vault Q&A (lookup / local search)

**Purpose:** Ask questions over your vault; answers use **Claude Code CLI** and selected note context.

**How it works**
1. Enable **Lookup** (or equivalent local mode).
2. Type your question.
3. The plugin indexes/selects notes, then calls **local** `claude` with that context.
4. Use **Reload vault prompts** after editing rules under `.osint-copilot/prompts/`.

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

**Creating Entities**:
1. Use Entity Mode in chat to auto-extract from text
2. Manually create via Command Palette: "Create Entity"
3. Entities are saved as markdown notes with YAML frontmatter

---

### Feature 3: Dark web investigation (hosted)

**Purpose:** Run a **remote** dark-web investigation job when your **Graph API URL** and **key** are configured.

**How to use**
1. Set **Graph API URL** and license/API key in settings.
2. Enable **Dark web** mode.
3. Submit the query and wait for server-driven progress in chat.

Quota and billing depend on **your** API operator (e.g. vendor dashboard if you use the default cloud).

---

### Feature 4: Report generation (hosted)

**Purpose:** Long-form reports via the **remote** job API.

**How to use**
1. Configure **Graph API URL** and key.
2. Enable **Report** mode.
3. Describe the report; wait for job completion.
4. Markdown is saved under your **Report output directory** when the job finishes.

**Example Prompts**:
```
Generate a threat actor profile for APT28
Create an IOC report for the recent Log4j exploitation campaign
Write a vulnerability assessment for CVE-2024-XXXX
```

**Report Features**:
- Structured markdown format
- Automatic file naming with timestamps
- Opens automatically after generation
- Can combine with Entity Mode to extract entities from the report


---

### Feature 5: Entity extraction (local Claude)

**Purpose:** Turn unstructured text into **entity notes** and **relationships** using **Claude Code CLI**. Extraction instructions can be edited in **`.osint-copilot/prompts/skills/graph-extraction.md`**.

**A. Entity-focused** — Turn off other main modes, enable **entity generation**, paste text.  
**B. Combined** — Enable **entity** with lookup/report/dark web where supported; extraction still uses **local** Claude for the text pipeline (hosted modes add their own remote steps).

**Extracted Information**:
- Entity type and properties
- Relationships between entities (e.g., "director_of", "controls_wallet")
- Confidence scores for connections

**Relationship Types**:
```
director_of, shareholder_of, subsidiary_of, controls_wallet,
member_of, employed_by, associated_with, located_at,
owns, operates, communicates_with, targets, and more...
```

---

### Feature 6: Timeline View

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

### Feature 7: Map View

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

### Feature 8: Conversation Management

**Purpose**: Organize and persist your research conversations.

**Sidebar Features**:
- Toggle sidebar with ☰ button
- View all saved conversations
- Mode indicators (🔍 🕵️ 📄 🏷️)
- Timestamps and previews

**Actions**:
- **New Chat**: Start fresh conversation
- **Rename**: ✏️ button to rename conversations
- **Delete**: 🗑️ button to remove conversations
- **Load**: Click any conversation to resume

**Persistence**:
- Conversations saved as JSON files
- Survives Obsidian restarts
- Includes mode settings and chat history

---

## Workflow Examples

### Example 1: Investigating a Threat Actor

**Scenario**: You need to research APT29 (Cozy Bear) for a threat briefing.

**Steps**:

1. **Gather Initial Intelligence**
   - Enable **🔍 Lookup** + **🏷️ Entities** modes
   - Query: "What do we know about APT29?"
   - Review AI response and auto-created entities

2. **Conduct dark web research** *(requires **Graph API URL** + key)*  
   - Switch to **Dark web** mode  
   - Query: "APT29 Cozy Bear recent operations 2024"  
   - Wait for hosted job results  

3. **Generate report** *(requires **Graph API URL** + key)*  
   - Switch to **Report** mode  
   - Prompt: "Generate a comprehensive threat actor profile for APT29 including TTPs, infrastructure, and recent campaigns"  
   - Review saved Markdown under your report folder  

4. **Visualize Relationships**
   - Open Graph View
   - Explore connections between APT29 and related entities
   - Identify infrastructure patterns

### Example 2: IOC Analysis

**Scenario**: You received a list of suspicious IPs and domains to investigate.

**Steps**:

1. **Extract Entities**
   - Enable **🏷️ Entity-Only** mode (all main modes OFF)
   - Paste your IOC list:
     ```
     Suspicious IPs: 192.168.1.100, 10.0.0.50
     Domains: malware-c2.evil.com, phishing-site.bad.org
     Email: attacker@darkweb.onion
     ```
   - Entities are automatically created

2. **Research Each IOC**
   - Enable **🔍 Lookup** mode
   - Query: "What do we know about malware-c2.evil.com?"
   - Cross-reference with your existing notes

3. **Check dark web** *(hosted API + key)*  
   - Enable **Dark web** mode  
   - Query: "Find mentions of 192.168.1.100 or malware-c2.evil.com"  

4. **Document Findings**
   - Generate a report summarizing your analysis
   - All entities are linked in your vault

### Example 3: Incident Response Documentation

**Scenario**: Document a security incident as it unfolds.

**Steps**:

1. **Create Event Entity**
   - Use Entity Mode to create an Event for the incident
   - Include date, description, and initial findings

2. **Link Related Entities**
   - As you identify IOCs, create entities
   - Relationships are automatically tracked

3. **Build Timeline**
   - Open Timeline View
   - Visualize incident progression
   - Identify attack sequence

4. **Generate Incident Report**
   - Use Report Mode with your findings
   - Prompt: "Generate an incident report for the ransomware attack on [date] including timeline, IOCs, and remediation steps"



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

---

### License / hosted API

**Problem:** “License key required” (or similar) when using **Report**, **Dark web**, **Digital footprint**, or **Evidence**.

**Solutions:**
1. **Settings → OSINT Copilot** — set **Graph API URL** and **License / API key** per your operator.  
2. Keys are **not** required for **graph / timeline / map** or for **local Claude** features.

**Problem:** “Invalid license” or HTTP 403 from hosted modes.

**Solutions:** Confirm the key, subscription, and endpoint URL; check operator dashboard (e.g. [osint-copilot.com/dashboard](https://osint-copilot.com/dashboard/) if you use the default cloud).

---

### Connection errors (hosted modes)

**Problem:** `Failed to fetch` / timeout on report or dark web.

**Solutions:**
1. Check internet and firewall / proxy rules for your **Graph API URL**.  
2. Retry later if the service is down.  
3. Confirm corporate SSL inspection is not breaking HTTPS.

---

### Quota Exhausted

**Problem**: "Quota exhausted" or "Investigation quota exceeded"

**Solutions**:
1. Visit [osint-copilot.com/dashboard](https://osint-copilot.com/dashboard/) to check usage
2. Wait for quota renewal (typically monthly)
3. Upgrade your subscription for higher limits
4. Note: Chat queries are unlimited; Dark Web and Reports consume quota

---

### Entity Creation Failures

**Problem**: Entities not being created or "Unknown entity type" errors

**Solutions**:
1. Ensure the Entity Base Path exists in your vault
2. Check that the entity type is valid (Person, Company, Event, etc.)
3. Review the console (Ctrl+Shift+I) for detailed error messages
4. Verify you have write permissions to the vault folder

---

### Dark Web Investigation Stuck

**Problem**: Investigation shows "Processing" indefinitely

**Solutions**:
1. Wait up to 5 minutes (complex queries take longer)
2. Check your internet connection
3. If stuck beyond 5 minutes, start a new conversation and retry
4. Check the console for error messages

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
   - Use Entity Mode to capture key findings

### Efficient Dark Web Research

1. **Use Specific Queries**
   - Include organization names, domains, or specific terms
   - Avoid overly broad searches

2. **Combine with Vault Research**
   - First check what you already know (Lookup Mode)
   - Then expand with Dark Web searches

3. **Save Important Findings**
   - Enable Entity Mode to auto-extract entities
   - Reports are automatically saved to your vault

### Building Knowledge Over Time

1. **Create Entities Consistently**
   - Use Entity Mode regularly to build your knowledge base
   - Relationships accumulate and become more valuable

2. **Review Graph Periodically**
   - Visualize connections to spot patterns
   - Identify gaps in your research

3. **Generate Summary Reports**
   - Periodically create reports on key topics
   - Helps consolidate and review knowledge

### Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Send message | Enter |
| New line in message | Shift + Enter |
| Open Command Palette | Ctrl/Cmd + P |
| Open Settings | Ctrl/Cmd + , |

### Security considerations

1. **Keys** — Hosted API key lives in Obsidian plugin data; treat like any secret.  
2. **Claude** — Text you send in chat is processed by **Claude Code** per Anthropic’s terms.  
3. **Hosted modes** — Report / dark web / footprint send data to **your configured Graph API URL**.  
4. **Vault** — Entities, conversations, and `.osint-copilot/prompts/` are normal Markdown/JSON on disk.

### Vault prompts hygiene

- Keep `rules/global.md` short and policy-aligned.  
- Use **Reload vault prompts** after edits.  
- Use **Install missing vault prompt files** to restore defaults you deleted (does not overwrite edits).

---

## Getting help

- **README.md** — Overview, BRAT install, privacy summary  
- **This guide** — Configuration and features  
- **GitHub** — [Obsidian-OSINT-Copilot-plugin](https://github.com/Probe-Point-Analytics-LLC/Obsidian-OSINT-Copilot-plugin) issues and releases  
- **Hosted dashboard** — [osint-copilot.com/dashboard](https://osint-copilot.com/dashboard/) if you use the vendor cloud API  

---

*OSINT Copilot — local investigation workspace + optional hosted OSINT API. See `manifest.json` for the current plugin version.*