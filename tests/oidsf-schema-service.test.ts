import { describe, it, expect } from 'vitest';
import { ftmSchemaService } from '../src/services/ftm-schema-service';
import { canonicalSchemaName } from '../src/services/schema-name-aliases';
import { DEFAULT_OIDSF_MODAL_LAYERS } from '../src/services/schema-catalog-types';

describe('OIDSF bundled schema service', () => {
	it('resolves Person with caption and inherited properties', () => {
		const s = ftmSchemaService.getSchema('Person');
		expect(s).toBeTruthy();
		expect(s!.label).toBe('Person');
		expect(s!.allProperties.name).toBeDefined();
	});

	it('aliases legacy UserAccount to OnlineAccount', () => {
		expect(canonicalSchemaName('UserAccount')).toBe('OnlineAccount');
		const a = ftmSchemaService.getSchema('UserAccount');
		const b = ftmSchemaService.getSchema('OnlineAccount');
		expect(a).toBeTruthy();
		expect(b).toBeTruthy();
		expect(a!.name).toBe('OnlineAccount');
		expect(b!.name).toBe('OnlineAccount');
	});

	it('classifies layers for modal filtering', () => {
		expect(ftmSchemaService.getSchemaModalLayer('Person')).toBe('world');
		expect(ftmSchemaService.getSchemaModalLayer('Malware')).toBe('cyber');
		expect(ftmSchemaService.getSchemaModalLayer('Claim')).toBe('analysis');
		expect(ftmSchemaService.getSchemaModalLayer('Employment')).toBe('links');
	});

	it('schemaPassesModalLayer respects toggles', () => {
		const layersOffCyber = { ...DEFAULT_OIDSF_MODAL_LAYERS, cyber: false };
		expect(ftmSchemaService.schemaPassesModalLayer('Malware', layersOffCyber)).toBe(false);
		const layersOnCyber = { ...DEFAULT_OIDSF_MODAL_LAYERS, cyber: true };
		expect(ftmSchemaService.schemaPassesModalLayer('Malware', layersOnCyber)).toBe(true);
	});
});
