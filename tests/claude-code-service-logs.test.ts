import { describe, it, expect, vi } from 'vitest';
import { ClaudeCodeService, sanitizeCliOutput, type ExtractionLogEvent } from '../src/services/claude-code-service';

describe('ClaudeCodeService extraction logging', () => {
  it('sanitizes ANSI/control chars and truncates output', () => {
    const dirty = '\u001b[31mERROR\u001b[0m \u0007 hello world '.repeat(30);
    const clean = sanitizeCliOutput(dirty, 60);
    expect(clean.includes('\u001b')).toBe(false);
    expect(clean.includes('\u0007')).toBe(false);
    expect(clean.length).toBeLessThanOrEqual(61);
  });

  it('emits parse_failed event when response is not JSON', async () => {
    const svc = new ClaudeCodeService('', { cliPath: 'claude', model: 'sonnet' });
    (svc as any).invokeCLI = vi.fn().mockResolvedValue('not-json');
    const logs: ExtractionLogEvent[] = [];

    const res = await svc.extractEntities('hello', [], undefined, undefined, {
      emit: (ev) => logs.push(ev),
    });

    expect(res.success).toBe(false);
    expect(logs.some((l) => l.phase === 'parse_failed')).toBe(true);
  });

  it('emits parse_success event for valid operations payload', async () => {
    const svc = new ClaudeCodeService('', { cliPath: 'claude', model: 'sonnet' });
    (svc as any).invokeCLI = vi.fn().mockResolvedValue('{"operations":[{"action":"create","entities":[],"connections":[]}]}');
    const logs: ExtractionLogEvent[] = [];

    const res = await svc.extractEntities('hello', [], undefined, undefined, {
      emit: (ev) => logs.push(ev),
    });

    expect(res.success).toBe(true);
    expect(logs.some((l) => l.phase === 'parse_success')).toBe(true);
  });
});
