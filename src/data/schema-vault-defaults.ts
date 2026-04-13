/**
 * Default vault files under OSINTCopilot/schemas (bootstrap when missing).
 */

export const SCHEMA_VAULT_DEFAULT_FILES: { path: string; content: string }[] = [
	{
		path: 'schemas/README.md',
		content: `# OSINT Copilot schema definitions

This folder holds **YAML** definitions for non-FTM entity and relationship types.

- **stix2/** — STIX 2.1–aligned types (starter set; edit freely).
- **mitre/** — MITRE ATT&CK–oriented types (starter set).
- **user/** — Your own \`.yaml\` files (\`family: user\`).

FTM types remain **bundled in the plugin** and are toggled with the **FTM** filter in the entity picker.

After editing YAML, reload the plugin or use **Reload app** if types do not refresh.

See \`entities.yaml\` and \`relationships.yaml\` in each subfolder for the file format.
`,
	},
	{
		path: 'schemas/stix2/entities.yaml',
		content: `# STIX 2.1–oriented entity types (starter set)
version: 1
family: stix2
entityTypes:
  - name: threat-actor
    label: Threat Actor
    plural: Threat Actors
    description: Individual or group posing a threat.
    color: "#c62828"
    labelField: name
    required: [name]
    featured: [name, description, aliases]
    properties:
      name: { label: Name, type: string }
      description: { label: Description, type: text }
      aliases: { label: Aliases, type: text }

  - name: intrusion-set
    label: Intrusion Set
    plural: Intrusion Sets
    description: Group of adversary behavior and resources.
    color: "#6a1b9a"
    labelField: name
    required: [name]
    featured: [name, description]
    properties:
      name: { label: Name, type: string }
      description: { label: Description, type: text }

  - name: malware
    label: Malware
    plural: Malware
    description: Malicious code or family.
    color: "#d84315"
    labelField: name
    required: [name]
    featured: [name, description]
    properties:
      name: { label: Name, type: string }
      description: { label: Description, type: text }

  - name: tool
    label: Tool
    plural: Tools
    description: Software used for legitimate or malicious purposes.
    color: "#ef6c00"
    labelField: name
    required: [name]
    featured: [name, description]
    properties:
      name: { label: Name, type: string }
      description: { label: Description, type: text }

  - name: campaign
    label: Campaign
    plural: Campaigns
    description: Group of intrusion activities.
    color: "#00838f"
    labelField: name
    required: [name]
    featured: [name, description]
    properties:
      name: { label: Name, type: string }
      description: { label: Description, type: text }

  - name: indicator
    label: Indicator
    plural: Indicators
    description: Observable pattern for detection.
    color: "#1565c0"
    labelField: name
    required: [name]
    featured: [name, pattern, description]
    properties:
      name: { label: Name, type: string }
      pattern: { label: Pattern, type: string }
      description: { label: Description, type: text }

  - name: ipv4-addr
    label: IPv4 Address
    plural: IPv4 Addresses
    description: IPv4 observable.
    color: "#2e7d32"
    labelField: value
    required: [value]
    featured: [value]
    properties:
      value: { label: Address, type: string }

  - name: domain-name
    label: Domain Name
    plural: Domain Names
    description: Domain observable.
    color: "#37474f"
    labelField: value
    required: [value]
    featured: [value]
    properties:
      value: { label: Domain, type: string }

  - name: url
    label: URL
    plural: URLs
    description: URL observable.
    color: "#455a64"
    labelField: value
    required: [value]
    featured: [value]
    properties:
      value: { label: URL, type: string }
`,
	},
	{
		path: 'schemas/stix2/relationships.yaml',
		content: `# STIX relationship types (starter vocabulary)
version: 1
family: stix2
relationshipTypes:
  - name: indicates
    label: Indicates
    description: Indicator indicates a SDO.
    color: "#5c6bc0"
    properties:
      description: { label: Notes, type: text }

  - name: uses
    label: Uses
    description: Threat uses malware, tool, or technique.
    color: "#7e57c2"
    properties:
      description: { label: Notes, type: text }

  - name: targets
    label: Targets
    description: Targets victim or location.
    color: "#e53935"
    properties:
      description: { label: Notes, type: text }

  - name: related-to
    label: Related To
    description: Generic relationship.
    color: "#78909c"
    properties:
      description: { label: Notes, type: text }

  - name: attributed-to
    label: Attributed To
    description: Campaign or intrusion set attributed to threat actor.
    color: "#8d6e63"
    properties:
      description: { label: Notes, type: text }

  - name: communicates-with
    label: Communicates With
    description: Network communication relationship.
    color: "#43a047"
    properties:
      description: { label: Notes, type: text }
`,
	},
	{
		path: 'schemas/mitre/entities.yaml',
		content: `# MITRE ATT&CK–oriented entity types (starter set)
version: 1
family: mitre
entityTypes:
  - name: attack-pattern
    label: Technique
    plural: Techniques
    description: ATT&CK technique or sub-technique behavior.
    color: "#c62828"
    labelField: name
    required: [name]
    featured: [name, external_id, description]
    properties:
      name: { label: Name, type: string }
      external_id: { label: External ID, type: string }
      description: { label: Description, type: text }

  - name: mitre-tactic
    label: Tactic
    plural: Tactics
    description: ATT&CK tactic (TAxxxx).
    color: "#6a1b9a"
    labelField: name
    required: [name]
    featured: [name, external_id]
    properties:
      name: { label: Name, type: string }
      external_id: { label: External ID, type: string }
      description: { label: Description, type: text }

  - name: mitre-group
    label: Group
    plural: Groups
    description: Threat group (intrusion set in ATT&CK).
    color: "#283593"
    labelField: name
    required: [name]
    featured: [name, aliases, description]
    properties:
      name: { label: Name, type: string }
      aliases: { label: Aliases, type: text }
      description: { label: Description, type: text }

  - name: mitre-software
    label: Software
    plural: Software
    description: Software entry in ATT&CK (tool or malware).
    color: "#ef6c00"
    labelField: name
    required: [name]
    featured: [name, external_id]
    properties:
      name: { label: Name, type: string }
      external_id: { label: External ID, type: string }
      description: { label: Description, type: text }

  - name: mitre-data-source
    label: Data Source
    plural: Data Sources
    description: ATT&CK data source for detections.
    color: "#00838f"
    labelField: name
    required: [name]
    featured: [name, description]
    properties:
      name: { label: Name, type: string }
      description: { label: Description, type: text }
`,
	},
	{
		path: 'schemas/mitre/relationships.yaml',
		content: `# MITRE-oriented relationship types (starter)
version: 1
family: mitre
relationshipTypes:
  - name: subtechnique-of
    label: Sub-technique Of
    description: Technique is a sub-technique of another.
    color: "#8e24aa"
    properties:
      description: { label: Notes, type: text }

  - name: mitre-uses
    label: Uses
    description: Group or software uses technique.
    color: "#6d4c41"
    properties:
      description: { label: Notes, type: text }

  - name: mitre-mitigates
    label: Mitigates
    description: Mitigation addresses technique.
    color: "#2e7d32"
    properties:
      description: { label: Notes, type: text }

  - name: mitre-attributed-to
    label: Attributed To
    description: Campaign attributed to group.
    color: "#3949ab"
    properties:
      description: { label: Notes, type: text }
`,
	},
	{
		path: 'schemas/user/example-user-types.yaml',
		content: `# Example: add your own types (family must be user)
version: 1
family: user
entityTypes: []
relationshipTypes: []
`,
	},
];
