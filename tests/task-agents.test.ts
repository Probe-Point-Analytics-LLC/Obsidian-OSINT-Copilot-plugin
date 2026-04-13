import { describe, it, expect } from 'vitest';
import { parseTaskAgentMarkdown } from '../src/task-agents/parse-manifest';
import { isPathAllowedForWrite } from '../src/task-agents/path-allowlist';
import { parseVaultFilesJson } from '../src/task-agents/json-response';
import { isTaskAgentRunnable } from '../src/task-agents/task-agent-settings';
import type { TaskAgentManifest } from '../src/task-agents/types';

describe('parseTaskAgentMarkdown', () => {
  it('returns null for orchestration agent (no agent_kind task)', () => {
    const raw = `---
id: x
name: X
---
body`;
    expect(parseTaskAgentMarkdown(raw, 'p.md')).toBeNull();
  });

  it('parses valid task manifest', () => {
    const raw = `---
agent_kind: task
id: test-agent
name: Test
output_schema: vault_files_v1
output_roots: .osint-copilot/out/, Research/r/
max_notes: 5
---
Do the thing.
`;
    const m = parseTaskAgentMarkdown(raw, 'agents/test.md');
    expect(m).not.toBeNull();
    expect(m!.id).toBe('test-agent');
    expect(m!.outputRoots).toEqual([".osint-copilot/out", "Research/r"]);
    expect(m!.maxNotes).toBe(5);
    expect(m!.body).toContain('Do the thing');
  });

  it('returns null without output_roots', () => {
    const raw = `---
agent_kind: task
id: x
name: X
output_schema: vault_files_v1
---
b`;
    expect(parseTaskAgentMarkdown(raw, 'p.md')).toBeNull();
  });
});

describe('isPathAllowedForWrite', () => {
  it('allows path under both agent and global roots', () => {
    expect(
      isPathAllowedForWrite(
        '.osint-copilot/outputs/memos/2024-01-01.md',
        ['.osint-copilot/outputs/memos/'],
        ['.osint-copilot/outputs/', 'Research/'],
      ),
    ).toBe(true);
  });

  it('rejects path outside agent root', () => {
    expect(
      isPathAllowedForWrite(
        'Research/secret.md',
        ['.osint-copilot/outputs/memos/'],
        ['.osint-copilot/outputs/', 'Research/'],
      ),
    ).toBe(false);
  });

  it('rejects path outside global root', () => {
    expect(
      isPathAllowedForWrite(
        '.osint-copilot/outputs/memos/x.md',
        ['.osint-copilot/outputs/memos/'],
        ['Research/'],
      ),
    ).toBe(false);
  });

  it('rejects dotdot', () => {
    expect(
      isPathAllowedForWrite(
        '.osint-copilot/outputs/../etc/passwd',
        ['.osint-copilot/outputs/'],
        ['.osint-copilot/'],
      ),
    ).toBe(false);
  });
});

describe('parseVaultFilesJson', () => {
  it('parses raw JSON', () => {
    const raw = JSON.stringify({
      version: 'vault_files_v1',
      files: [{ path: 'a.md', body: 'hi' }],
    });
    const v = parseVaultFilesJson(raw);
    expect(v?.files).toHaveLength(1);
    expect(v?.files[0].path).toBe('a.md');
  });

  it('extracts from fenced block', () => {
    const raw = 'Here:\n```json\n{"version":"vault_files_v1","files":[]}\n```';
    const v = parseVaultFilesJson(raw);
    expect(v?.files).toEqual([]);
  });
});

describe('isTaskAgentRunnable', () => {
  const base: TaskAgentManifest = {
    agentKind: 'task',
    id: 'a',
    name: 'A',
    description: '',
    outputSchema: 'vault_files_v1',
    outputRoots: ['x/'],
    contextRoots: [],
    maxNotes: 10,
    maxContextChars: 100,
    enabledDefault: true,
    model: '',
    body: '',
    sourcePath: '',
  };

  it('respects master switch', () => {
    expect(
      isTaskAgentRunnable(base, {
        taskAgentsEnabled: false,
        taskAgentOverrides: {},
      }),
    ).toBe(false);
  });

  it('override false disables', () => {
    expect(
      isTaskAgentRunnable(base, {
        taskAgentsEnabled: true,
        taskAgentOverrides: { a: false },
      }),
    ).toBe(false);
  });

  it('override true enables when default false', () => {
    const m = { ...base, enabledDefault: false };
    expect(
      isTaskAgentRunnable(m, {
        taskAgentsEnabled: true,
        taskAgentOverrides: { a: true },
      }),
    ).toBe(true);
  });
});
