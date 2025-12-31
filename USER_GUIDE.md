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

**OSINT Copilot** is a plugin for Obsidian designed specifically for SOC analysts and threat intelligence researchers. It transforms your Obsidian vault into an intelligent threat research workspace by combining:

**AI-Powered Features (License Key Required):**
- **AI-Powered Q&A**: Ask natural language questions about your research notes and get contextual answers
- **Entity Extraction**: Automatically identify and create structured entities (people, companies, locations, events, etc.) from your research
- **Dark Web Investigation**: Conduct automated searches across 15+ dark web engines via Tor
- **Report Generation**: Generate comprehensive threat intelligence reports with AI assistance

**Free Visualization Features (No License Required):**
- **Entity Graph View**: Build visual graphs showing connections between threat actors, infrastructure, and campaigns
- **Timeline View**: Visualize events chronologically
- **Map View**: Display locations geographically

### Who Is This For?

- **SOC Analysts** investigating security incidents
- **Threat Intelligence Researchers** tracking threat actors and campaigns
- **Security Investigators** conducting OSINT research
- **Incident Responders** documenting and analyzing threats

---

## Installation

### Method 1: Manual Installation (Recommended)

1. **Download the Plugin**
   - Obtain the plugin files (`main.js`, `manifest.json`, `styles.css`)
   - You may also receive a `prompts` folder with system prompts

2. **Locate Your Vault's Plugin Folder**
   ```
   <your-vault>/.obsidian/plugins/
   ```

3. **Create the Plugin Directory**
   ```bash
   mkdir -p <your-vault>/.obsidian/plugins/OSINT-copilot-plugin
   ```

4. **Copy Plugin Files**
   - Copy all plugin files into the newly created directory

5. **Enable the Plugin**
   - Open Obsidian
   - Go to **Settings** → **Community plugins**
   - Click **Reload plugins** (refresh icon)
   - Find "OSINT Copilot" in the list and toggle it **ON**

### Method 2: Build from Source

If you have the source code:

```bash
# Navigate to the plugin directory
cd <your-vault>/.obsidian/plugins/OSINT-copilot-plugin

# Install dependencies
npm install

# Build the plugin
npm run build
```

### Verify Installation

After enabling, you should see:
- A new **OSINT Copilot** icon in the left ribbon
- New commands available in the Command Palette (Ctrl/Cmd + P)
- A settings tab under **Settings** → **OSINT Copilot**

---

## Configuration

### Essential Settings

Access settings via **Settings** → **OSINT Copilot**.

#### 1. License Key (Required for AI Features)

```
License Key: [Your API Key]
```

