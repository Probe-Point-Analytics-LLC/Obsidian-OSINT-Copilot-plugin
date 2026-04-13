# OSINT Copilot for Obsidian

**OSINT Copilot** is an Obsidian plugin for **SOC analysts, threat researchers, and investigators**. It gives you a **local-first** investigation workspace: entities and links live as Markdown in your vault, with **graph**, **timeline**, and **map** views. **AI-assisted** workflows (entity extraction, vault Q&A, tri-mode chat, orchestration) run through the **Claude Code CLI** on your machine. There is **no** vendor license key, hosted report/dark-web/footprint pipeline, or remote evidence API in this build.

![OSINT Copilot Interface](screenshots/Copilot%20Left%20pallete%20bigger.png)

---

## Table of Contents

- [What the plugin does today](#what-the-plugin-does-today)
- [Features Overview](#features-overview)
- [Installation](#installation)
- [Claude Code CLI (local AI)](#claude-code-cli-local-ai)
- [Vault prompts (editable rules & agents)](#vault-prompts-editable-rules--agents)
- [Getting Started](#getting-started)
- [User Guide](#user-guide)
  - [Entity Management](#entity-management)
  - [Relationship Mapping](#relationship-mapping)
  - [AI-Powered Features](#ai-powered-features)
  - [Visualization Tools](#visualization-tools)
  - [Geocoding & Location Intelligence](#geocoding--location-intelligence)
- [Settings](#settings)
- [Troubleshooting](#troubleshooting)
- [Privacy & Security](#privacy--security)

---

## What the plugin does today

| Layer | What you get |
|--------|----------------|
| **100% local** | **Entity graph**, **timeline**, **map**, manual **entities** and **relationships** (FollowTheMoney-style notes under your entity folder), **Nominatim** geocoding for addresses. No account required. |
| **Local AI (Claude Code CLI)** | **Entity extraction** from pasted text, **vault Q&A / local search**, **general / graph / local** chat modes, **orchestration** (investigation planner + synthesis), **vault-wide graph ingest** (local batch extraction). Uses **your** Claude install; prompts can be overridden from the vault (see [Vault prompts](#vault-prompts-editable-rules--agents)). |

On first enable, the plugin creates default Markdown under **`.osint-copilot/prompts/`** (rules, agents, graph-extraction skill) so you can edit behavior without rebuilding the plugin.

---

## Features Overview

### Local features (no Claude, no API key)
- **Entity Graph View** — Visualize relationships between entities
- **Timeline View** — Track events chronologically
- **Location Map View** — Geographic visualization of addresses
- **Entity management** — Create and organize entities (Person, Company, Location, etc.)
- **Relationship mapping** — Typed edges (FollowTheMoney-style)
- **Geocoding** — Addresses → coordinates via OpenStreetMap Nominatim

### Local AI (Claude Code CLI required)
- **Entity extraction** — From text / attachments in chat; skill text from vault `skills/graph-extraction.md` when present
- **Vault Q&A / local search** — Answers grounded in indexed notes via local Claude
- **Orchestration** — Planner + tool steps; **vault rules** (`rules/global.md`) and **active agent** (`agents/<id>.md`) are injected into the planner context

---

## Installation

### Option A — BRAT (recommended)

BRAT (**Beta Reviewers Auto-update Tool**) installs plugins directly from GitHub and can update them for you.

1. **Turn on community plugins**  
   **Settings → Community plugins** → turn **Restricted mode** (Safe mode) **off** so third-party plugins are allowed.

2. **Install BRAT**  
   **Settings → Community plugins → Browse** → search **`BRAT`** (by TfTHacker) → **Install** → **Enable**.

3. **Add this plugin from GitHub**  
   **Settings → BRAT → Add Beta plugin** (wording may be **Add Beta Plugin**).  
   Paste this repository URL (no trailing slash required):

   ```
   https://github.com/Probe-Point-Analytics-LLC/Obsidian-OSINT-Copilot-plugin
   ```

4. **Enable OSINT Copilot**  
   **Settings → Community plugins** → find **OSINT Copilot** → enable the toggle.

5. **Confirm files**  
   BRAT downloads into your vault under something like  
   `.obsidian/plugins/osint-copilot/` or `.obsidian/plugins/Obsidian-OSINT-Copilot-plugin/`  
   (folder name follows BRAT / GitHub; both are fine as long as `main.js`, `manifest.json`, and `styles.css` are inside).

6. **Reload if needed**  
   If the plugin does not appear, use **Reload app without saving** or restart Obsidian.

BRAT can keep the plugin updated from the default branch of the repo (per BRAT’s options).

### Option B — Pre-configured Template (Best for New Users)

Download our template vault which comes with the plugin pre-installed and an example investigation:

```bash
git clone --recursive https://github.com/Probe-Point-Analytics-LLC/OSINT-Copilot-Obsidian-Template.git
```

Then open the cloned folder as a vault in Obsidian.

Alternatively, download the ZIP from the [template repository](https://github.com/Probe-Point-Analytics-LLC/OSINT-Copilot-Obsidian-Template) and extract it.

### Option C — Manual install

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/Probe-Point-Analytics-LLC/Obsidian-OSINT-Copilot-plugin/releases).
2. Under your vault, create **one** plugin folder, for example:
   - `.obsidian/plugins/osint-copilot/` (matches plugin `id`), or  
   - `.obsidian/plugins/Obsidian-OSINT-Copilot-plugin/`
3. Place **all three files** directly inside that folder (not in a subfolder).
4. Restart Obsidian (or reload plugins).
5. **Settings → Community plugins** → enable **OSINT Copilot**.

### Verify Installation

- You should see the OSINT Copilot icon in the left ribbon
- Click the icon to open the chat interface
- The plugin is ready to use!

### Updating the Plugin

- **BRAT users:** Updates are automatic
- **Template / Manual users:** `cd` into the plugin folder and run `git pull origin main`, then restart Obsidian

---

## Claude Code CLI (local AI)

Most **interactive AI** in this plugin uses the **`claude` command** (Claude Code / Anthropic CLI) on your computer—not a browser key inside Obsidian.

1. **Install** the Claude Code CLI using [Anthropic’s current install instructions](https://docs.anthropic.com/en/docs/claude-code) (or your org’s standard install).
2. **Verify** in a terminal: `claude --version` (or the full path you will paste into settings).
3. **Sign in** or configure authentication the way Anthropic documents for Claude Code (login or API key as supported by that CLI).
4. In **Settings → OSINT Copilot**, set **Claude Code CLI path** (default `claude` if it is on your `PATH`) and **model** (e.g. `sonnet`) if options are exposed.

If the CLI is missing or not authenticated, local extraction and vault Q&A will fail until that is fixed.

---

## Vault prompts (editable rules & agents)

The first time the plugin runs (and whenever files are still missing), it creates:

| Path | Role |
|------|------|
| `.osint-copilot/prompts/README.md` | Explains the layout |
| `.osint-copilot/prompts/rules/global.md` | Extra instructions for the **orchestration planner** |
| `.osint-copilot/prompts/agents/*.md` | **Agents** — YAML frontmatter (`id`, `name`, …) + body text |
| `.osint-copilot/prompts/skills/graph-extraction.md` | Instructions for **entity / graph extraction** (used before the bundled plugin skill) |

**Settings → OSINT Copilot → Vault prompts** lets you change the **prompts folder** and **active agent id** (matches `agents/<id>.md`).

**Command palette:**

- **OSINT Copilot: Reload vault prompts** — clear the in-memory cache after edits.
- **OSINT Copilot: Install missing vault prompt files** — recreate any default file that was deleted (does not overwrite your changes to existing files).

---

## Getting Started

### New to Obsidian? (2-minute orientation)

OSINT Copilot takes advantage of Obsidian, a powerful local-first knowledge base. Here is a quick primer:

| Term | What it means |
|---|---|
| Vault | The folder on your computer where your notes live. Obsidian reads/writes files inside this folder. |
| Note | A Markdown (`.md`) file in your vault. |
| Community plugins | Optional add-ons you can install in Obsidian to add features (like OSINT Copilot). |
| Command Palette | A search box in Obsidian that lets you run commands. |

Where to find things in Obsidian:
- **Settings**: click the gear icon (usually bottom-left).
- **Community plugins**: Settings -> Community plugins.
- **Command Palette**: press `Ctrl + P` (Windows/Linux) or `Cmd + P` (macOS).

### First Steps

Once installed, you'll see the OSINT Copilot tools in the left sidebar:

![OSINT Copilot Tools](screenshots/Copilot%20tools%20pallete%20left%20bar.png)

The chat header uses a **task mode** dropdown:

1. **General agent** — Orchestrated investigation (local vault search + local extraction tools).
2. **Graph generation** — Entity extraction only from your text/attachments (local Claude).
3. **Local search** — Vault Q&A over your indexed notes (local Claude).

Optional **custom chat checkpoints** (OpenAI-compatible URLs) are configured in **Settings** if you need a separate LLM endpoint; they are not part of the tri-mode dropdown.

### Example: Investigating Lukoil

Throughout this guide, we'll use a real-world example: investigating **Lukoil**, a Russian oil company. This demonstrates how OSINT Copilot helps you organize complex investigations.

---

## User Guide

### Entity Management

Entities are the building blocks of your OSINT investigations. They represent people, companies, locations, events, and other objects of interest.

#### Supported Entity Types

OSINT Copilot supports the **FollowTheMoney (FTM)** schema, which includes:

- **Person** - Individuals
- **Company** - Corporations and businesses
- **Organization** - Non-profit organizations, government agencies
- **Address** - Physical locations
- **Event** - Incidents, meetings, transactions
- **Vehicle** - Cars, ships, aircraft
- **BankAccount** - Financial accounts
- **CryptoWallet** - Cryptocurrency wallets
- **UserAccount** - Online accounts
- **Document** - Files, reports, evidence
- **RealEstate** - Properties and land
- **Passport** - Travel documents
- **Sanction** - Sanctions and restrictions

#### Creating Entities

**Method 1: Manual Creation via Graph View**

1. Click the **Graph View** icon in the left ribbon
2. Click the **"+ Create Entity"** button
3. Select the entity type (e.g., "Company")
4. Fill in the entity properties

![Create Entity](screenshots/Copilot%20graph%20ivew%20create%20entity.png)

**Method 2: AI-powered entity extraction (Claude Code CLI)**

1. Ensure **Claude Code CLI** is installed and working (see [above](#claude-code-cli-local-ai)).
2. Open the OSINT Copilot chat
3. Enable **Entity Generation** mode (toggle at the bottom)
4. Paste text containing entity information
5. The model will extract entities and relationships into your vault (skill text can be edited under `.osint-copilot/prompts/skills/graph-extraction.md`)

![Generated Entities](screenshots/Copilot%20Generated%20entities%20and%20relationships%20in%20the%20chat.png)

#### Editing Entities

Entities are stored as markdown files in your vault (default: `OSINTCopilot/` folder). Each entity has:

- **Frontmatter** - Structured metadata (ID, type, properties)
- **Properties Section** - Key-value pairs
- **Relationships Section** - Links to related entities
- **Notes Section** - Free-form analysis

**Example: Lukoil Company Entity**

![Edit Company Entity](screenshots/Copilot%20Edit%20entity%28company%29%20.png)

The entity form shows:
- **Required fields** - Always visible (e.g., name, country)
- **Featured fields** - Commonly used properties
- **Optional fields** - Collapsed by default, expandable for detailed data

---


### Relationship Mapping

Relationships connect entities to show how they're related. OSINT Copilot uses the **FollowTheMoney** relationship schema for standardized intelligence mapping.

#### Creating Relationships

**Method 1: Manual Creation**

1. Open an entity note (e.g., a Person)
2. Click **"Edit Entity"**
3. Scroll to the **Relationships** section
4. Click **"+ Add Relationship"**
5. Select the relationship type and target entity

![Create Connection](screenshots/Copilot%20create%20connection.png)

**Method 2: AI-Generated Relationships**

When using Entity Generation mode, the AI automatically creates relationships between extracted entities.

![Edit Connection](screenshots/Copilot%20Edit%20connection.png)

#### Relationship Types

The plugin supports FollowTheMoney relationship types:

**Person → Company:**
- `director_of` - Board member or director
- `shareholder_of` - Equity holder
- `beneficial_owner_of` - Ultimate beneficial owner
- `employee_of` - Employee or contractor
- `advisor_to` - Consultant or advisor

**Company → Company:**
- `subsidiary_of` - Parent-subsidiary relationship
- `partner_of` - Business partnership
- `supplier_to` - Supply chain relationship
- `client_of` - Customer relationship

**Entity → Location:**
- `registered_in` - Legal registration
- `operates_in` - Business operations
- `related_to` - General association

**Person ↔ Person:**
- `associate_of` - Professional or personal association
- `family_of` - Family relationship
- `alias_of` - Alternative identity

**And many more** - The full FTM schema includes dozens of relationship types for comprehensive intelligence mapping.

---

### AI-assisted features

All AI features in this build use **Claude Code CLI** on your machine (plus optional **custom chat** endpoints you add in settings).

#### Local AI setup (entity extraction, vault Q&A, orchestration)

1. **Settings → OSINT Copilot** — set **Claude Code CLI path** and model.
2. Use **Test Claude Code** to confirm the CLI is reachable.
3. Optionally edit **vault prompts** under `.osint-copilot/prompts/` (see [Vault prompts](#vault-prompts-editable-rules--agents)).

#### Entity extraction (local Claude)

Automatically extract entities from unstructured text using **Claude Code CLI**.

**How to use:**

1. Open the OSINT Copilot chat
2. Choose **Graph generation** mode (or use **General agent** / **Local search** with attachments as needed)
3. Paste text (e.g., news article, report, document)
4. The CLI will:
   - Identify entities (people, companies, locations, etc.)
   - Extract properties (names, addresses, dates, etc.)
   - Create entity notes in your vault
   - Establish relationships between entities

**Example:** Paste a news article about Lukoil, and the AI will extract:
- Company: Lukoil
- People: CEO, board members
- Locations: Headquarters, operations
- Events: Mergers, sanctions, incidents
- Relationships: Ownership, employment, partnerships

#### Vault Q&A (local Claude)

Ask questions about your vault content; answers are generated with **Claude Code CLI** using retrieved note context.

**How to use:**

1. Open the OSINT Copilot chat and select **Local search** mode
2. Ask a question (e.g., "What do we know about Lukoil's operations in Moldova?")
3. The plugin will:
   - Search / index relevant notes
   - Send context to **local** Claude
   - Stream or show an answer with source paths where supported

**Example questions:**
- "Who are the key executives at Lukoil?"
- "What sanctions have been imposed on Lukoil?"
- "What locations are associated with Lukoil?"

---

### Visualization Tools

Visualization tools run **locally** in Obsidian and do not require Claude or a remote API. They help you understand complex relationships and patterns in your intelligence data.

#### Entity Graph View

Visualize entities and their relationships as an interactive network graph.

**How to use:**

1. Click the **Graph View** icon in the left ribbon (or use Command Palette: "Open Entity Graph")
2. The graph displays:
   - **Nodes** - Entities (colored by type)
   - **Edges** - Relationships (labeled with type)
   - **Interactive controls** - Zoom, pan, filter

![Entity Graph View](screenshots/Copilot%20Generated%20entites%20graph%20view.png)

**Features:**
- **Color-coded entities** - Different colors for Person, Company, Location, etc.
- **Relationship labels** - See how entities are connected
- **Click to open** - Click any entity to open its note
- **Filter by type** - Show/hide specific entity types
- **Search** - Find specific entities in the graph

**Example:** The Lukoil investigation graph shows:
- Lukoil (Company) at the center
- Connected executives (Person)
- Subsidiary companies (Company)
- Operating locations (Address)
- Related events (Event)

#### Timeline View

Track events chronologically to understand the sequence of activities.

**How to use:**

1. Click the **Timeline View** icon in the left ribbon (or use Command Palette: "Open Timeline")
2. The timeline displays:
   - **Events** - Sorted by date
   - **Entity associations** - Which entities are involved
   - **Interactive navigation** - Scroll through time

![Timeline View](screenshots/Copilot%20Timeline%20view.png)

**Use cases:**
- Track company milestones
- Investigate incident timelines
- Analyze threat actor activity
- Monitor sanction events

**Example:** Lukoil timeline might show:
- 1991: Company founded
- 2014: Crimea annexation involvement
- 2022: EU sanctions imposed
- 2023: Subsidiary restructuring

#### Location Map View

Visualize geographic data on an interactive map.

**How to use:**

1. Click the **Map View** icon in the left ribbon (or use Command Palette: "Open Location Map")
2. The map displays:
   - **Markers** - Entities with geographic coordinates
   - **Popups** - Click markers to see entity details
   - **Interactive map** - Zoom, pan, explore

![Map View](screenshots/Copilot%20map%20view.png)

**Features:**
- **Automatic geocoding** - Convert addresses to coordinates
- **Multi-language support** - Handles international addresses
- **Fallback geocoding** - If exact address fails, shows city/country
- **OpenStreetMap** - Free, open-source mapping

**Example:** Lukoil map might show:
- Headquarters in Moscow, Russia
- Refineries across Europe
- Retail stations in multiple countries
- Offshore operations

---

### Geocoding & Location Intelligence

OSINT Copilot includes a powerful geocoding service that converts addresses to geographic coordinates, enabling map visualization and spatial analysis.

#### How Geocoding Works

The plugin uses the **Nominatim** geocoding service (OpenStreetMap) to convert addresses to latitude/longitude coordinates.

**Features:**
- ✅ **Multi-language support** - Handles addresses in any language (Cyrillic, Arabic, Chinese, etc.)
- ✅ **Special character handling** - Properly encodes international characters (ş, ă, ñ, etc.)
- ✅ **Graceful fallback** - If exact address fails, automatically tries simpler queries
- ✅ **Free service** - No API key required

#### Geocoding an Address

**Method 1: Automatic Geocoding**

When creating a Location/Address entity with address fields, the geocoding happens automatically.

**Method 2: Manual Geocoding**

1. Open a Location entity note
2. Click **"Edit Entity"**
3. Fill in address fields (address, city, country)
4. Click **"📍 Geolocate Address"**
5. The plugin will:
   - Try the full address
   - If that fails, try without building number
   - If that fails, try just street and city
   - If that fails, try city and country
   - If that fails, try just the city
6. Coordinates are automatically populated

![Location Note Example](screenshots/Copilot%20Location%20note%20example.png)

#### Geocoding Fallback Strategy

The geocoding service uses a smart fallback strategy to handle difficult addresses:

**Example: Moldovan Address**
```
Original: str. Şevcenco, nr. 81/11, Tiraspol, Moldova
```

**Fallback sequence:**
1. Try full address: `str. Şevcenco, nr. 81/11, Tiraspol, Moldova`
2. Remove building number: `str. Şevcenco, Tiraspol, Moldova`
3. Remove street prefix: `Şevcenco, Tiraspol, Moldova`
4. City and country: `Tiraspol, Moldova` ✓ **Success**
5. Just city: `Tiraspol`

The service automatically uses the **most specific result** that succeeds.

#### Supported Address Formats

The geocoding service recognizes common address patterns:

- **Building numbers:** `nr. 81/11`, `#45`, `123`
- **Street prefixes:** `str.`, `strada`, `st.`, `rue`, `calle`
- **International formats:** Romanian, Russian, Arabic, Chinese, etc.

#### Troubleshooting Geocoding

**Address not found:**
- Check spelling of city and country
- Try removing building numbers or street prefixes
- Use English transliteration if available
- For disputed territories (e.g., Transnistria), use the broader region

**Special characters not working:**
- The plugin handles UTF-8 automatically
- If issues persist, try the ASCII equivalent (e.g., "Sevcenco" instead of "Şevcenco")

**Rate limiting:**
- Nominatim has usage limits (1 request per second)
- The plugin automatically waits between requests
- If you see rate limit errors, wait a few seconds and try again

---


## Settings

Configure OSINT Copilot to match your workflow and requirements.

### Accessing Settings

1. Open Obsidian Settings (⚙️)
2. Navigate to **Community Plugins** → **OSINT Copilot**

### Available Settings

| Setting | Description | Default | When needed |
|---------|-------------|---------|-------------|
| **Claude Code CLI path** | Executable for local AI (`claude` if on PATH) | `claude` | Local extraction, vault Q&A, orchestration |
| **Claude model** | Model flag passed to CLI | `sonnet` | With local Claude |
| **Prompts folder** | Vault folder for rules / agents / skills | `.osint-copilot/prompts` | Optional (auto-created) |
| **Active agent id** | Which `agents/<id>.md` to load | `default` | Vault agent body for orchestration |
| **Entity Base Path** | Folder where entity notes are stored | `OSINTCopilot` | No |
| **Conversation Folder** | Chat history (Markdown + JSON block per file) | `.osint-copilot/conversations` | No |
| **Max Notes** | Cap on notes in context | 15 | No |
| **System Prompt** | Default prompt for vault Q&A | (built-in text) | No |
| **Enable Graph Features** | Graph / timeline / map | Enabled | No |

### Recommended Settings for SOC Analysts

**For Team Collaboration:**
- Set `Entity Base Path` to a shared folder (e.g., `Intelligence/Entities`)
- Enable version control (Git) for your vault

**For privacy-focused work:**
- Keep **Enable Graph Features** on (local views)
- Prefer **local Claude** for text you are willing to send to your own CLI process
- Review **vault prompts** and **system prompt** so they match your data-handling policy

**For Large Investigations:**
- Increase `Max Notes` to 20-30 for more context
- Organize entities in subfolders (e.g., `OSINTCopilot/Lukoil/`, `OSINTCopilot/Sanctions/`)

---

## Troubleshooting

### Common Problems (Fast Fixes)

| Problem | Fix |
|---|---|
| Cannot find Community plugins | Go to **Settings -> Community plugins** and turn off **Safe mode**. |
| Plugin not listed in Browse | Use the manual installation method (or install via the template). |
| Plugin doesn't appear after manual install | Ensure `main.js`, `manifest.json`, and `styles.css` sit **directly** under **one** folder under `.obsidian/plugins/` (e.g. `osint-copilot`). Restart Obsidian. |
| "Claude" / CLI errors in chat | Install Claude Code CLI, run `claude --version`, fix PATH or set **Claude Code CLI path** in settings. |
| AI answers seem thin | Increase **Max notes**, reindex the vault, or paste source text into chat for extraction. |
| Entities aren't linking / appearing in Graph | Verify the "Entity Base Path" setting matches where your entities are saved. Refresh the Graph View. |

### Common Issues and Solutions

#### Geocoding Fails for Specific Address

**Problem:** Clicking "📍 Geolocate Address" fails or returns no results.

**Solution:**
1. **Check address spelling** - Ensure city and country are spelled correctly
2. **Simplify the address** - Try removing building numbers or street prefixes
3. **Use English names** - For international locations, try English transliteration
4. **Check for typos** - Example: "Moldov" should be "Moldova"
5. **Wait and retry** - If rate-limited, wait 2-3 seconds and try again

**Example fixes:**
- ❌ `str. Şevcenco, nr. 81/11, Tiraspol, Moldov` (typo in country)
- ✅ `str. Şevcenco, nr. 81/11, Tiraspol, Moldova`
- ✅ `Tiraspol, Moldova` (simplified)

---

#### Entities Not Appearing in Graph View

**Problem:** Created entities don't show up in the Entity Graph.

**Solution:**
1. **Refresh the graph** - Close and reopen the Graph View
2. **Check entity folder** - Ensure entities are in the correct folder (Settings → Entity Base Path)
3. **Verify frontmatter** - Open the entity note and check that frontmatter includes `type:` and `id:`
4. **Check file format** - Entity notes must be `.md` files with proper YAML frontmatter

**Example valid frontmatter:**
```yaml
---
id: "abc123-def456-ghi789"
type: Company
label: "Lukoil"
---
```

---

#### AI Features Not Working

**Problem:** Entity extraction or vault Q&A fails.

**Solution:**
1. **Test Claude Code** — Settings → OSINT Copilot → **Test Claude Code**
2. **Fix PATH or CLI path** — ensure `claude` runs in a terminal
3. **Review error message** — chat and developer console for details
4. **Retry** — long documents are processed in chunks; try a shorter excerpt if timeouts occur

---

#### "No relevant notes found" in Vault Q&A

**Problem:** Asking questions returns "No relevant notes found."

**Solution:**
1. **Use broader search terms** - Try more general keywords
2. **Reindex vault** - Command Palette → "Vault AI: Reindex vault"
3. **Check vault content** - Ensure your vault contains markdown files with relevant content
4. **Verify note format** - Notes should be standard markdown files (not canvas, PDF, etc.)

---

#### Timeline View Shows No Events

**Problem:** Timeline View is empty or missing events.

**Solution:**
1. **Create Event entities** - Timeline only shows entities of type "Event"
2. **Add date properties** - Events need a `date` or `startDate` property
3. **Check date format** - Use ISO format: `YYYY-MM-DD` (e.g., `2023-05-15`)
4. **Refresh the view** - Close and reopen Timeline View

**Example Event entity:**
```yaml
---
id: "event-001"
type: Event
label: "Lukoil Sanctions Imposed"
date: "2022-03-15"
---
```

---

#### Map View Shows No Locations

**Problem:** Location Map is empty or missing markers.

**Solution:**
1. **Create Address/Location entities** - Map only shows entities with coordinates
2. **Add coordinates** - Use the "📍 Geolocate Address" button to add lat/lon
3. **Check coordinate format** - Latitude and longitude should be decimal numbers
4. **Refresh the view** - Close and reopen Map View

**Example Location entity with coordinates:**
```yaml
---
id: "loc-001"
type: Address
label: "Lukoil Headquarters"
city: "Moscow"
country: "Russia"
latitude: 55.7558
longitude: 37.6173
---
```

---

#### Plugin Not Loading

**Problem:** OSINT Copilot doesn't appear in the plugin list or fails to load.

**Solution:**
1. **Check installation** - Verify `main.js`, `manifest.json`, and `styles.css` are in the plugin folder
2. **Enable the plugin** - Settings → Community Plugins → Toggle OSINT Copilot ON
3. **Restart Obsidian** - Close and reopen Obsidian
4. **Check console** - Open Developer Tools (Ctrl+Shift+I) and check for errors
5. **Reinstall** - Delete the plugin folder and reinstall from scratch

---

## Privacy & Security

OSINT Copilot is designed with privacy and security in mind.

### Data storage

- **Entity notes** — Markdown in your vault (entity folder + `Connections/`)
- **Vault prompts** — `.osint-copilot/prompts/` (and paths you configure)
- **Conversation history** — Markdown files with embedded JSON under `.osint-copilot/conversations/` (or your setting)
- **Plugin settings** — Obsidian plugin data (no remote API credentials in this build)
- **Sync** — Only if you use Obsidian Sync, Git, or other tools you choose

### Data transmission

**Local in Obsidian:**
- Graph, timeline, map views
- File read/write for entities and prompts

**Network you may trigger:**
- **Nominatim** (OpenStreetMap) for geocoding — address text only
- **Claude Code CLI** — The CLI sends prompts to Anthropic (or your org’s routing) per Anthropic’s Claude Code terms; vault snippets you include in chat are part of that prompt

**Not sent as a full dump:**
- The plugin does not upload your whole vault automatically; only text you attach or that retrieval logic selects for a given request.

### Security Best Practices

1. **Review context** — Know what text is sent to Claude Code for each mode
2. **Use local views** — Graph / timeline / map need no AI
3. **Redact** — Strip PII before pasting into chat
4. **Vault encryption** — Use Obsidian encryption if required by policy
5. **Audit** — Review conversations and prompt files periodically

### Compliance note

Processing depends on **Anthropic (Claude Code)** when you use AI features. Your organization’s DPA and policies apply.

### Geocoding Privacy

The geocoding service uses **Nominatim** (OpenStreetMap):
- Sends address queries to `https://nominatim.openstreetmap.org`
- No authentication required
- Subject to Nominatim's usage policy and privacy policy
- Requests include a User-Agent header: `OSINTCopilot/1.0`

---

## License

PROBE POINT ANALYTICS SRL - SOURCE AVAILABLE LICENSE
- See LICENSE file for details.

## Credits

Built with inspiration from:
- **obsidian-copilot-plugin** - AI integration patterns
- **obsidian-smart-connections** - Vault indexing
- **OpenSanctions/FollowTheMoney** - Entity schema and relationship types
- **Nominatim/OpenStreetMap** - Geocoding service

## Support

For issues, feature requests, or questions:
- **GitHub Issues** - Report bugs or request features
- **Documentation** - Check this README for guidance
- **Community** - Join the Obsidian community forums

---

## Changelog

### Documentation (current)

- README and USER_GUIDE updated for **BRAT install**, **Claude Code CLI** (local AI), **vault prompts** (`.osint-copilot/prompts/`), and **tri-mode chat** (general agent, graph generation, local search) with no remote investigation API.

### Recent Improvements

**Geocoding Enhancements:**
- ✅ Multi-language address support (Cyrillic, Arabic, Chinese, etc.)
- ✅ Graceful fallback for difficult addresses
- ✅ Automatic retry with simpler queries
- ✅ Special character handling (ş, ă, ñ, etc.)
- ✅ Support for international address formats

**Entity Management:**
- ✅ FollowTheMoney schema integration
- ✅ Featured/optional property organization
- ✅ Improved entity forms with collapsible sections
- ✅ Better relationship management

**Visualization:**
- ✅ Enhanced graph view with filtering
- ✅ Timeline view for event tracking
- ✅ Interactive map with geocoding

---

**Made with ❤️ for OSINT analysts and threat researchers**

