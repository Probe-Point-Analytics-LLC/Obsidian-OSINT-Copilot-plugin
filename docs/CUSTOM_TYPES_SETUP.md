# Custom Types Setup (YAML Schemas)

This guide explains how to add your own entity and relationship types using vault YAML files, and how those files map to the schema toggles in plugin settings.

## What you can customize

You can add or override schema definitions in your vault under:

- `OSINTCopilot/schemas/user/` (recommended for custom work)
- `OSINTCopilot/schemas/stix2/`
- `OSINTCopilot/schemas/mitre/`

The plugin loads YAML files from those folders and exposes the resulting types in entity/connection pickers.

Bundled FTM/OIDSF types are built into the plugin and are not edited directly in your vault.

## How settings map to schema formats

In **Settings -> OSINT Copilot -> Graph view**:

- **Schema families in type pickers**
  - Controls schema _sources_:
    - bundled `ftm` (OIDSF-derived)
    - vault `stix2`
    - vault `mitre`
    - vault `user`
- **OIDSF bundled schema layers**
  - Filters only bundled OIDSF classes:
    - `World`
    - `Links`
    - `Cyber`
    - `Analysis`

These filters hide/show options in pickers. They do not delete existing notes, and existing entities in the vault still resolve in graph rendering.

## YAML schema file shape

Each file can contain one or both sections:

- `entityTypes`
- `relationshipTypes`

Required top-level keys:

- `version` (optional but recommended)
- `family` (`user`, `stix2`, or `mitre`)

### Minimal entity type

```yaml
version: 1
family: user
entityTypes:
  - name: Company
    label: Company
    properties:
      name: Name
```

## Example 1: Custom Person and Company entities

Create `OSINTCopilot/schemas/user/custom-entities.yaml`:

```yaml
version: 1
family: user

entityTypes:
  - name: Person
    label: Person
    plural: People
    description: Individual person profile
    color: "#1565C0"
    labelField: full_name
    required: [full_name]
    featured: [full_name, nationality, date_of_birth]
    properties:
      full_name:
        label: Full Name
        type: string
      nationality:
        label: Nationality
        type: string
      date_of_birth:
        label: Date of Birth
        type: date
      passport_number:
        label: Passport Number
        type: string

  - name: Company
    label: Company
    plural: Companies
    description: Registered legal entity
    color: "#2E7D32"
    labelField: name
    required: [name]
    featured: [name, registration_number, jurisdiction]
    properties:
      name:
        label: Legal Name
        type: string
      registration_number:
        label: Registration Number
        type: string
      jurisdiction:
        label: Jurisdiction
        type: string
      website:
        label: Website
        type: string
```

## Example 2: Custom relationship type

Create `OSINTCopilot/schemas/user/custom-relationships.yaml`:

```yaml
version: 1
family: user

relationshipTypes:
  - name: EMPLOYED_BY
    label: Employed by
    description: Person is employed by company
    color: "#8E24AA"
    featured: [role, since]
    properties:
      role:
        label: Role
        type: string
      since:
        label: Since
        type: date
```

## Apply and verify

1. Save YAML files in `OSINTCopilot/schemas/user/`.
2. Ensure **User YAML (schemas/user)** is enabled in **Schema families in type pickers**.
3. Open entity/connection creation dialogs in Graph view.
4. Your custom types should appear with the labels and fields defined in YAML.

If types do not appear immediately:

- close and reopen the modal
- edit/save the YAML file again
- reload plugin/app if needed

## Common pitfalls

- `family` must be one of: `user`, `stix2`, `mitre`
- `entityTypes` and `relationshipTypes` must be arrays
- YAML indentation must be valid (spaces, not tabs)
- `name` should be stable once used in existing notes

## Related standards documentation

- FollowTheMoney (FTM): <https://followthemoney.tech>
- STIX 2.1 docs (OASIS CTI): <https://oasis-open.github.io/cti-documentation/stix/intro>
- MITRE ATT&CK: <https://attack.mitre.org>