- **Required** for all AI-powered features (Q&A, entity extraction, dark web, reports)
- Obtain your key from [osint-copilot.com/dashboard](https://osint-copilot.com/dashboard/)
- The plugin validates your key on startup

#### 2. Entity Base Path

```
Entity Base Path: Entities
```

- Folder where entity notes are created
- Default: `Entities` (creates `Entities/Person/`, `Entities/Company/`, etc.)
- Customize to match your vault organization

#### 3. Conversation Folder

```
Conversation Folder: OSINT-Copilot-Conversations
```

- Where chat conversation history is saved
- Each conversation is stored as a JSON file
- Enables conversation persistence across sessions

#### 4. Report Output Directory

```
Report Output Directory: Reports
```

- Destination folder for generated reports
- Reports are saved as Markdown files with timestamps

#### 5. Maximum Notes for Context

```
Max Notes: 10
```

- Number of notes to include when answering questions
- Higher values provide more context but may slow responses
- Recommended: 5-15 for optimal performance

### Advanced Settings

#### Custom System Prompt

Customize the AI's behavior by modifying the system prompt:

```
System Prompt: You are an OSINT research assistant...
```

This controls how the AI responds to your queries and can be tailored for specific research domains.

### Feature Access Overview

#### Free Features (No License Key Required)
- **Entity Graph View**: Visualize relationships between entities
- **Timeline View**: See events in chronological order
- **Map View**: Display locations on an interactive map
- **Manual Entity Creation**: Create and manage entities manually
- **Note Organization**: Use the entity base path structure

#### AI Features (License Key Required)
- **Vault Q&A**: Ask questions about your research notes
- **Entity Extraction**: Automatically extract entities from text
- **Dark Web Investigation**: Search dark web engines via Tor
- **Report Generation**: Generate AI-powered threat intelligence reports
- **Relationship Detection**: Automatically identify connections between entities

---

## Core Features

### Opening the OSINT Copilot Interface

Access the main chat interface via:
- **Ribbon Icon**: Click the OSINT Copilot icon in the left sidebar
- **Command Palette**: `Ctrl/Cmd + P` → "OSINT Copilot: Open Chat"

### Operating Modes

The plugin offers four operating modes, accessible via toggles in the chat header:

| Mode | Icon | Description |
|------|------|-------------|
| **Lookup Mode** | 🔍 | Query your vault notes with AI assistance (default) |
| **Dark Web Mode** | 🕵️ | Search dark web sources via Tor |
| **Report Mode** | 📄 | Generate comprehensive threat reports |
| **Entity Mode** | 🏷️ | Extract entities from text (can combine with other modes) |

> **Note**: Lookup, Dark Web, and Report modes are mutually exclusive. Entity Mode can be enabled alongside any other mode.

---

### Feature 1: Vault Q&A (Lookup Mode)

**Purpose**: Ask natural language questions about your research notes and receive AI-powered answers with source citations.

**How It Works**:
1. Enable **🔍 Lookup** mode (default)
2. Type your question in the chat input
3. The plugin:
   - Indexes your vault's markdown files
   - Extracts relevant entities from your query
   - Retrieves matching notes
   - Generates a contextual answer using AI
4. View the response with clickable links to source notes

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

### Feature 3: Dark Web Investigation

**Purpose**: Conduct automated searches across 15+ dark web engines via Tor to find threat intelligence.

**How to Use**:
1. Enable **🕵️ Dark Web** mode
2. Enter your investigation query
3. Wait for results (typically 2-3 minutes)
4. Review the AI-generated summary

**Example Queries**:
```
Find mentions of "company-name" data breach
Search for leaked credentials related to domain.com
Investigate ransomware group "LockBit" recent activity
```

**What Happens Behind the Scenes**:
1. Query is sent to the OSINT Copilot API
2. Tor-based searches across dark web engines
3. Results are collected and analyzed
4. AI generates a summary report
5. Report is saved to your vault

**Progress Tracking**:
- Real-time progress bar showing search status
- Engine count and results found
- Estimated completion time

> **Note**: Dark web investigations consume quota. Check your usage at [osint-copilot.com/dashboard](https://osint-copilot.com/dashboard/)

---

### Feature 4: Report Generation

**Purpose**: Generate comprehensive threat intelligence reports using AI and web research.

**How to Use**:
1. Enable **📄 Report** mode
2. Describe the report you want
3. Wait for generation (shows progress and intermediate results)
4. Report is automatically saved to your vault

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

### Feature 5: Entity Extraction Mode

**Purpose**: Automatically extract structured entities from any text and create linked notes.

**Two Ways to Use**:

**A. Entity-Only Mode** (All main modes OFF, Entity Mode ON):
- Paste raw text directly into the chat
- AI extracts all entities and relationships
- Creates entity notes automatically

**B. Combined Mode** (Any main mode + Entity Mode ON):
- Perform a lookup, dark web search, or report generation
- Entities are automatically extracted from the AI response
- Creates entity notes linked to your research

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

2. **Conduct Dark Web Research**
   - Switch to **🕵️ Dark Web** mode
   - Query: "APT29 Cozy Bear recent operations 2024"
   - Wait for results and review summary

3. **Generate Report**
   - Switch to **📄 Report** mode
   - Prompt: "Generate a comprehensive threat actor profile for APT29 including TTPs, infrastructure, and recent campaigns"
   - Review and edit the generated report

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

3. **Check Dark Web**
   - Enable **🕵️ Dark Web** mode
   - Query: "Find mentions of 192.168.1.100 or malware-c2.evil.com"
   - Review any dark web references

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

### License Key Issues

**Problem**: "License key required for AI features" notice

**Solutions**:
1. Open Settings → OSINT Copilot
2. Enter your license key in the "License Key" field
3. Click "Test Connection" to verify the key
4. Get a license key at [osint-copilot.com](https://osint-copilot.com)

**Note**: Visualization features (Graph, Timeline, Map) work without a license key. Only AI-powered features require a license.

**Problem**: "License key invalid" errors

**Solutions**:
1. Verify your license key in Settings → OSINT Copilot
2. Check for extra spaces or characters in the key
3. Ensure your subscription is active at [osint-copilot.com/dashboard](https://osint-copilot.com/dashboard/)
4. Try disabling and re-enabling the plugin

---

### Connection Errors

**Problem**: "Network connection error" or "Failed to fetch"

**Solutions**:
1. Check your internet connection
2. Verify firewall isn't blocking `api.osint-copilot.com`
3. Try again in a few minutes (server may be temporarily unavailable)
4. Check if you're behind a corporate proxy that blocks external APIs

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

### Plugin Not Loading

**Problem**: Plugin doesn't appear in Community Plugins list

**Solutions**:
1. Verify files are in correct location: `.obsidian/plugins/OSINT-copilot-plugin/`
2. Ensure `manifest.json`, `main.js`, and `styles.css` are present
3. Check Obsidian version is 1.5.0 or higher
4. Try restarting Obsidian completely
5. Check console for JavaScript errors

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

### Security Considerations

1. **API Key Security**
   - Don't share your license key
   - Key is stored locally in Obsidian settings

2. **Sensitive Data**
   - Be mindful of what you send to AI services
   - Dark web queries are processed via secure API

3. **Local Storage**
   - Entity notes and conversations are stored locally
   - Reports are saved as local markdown files

---

## Getting Help

- **Documentation**: Check the included `DOCUMENTATION.md` for technical details
- **API Guide**: See `API_INTEGRATION_GUIDE.md` for API specifications
- **Dashboard**: [osint-copilot.com/dashboard](https://osint-copilot.com/dashboard/) for account management
- **Support**: Contact support through the dashboard for technical issues

---

*OSINT Copilot Plugin v0.1.0 - Empowering SOC Analysts with AI-Powered Threat Research*