import { describe, it, expect } from 'vitest';
import { parseEntityYaml, parseCombinedSchemaYaml } from '../src/services/schema-definition-loader';
import { mergeEnabledFamilies } from '../src/services/schema-catalog-service';
import { DEFAULT_ENABLED_SCHEMA_FAMILIES } from '../src/services/schema-catalog-types';

describe('schema-definition-loader', () => {
	it('parses stix2 entities.yaml shape', () => {
		const yaml = `
version: 1
family: stix2
entityTypes:
  - name: threat-actor
    label: Threat Actor
    labelField: name
    required: [name]
    featured: [name]
    properties:
      name: { label: Name }
`;
		const doc = parseEntityYaml(yaml, 'virtual');
		expect(doc.family).toBe('stix2');
		expect(doc.entityTypes).toHaveLength(1);
		expect(doc.entityTypes[0].name).toBe('threat-actor');
	});

	it('parses combined user schema yaml', () => {
		const yaml = `
family: user
entityTypes:
  - name: my-type
    label: My Type
    labelField: title
    required: [title]
    featured: [title]
    properties:
      title: { label: Title }
relationshipTypes:
  - name: related
    label: Related
    description: Link
    featured: []
    required: []
    properties: {}
`;
		const combined = parseCombinedSchemaYaml(yaml);
		expect(combined.family).toBe('user');
		expect(combined.entityTypes.length).toBe(1);
		expect(combined.relationshipTypes.length).toBe(1);
	});
});

describe('mergeEnabledFamilies', () => {
	it('fills missing keys from defaults', () => {
		const merged = mergeEnabledFamilies({ stix2: false });
		expect(merged.stix2).toBe(false);
		expect(merged.ftm).toBe(DEFAULT_ENABLED_SCHEMA_FAMILIES.ftm);
	});
});
