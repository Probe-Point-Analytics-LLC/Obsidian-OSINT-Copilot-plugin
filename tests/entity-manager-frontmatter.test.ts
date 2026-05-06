import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App, TFile } from 'obsidian';
import { EntityManager } from '../src/services/entity-manager';

describe('EntityManager frontmatter reserved-key handling', () => {
  let app: App;
  let manager: EntityManager;

  beforeEach(() => {
    app = new App();
    manager = new EntityManager(app as any, 'OSINTCopilot', null);
  });

  it('writes reserved property keys under props namespace', () => {
    const fm = (manager as any).buildFTMFrontmatter(
      {
        id: 'e1',
        type: 'Address',
        label: 'Address',
        properties: {
          type: 'residence',
          city: 'Prato',
        },
      },
      'Address',
    ) as string;

    expect(fm).toContain('type: Address');
    expect(fm).toContain('city: "Prato"');
    expect(fm).toContain('props:');
    expect(fm).toContain('  type: residence');
    expect(/^type:\s*"residence"$/m.test(fm)).toBe(false);
  });

  it('parses frontmatter props block and preserves entity type', async () => {
    const file = new TFile() as any;
    file.path = 'OSINTCopilot/ftm/Address/Address.md';

    const content = `---
id: "e2"
type: Address
schemaFamily: ftm
ftmSchema: Address
label: "Address"
city: "LegacyCity"
props:
  type: "residence"
  city: "Prato"
---

# Address
`;
    (app.vault.read as any) = vi.fn().mockResolvedValue(content);

    const entity = await (manager as any).parseEntityFromNote(file, 'ftm');
    expect(entity).toBeTruthy();
    expect(entity.type).toBe('Address');
    expect(entity.properties.type).toBe('residence');
    expect(entity.properties.city).toBe('Prato');
  });

  it('still parses legacy notes without props block', async () => {
    const file = new TFile() as any;
    file.path = 'OSINTCopilot/ftm/Document/Doc.md';

    const content = `---
id: "e3"
type: Document
schemaFamily: ftm
ftmSchema: Document
label: "Document"
document_kind: "EHIC"
---

# Document
`;
    (app.vault.read as any) = vi.fn().mockResolvedValue(content);

    const entity = await (manager as any).parseEntityFromNote(file, 'ftm');
    expect(entity).toBeTruthy();
    expect(entity.type).toBe('Document');
    expect(entity.properties.document_kind).toBe('EHIC');
  });
});
