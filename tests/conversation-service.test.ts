import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { ConversationService } from '../src/services/conversation-service';

/** Minimal in-memory fake of the parts of App/Vault ConversationService touches. */
function fakeApp() {
	const files = new Map<string, string>();
	const folders = new Set<string>();

	const vault = {
		adapter: {
			exists: async (path: string) =>
				folders.has(path) || files.has(path) || [...files.keys()].some((p) => p.startsWith(`${path}/`)),
			list: async (path: string) => ({
				files: [...files.keys()].filter((p) => p.startsWith(`${path}/`)),
				folders: [],
			}),
			read: async (path: string) => {
				const content = files.get(path);
				if (content === undefined) throw new Error(`File not found: ${path}`);
				return content;
			},
			write: async (path: string, content: string) => {
				files.set(path, content);
			},
			remove: async (path: string) => {
				files.delete(path);
			},
		},
		getAbstractFileByPath: (path: string) => (folders.has(path) ? {} : null),
		createFolder: async (path: string) => {
			folders.add(path);
		},
		create: async (path: string, content: string) => {
			if (files.has(path)) throw new Error('File already exists.');
			files.set(path, content);
		},
	};

	return { app: { vault } as any, files };
}

describe('ConversationService frontmatter title round-trip', () => {
	it('YAML-escapes a title derived from a file-attachment display message and round-trips it exactly', async () => {
		const { app, files } = fakeApp();
		const service = new ConversationService(app, 'OSINTCopilot/conversations');

		// This is exactly the real shape produced when a user types text and also attaches a
		// file: handleSend's displayValue becomes `${text}\n\n📎 ${filename}` (see chat-view.ts).
		// The embedded newlines are the actual break: generateTitle truncates this into the
		// conversation's title, and writing that raw made a single YAML scalar span multiple
		// physical lines -- exactly the "Implicit keys need to be on a single line" error seen
		// in production, reproduced here byte-for-byte from a real broken conversation file.
		const firstMessage = 'Extract entities\n\n📎 IPG_VPG Laser - Ire Polyus.pdf';
		const conversation = await service.createConversation(firstMessage, 'general');

		const [path, content] = [...files.entries()][0];
		expect(path).toContain(conversation.id);

		const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
		expect(frontmatterMatch).not.toBeNull();

		const expectedTitle = 'Extract entities\n\n📎 IPG_VPG Laser - Ire Polyus.pd...'; // generateTitle truncates to 50 chars

		// The whole point: this must be valid YAML, not just "recoverable via line fallback".
		const parsed = parseYaml(frontmatterMatch![1]);
		expect(parsed.title).toBe(expectedTitle);

		// And the service's own reader must return the same, unescaped, no stray quote marks.
		const list = await service.loadConversationList();
		expect(list[0].title).toBe(expectedTitle);
	});

	it('round-trips a title containing a Unicode line separator (U+2028), which JSON.stringify alone leaves unescaped', async () => {
		const { app, files } = fakeApp();
		const service = new ConversationService(app, 'OSINTCopilot/conversations');

		// U+2028/U+2029 are valid inside a JS string and pass through JSON.stringify unescaped,
		// but extractYamlValue's line-oriented regex treats them as line terminators -- without
		// explicitly escaping them too, the title still silently truncates on read.
		const firstMessage = `before${String.fromCharCode(0x2028)}after`;
		await service.createConversation(firstMessage, 'general');

		const [, content] = [...files.entries()][0];
		const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
		const parsed = parseYaml(frontmatterMatch![1]);
		expect(parsed.title).toBe(firstMessage);

		const list = await service.loadConversationList();
		expect(list[0].title).toBe(firstMessage);
	});

	it('still parses titles from older, unescaped conversation files (no regression for existing vaults)', async () => {
		const { app, files } = fakeApp();
		const service = new ConversationService(app, 'OSINTCopilot/conversations');
		files.set(
			'OSINTCopilot/conversations/conv-legacy.md',
			[
				'---',
				'id: conv-legacy',
				'title: Plain old title',
				'createdAt: 1000',
				'updatedAt: 1000',
				'messageCount: 0',
				'chatMode: general',
				'localSearchMode: false',
				'graphGenerationMode: false',
				'orchestrationMode: true',
				'vaultGraphIngestMode: false',
				'---',
				'```json:messages\n[]\n```',
			].join('\n'),
		);

		const list = await service.loadConversationList();
		expect(list[0].title).toBe('Plain old title');
	});
});
