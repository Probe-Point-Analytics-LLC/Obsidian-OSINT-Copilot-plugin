# OSINT Copilot for Obsidian

**A comprehensive OSINT investigation plugin for Obsidian** that helps SOC analysts and threat researchers organize, analyze, and visualize intelligence data. Manage entities, relationships, timelines, and geographic data—all within your Obsidian vault.

![OSINT Copilot Interface](screenshots/Copilot%20Left%20pallete%20bigger.png)

---

## Table of Contents

- [Features Overview](#features-overview)
- [Installation](#installation)
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

## Features Overview

### 🆓 **Free Features** (No License Required)
- **Entity Graph View** - Visualize relationships between entities
- **Timeline View** - Track events chronologically
- **Location Map View** - Geographic visualization of addresses
- **Entity Management** - Create and organize entities (Person, Company, Location, etc.)
- **Relationship Mapping** - Connect entities with typed relationships
- **Geocoding** - Convert addresses to coordinates with automatic fallback

### 🔐 **AI-Powered Features** (License Key Required)
- **Entity Extraction** - Automatically extract entities from text
- **Report Generation** - Generate OSINT reports from your notes
- **Dark Web Investigations** - Search and analyze dark web content
- **Vault Q&A** - Ask questions about your vault content
- **Smart Entity Recognition** - AI-powered entity classification

---

## Installation

### Prerequisites

- **Obsidian** installed on your system ([Download here](https://obsidian.md/))
- **Git** installed (for cloning the repository)
  - Windows: [Git for Windows](https://git-scm.com/download/win)
  - macOS: Install via Homebrew (`brew install git`) or [download installer](https://git-scm.com/download/mac)
  - Linux: Install via package manager (`sudo apt install git` or `sudo yum install git`)

### Installation Steps

#### 1. **Locate your Obsidian plugins folder**

First, you need to find where Obsidian stores plugins:

- Open Obsidian Settings (⚙️)
- Navigate to **Community Plugins**
- Click the folder icon (📁) next to "Installed plugins" to open your plugins folder

![Obsidian Settings](screenshots/Copilot%20Obsidian%20settings.png)

The plugins folder path typically looks like:
- **Windows**: `C:\Users\YourName\Documents\YourVault\.obsidian\plugins\`
- **macOS**: `/Users/YourName/Documents/YourVault/.obsidian/plugins/`
- **Linux**: `/home/YourName/Documents/YourVault/.obsidian/plugins/`

#### 2. **Clone the OSINT Copilot repository**

Open a terminal/command prompt and navigate to your plugins folder, then clone the repository:

```bash
# Navigate to your Obsidian plugins folder
cd /path/to/your/vault/.obsidian/plugins/

# Clone the OSINT Copilot repository
git clone https://github.com/YourUsername/OSINT-copilot-plugin.git
```

**Alternative: Download as ZIP**

If you don't have Git installed:
1. Visit the [OSINT Copilot repository](https://github.com/YourUsername/OSINT-copilot-plugin)
2. Click the green **Code** button
3. Select **Download ZIP**
4. Extract the ZIP file
5. Rename the extracted folder to `OSINT-copilot-plugin`
6. Move the folder to your Obsidian plugins directory

#### 3. **Verify the installation files**

After cloning, your plugin folder should contain these essential files:

```
.obsidian/plugins/OSINT-copilot-plugin/
├── main.js           # Pre-built plugin code (255KB)
├── manifest.json     # Plugin metadata
├── styles.css        # Plugin styles
├── versions.json     # Version compatibility info
├── README.md         # This file
└── screenshots/      # Documentation images
```

**✅ No build required!** The repository includes pre-built distribution files (`main.js`, `manifest.json`, `styles.css`), so you don't need to run `npm install` or `npm run build`.

#### 4. **Enable the plugin in Obsidian**

- Return to Obsidian Settings → **Community Plugins**
- You may need to click **Reload** or restart Obsidian
- Find **"OSINT Copilot"** in the list of installed plugins
- Toggle it **ON**

![Enable Plugin](screenshots/Copilot%20Obsidian%20settings%20enabled%20plugin.png)

#### 5. **Verify installation**

- You should see the OSINT Copilot icon in the left ribbon
- Click the icon to open the chat interface
- The plugin is now ready to use!

### Updating the Plugin

To update to the latest version:

```bash
# Navigate to the plugin folder
cd /path/to/your/vault/.obsidian/plugins/OSINT-copilot-plugin/

# Pull the latest changes
git pull origin main
```

Then reload Obsidian or restart the app to apply the updates.

---

## Getting Started

### First Steps

Once installed, you'll see the OSINT Copilot tools in the left sidebar:

![OSINT Copilot Tools](screenshots/Copilot%20tools%20pallete%20left%20bar.png)

The plugin provides three main modes accessible from the chat interface:

1. **📊 Report** - Generate OSINT reports
2. **🕵️ Dark Web** - Investigate dark web content
3. **🔍 Lookup** - Search and analyze entities

![Report Options](screenshots/Copilot%20report%20options%20%28report%2C%20darkweb%2C%20lookup%29.png)

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

**Method 2: AI-Powered Entity Extraction**

1. Open the OSINT Copilot chat
2. Enable **Entity Generation** mode (toggle at the bottom)
3. Paste text containing entity information
4. The AI will automatically extract and create entities

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

### AI-Powered Features

AI features require a valid license key. These features use advanced language models to automate intelligence gathering and analysis.

#### Setting Up AI Features

1. Open **Settings** → **OSINT Copilot**
2. Enter your **License Key**
3. Click **"Test Connection"** to verify
4. Once verified, all AI features are enabled

#### Report Generation

Generate comprehensive OSINT reports from your notes and entities.

**How to use:**

1. Open the OSINT Copilot chat
2. Enable **📊 Report** mode
3. Enter your investigation target (e.g., "Lukoil")
4. The AI will:
   - Search your vault for relevant information
   - Extract entities and relationships
   - Generate a structured report
   - Save it to your Reports folder

![Example Report](screenshots/Copilot%20Example%20report.png)

The generated report includes:
- Executive summary
- Entity profiles
- Relationship analysis
- Timeline of events
- Source citations

![Report with Note](screenshots/Copilot%20Example%20report%20with%20the%20note.png)

#### Entity Extraction

Automatically extract entities from unstructured text.

**How to use:**

1. Open the OSINT Copilot chat
2. Enable **Entity Generation** mode (toggle at bottom)
3. Paste text (e.g., news article, report, document)
4. The AI will:
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

#### Dark Web Investigations

Search and analyze dark web content for threat intelligence.

**How to use:**

1. Open the OSINT Copilot chat
2. Enable **🕵️ Dark Web** mode
3. Enter your search query
4. The AI will:
   - Search dark web sources
   - Analyze findings
   - Extract relevant intelligence
   - Present results with source attribution

**Use cases:**
- Leaked credentials
- Threat actor profiles
- Malware analysis
- Data breach investigations

#### Vault Q&A

Ask questions about your vault content and get intelligent answers.

**How to use:**

1. Open the OSINT Copilot chat
2. Ask a question (e.g., "What do we know about Lukoil's operations in Moldova?")
3. The AI will:
   - Search your vault for relevant notes
   - Analyze the content
   - Provide a comprehensive answer
   - Show source notes with clickable links

**Example questions:**
- "Who are the key executives at Lukoil?"
- "What sanctions have been imposed on Lukoil?"
- "What locations are associated with Lukoil?"

---

### Visualization Tools

Visualization tools are **completely free** and work without a license key. They help you understand complex relationships and patterns in your intelligence data.

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

| Setting | Description | Default | Required |
|---------|-------------|---------|----------|
| **License Key** | Your OSINT Copilot license key for AI features | Empty | For AI features only |
| **Entity Base Path** | Folder where entity notes are stored | `OSINTCopilot` | No |
| **Report Output Directory** | Folder for generated reports | `Reports` | No |
| **Conversation Folder** | Folder for chat conversation history | `.osint-copilot/conversations` | No |
| **Max Notes** | Maximum notes to include in AI context | 15 | No |
| **System Prompt** | Default prompt for vault Q&A | "You are a vault assistant..." | No |
| **Graph API URL** | API endpoint for AI features | `https://api.osint-copilot.com` | For AI features only |
| **Enable Graph Features** | Toggle visualization features on/off | Enabled | No |

### Recommended Settings for SOC Analysts

**For Team Collaboration:**
- Set `Entity Base Path` to a shared folder (e.g., `Intelligence/Entities`)
- Set `Report Output Directory` to `Reports/OSINT`
- Enable version control (Git) for your vault

**For Privacy-Focused Work:**
- Keep `Enable Graph Features` ON (works locally, no data sent)
- Only enable AI features when needed
- Review `System Prompt` to ensure no sensitive data is included

**For Large Investigations:**
- Increase `Max Notes` to 20-30 for more context
- Organize entities in subfolders (e.g., `OSINTCopilot/Lukoil/`, `OSINTCopilot/Sanctions/`)

---

## Troubleshooting

### Common Issues and Solutions

#### "License key required" Notice

**Problem:** You see a notice that a license key is required for AI features.

**Solution:**
1. Open Settings → OSINT Copilot
2. Enter your license key in the "License Key" field
3. Click "Test Connection" to verify
4. If you don't have a license key, visualization features (Graph, Timeline, Map) still work for free

---

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

**Problem:** Report generation, entity extraction, or dark web search fails.

**Solution:**
1. **Verify license key** - Settings → OSINT Copilot → Test Connection
2. **Check internet connection** - AI features require internet access
3. **Review error message** - Check the chat for specific error details
4. **Try again** - Temporary API issues may resolve on retry
5. **Contact support** - If persistent, report the issue with error details

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

### Data Storage

- **Entity notes** - Stored locally in your Obsidian vault as markdown files
- **License key** - Stored securely via Obsidian's data API (encrypted)
- **Conversation history** - Stored locally in `.osint-copilot/conversations/`
- **No cloud sync** - Unless you explicitly enable Obsidian Sync or use Git

### Data Transmission

**Free Features (No Data Sent):**
- ✅ Entity Graph View - Runs entirely locally
- ✅ Timeline View - Runs entirely locally
- ✅ Location Map View - Only sends geocoding requests to OpenStreetMap (public API)

**AI Features (Data Sent to API):**
- ⚠️ Report Generation - Sends relevant note excerpts to API
- ⚠️ Entity Extraction - Sends user-provided text to API
- ⚠️ Dark Web Search - Sends search query to API
- ⚠️ Vault Q&A - Sends relevant note excerpts to API

**What is NOT sent:**
- ❌ Your entire vault
- ❌ Notes not relevant to the query
- ❌ License key (only used for authentication header)
- ❌ Personal information (unless explicitly in notes)

### Security Best Practices

1. **Review before sending** - Check what text you're sending to AI features
2. **Use local features** - Graph, Timeline, and Map work without internet
3. **Redact sensitive data** - Remove PII before using AI features
4. **Enable encryption** - Use Obsidian's vault encryption if needed
5. **Audit conversations** - Review `.osint-copilot/conversations/` periodically
6. **Secure your vault** - Use strong passwords and 2FA for cloud sync

### Compliance

- **GDPR** - No personal data is collected by the plugin itself
- **Data retention** - Conversation history is stored locally; delete manually if needed
- **Third-party APIs** - AI features use external APIs (see API provider's privacy policy)
- **Open source** - Code is available for security audits

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

