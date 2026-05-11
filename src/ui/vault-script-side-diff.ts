import { diffArrays } from 'diff';

export type ScriptSideRowKind = 'equal' | 'add' | 'remove';

export interface ScriptSideBySideRow {
	left: string;
	right: string;
	kind: ScriptSideRowKind;
}

const DEFAULT_MAX_ROWS = 8000;

function pushRow(
	rows: ScriptSideBySideRow[],
	left: string,
	right: string,
	kind: ScriptSideRowKind,
	maxRows: number,
): boolean {
	rows.push({ left, right, kind });
	return rows.length >= maxRows;
}

/** Line-based diff → two-column rows (current vault | proposed). */
export function buildScriptSideBySideRows(
	currentText: string,
	proposedText: string,
	maxRows: number = DEFAULT_MAX_ROWS,
): { rows: ScriptSideBySideRow[]; truncated: boolean } {
	const leftLines = currentText.length === 0 ? [] : currentText.split('\n');
	const rightLines = proposedText.length === 0 ? [] : proposedText.split('\n');
	const parts = diffArrays(leftLines, rightLines);
	const rows: ScriptSideBySideRow[] = [];
	for (const part of parts) {
		if (part.added) {
			for (const line of part.value) {
				if (pushRow(rows, '', line, 'add', maxRows)) return { rows, truncated: true };
			}
		} else if (part.removed) {
			for (const line of part.value) {
				if (pushRow(rows, line, '', 'remove', maxRows)) return { rows, truncated: true };
			}
		} else {
			for (const line of part.value) {
				if (pushRow(rows, line, line, 'equal', maxRows)) return { rows, truncated: true };
			}
		}
	}
	return { rows, truncated: false };
}

/** Rows for delete_script: current file vs marker column. */
export function buildDeleteScriptSideBySideRows(
	currentText: string,
	maxRows: number = DEFAULT_MAX_ROWS,
): { rows: ScriptSideBySideRow[]; truncated: boolean } {
	const lines = currentText.length === 0 ? [] : currentText.split('\n');
	const rows: ScriptSideBySideRow[] = [];
	if (lines.length === 0) {
		rows.push({ left: '(empty file)', right: '(delete)', kind: 'remove' });
		return { rows, truncated: false };
	}
	for (let i = 0; i < lines.length; i++) {
		const right = i === 0 ? '(delete)' : '';
		if (pushRow(rows, lines[i], right, 'remove', maxRows)) {
			const moreLines = i < lines.length - 1;
			return { rows, truncated: moreLines };
		}
	}
	return { rows, truncated: false };
}

export function renderScriptSideBySideTable(
	parent: HTMLElement,
	rows: ScriptSideBySideRow[],
	opts?: { truncationNote?: string },
): void {
	const wrap = parent.createDiv();
	wrap.style.cssText =
		'margin-top:4px;max-height:420px;overflow:auto;border:1px solid var(--background-modifier-border);border-radius:6px;';
	const table = wrap.createEl('table');
	table.style.cssText =
		'width:100%;border-collapse:collapse;font-size:11px;font-family:var(--font-monospace);table-layout:fixed;';
	const thead = table.createEl('thead');
	const hr = thead.createEl('tr');
	const h0 = hr.createEl('th', { text: 'Current vault' });
	const h1 = hr.createEl('th', { text: 'Proposed' });
	for (const h of [h0, h1]) {
		h.style.cssText =
			'text-align:left;padding:4px 6px;border-bottom:1px solid var(--background-modifier-border);width:50%;background:var(--background-secondary);';
	}
	const tbody = table.createEl('tbody');
	for (const r of rows) {
		const tr = tbody.createEl('tr');
		const td0 = tr.createEl('td');
		const td1 = tr.createEl('td');
		const base =
			'padding:2px 6px;vertical-align:top;word-break:break-word;border-bottom:1px solid var(--background-modifier-border);white-space:pre-wrap;';
		td0.style.cssText = base;
		td1.style.cssText = base;
		if (r.kind === 'add') {
			td1.style.boxShadow = 'inset 3px 0 0 var(--text-success)';
		} else if (r.kind === 'remove') {
			td0.style.boxShadow = 'inset 3px 0 0 var(--text-error)';
		}
		td0.textContent = r.left;
		td1.textContent = r.right;
	}
	if (opts?.truncationNote) {
		const note = wrap.createEl('p', { text: opts.truncationNote });
		note.style.cssText = 'margin:6px 8px;font-size:11px;color:var(--text-muted);';
	}
}
