import { describe, it, expect } from 'vitest';
import {
	buildDeleteScriptSideBySideRows,
	buildScriptSideBySideRows,
} from '../src/ui/vault-script-side-diff';

describe('vault-script-side-diff', () => {
	it('buildScriptSideBySideRows: same-only yields equal rows', () => {
		const t = 'a\nb\nc';
		const { rows, truncated } = buildScriptSideBySideRows(t, t);
		expect(truncated).toBe(false);
		expect(rows).toEqual([
			{ left: 'a', right: 'a', kind: 'equal' },
			{ left: 'b', right: 'b', kind: 'equal' },
			{ left: 'c', right: 'c', kind: 'equal' },
		]);
	});

	it('buildScriptSideBySideRows: insert block marks adds', () => {
		const { rows } = buildScriptSideBySideRows('a', 'a\nNEW\nb');
		expect(rows.some((r) => r.kind === 'add' && r.right === 'NEW')).toBe(true);
		expect(rows.some((r) => r.kind === 'equal' && r.left === 'a')).toBe(true);
	});

	it('buildScriptSideBySideRows: delete block marks removes', () => {
		const { rows } = buildScriptSideBySideRows('a\nOLD\nb', 'a\nb');
		expect(rows.some((r) => r.kind === 'remove' && r.left === 'OLD')).toBe(true);
	});

	it('buildScriptSideBySideRows: respects row cap', () => {
		const left = Array.from({ length: 50 }, (_, i) => `L${i}`).join('\n');
		const right = Array.from({ length: 50 }, (_, i) => `R${i}`).join('\n');
		const { rows, truncated } = buildScriptSideBySideRows(left, right, 12);
		expect(rows.length).toBe(12);
		expect(truncated).toBe(true);
	});

	it('buildDeleteScriptSideBySideRows: empty file', () => {
		const { rows } = buildDeleteScriptSideBySideRows('');
		expect(rows).toEqual([{ left: '(empty file)', right: '(delete)', kind: 'remove' }]);
	});

	it('buildDeleteScriptSideBySideRows: marks first line', () => {
		const { rows } = buildDeleteScriptSideBySideRows('one\ntwo');
		expect(rows[0]).toMatchObject({ left: 'one', right: '(delete)', kind: 'remove' });
		expect(rows[1]).toMatchObject({ left: 'two', right: '', kind: 'remove' });
	});
});
