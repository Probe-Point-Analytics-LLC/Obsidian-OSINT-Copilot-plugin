import { describe, it, expect } from 'vitest';
import { GraphApiService } from '../src/services/api-service';

// pdf.js's own "isNodeJS" environment check special-cases plain Node.js (auto-disabling its
// worker and bypassing GlobalWorkerOptions.workerSrc entirely) but NOT Electron's renderer
// process, which is what Obsidian actually runs in. Simulating that here before pdfjs-dist is
// first loaded (the require() is lazy, inside extractPdfText) makes this test exercise the real
// code path — without it, this suite would pass even against a build that's broken under Electron.
Object.defineProperty(process, 'versions', {
	value: { ...process.versions, electron: '33.0.0' },
	configurable: true,
});
(process as unknown as { type: string }).type = 'renderer';

/**
 * Hand-builds a minimal single-page PDF containing one Tj text-drawing operator, so extraction
 * can be tested without a committed binary fixture. The exact xref offsets aren't load-bearing —
 * pdf.js falls back to scanning for "N G obj" markers when they don't check out.
 */
function buildMinimalPdf(text: string): Buffer {
	const stream = `BT /F1 24 Tf 20 100 Td (${text}) Tj ET`;
	const objs: Record<number, string> = {
		1: `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,
		2: `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`,
		3: `3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 200 200] /Contents 5 0 R >>\nendobj\n`,
		4: `4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`,
		5: `5 0 obj\n<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream\nendobj\n`,
	};

	let out = '%PDF-1.4\n';
	const offsets: number[] = [0];
	for (let i = 1; i <= 5; i++) {
		offsets[i] = Buffer.byteLength(out, 'latin1');
		out += objs[i];
	}
	const xrefOffset = Buffer.byteLength(out, 'latin1');
	out += `xref\n0 6\n0000000000 65535 f \n`;
	for (let i = 1; i <= 5; i++) {
		out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
	}
	out += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
	return Buffer.from(out, 'latin1');
}

describe('GraphApiService PDF extraction (pdfjs-dist, no external binary)', () => {
	it('extracts real text from a PDF without configuring GlobalWorkerOptions.workerSrc', async () => {
		const pdfBytes = buildMinimalPdf('Hello OSINT Copilot');
		const file = new File([new Uint8Array(pdfBytes)], 'test.pdf', { type: 'application/pdf' });

		const service = new GraphApiService();
		const text = await service.extractTextFromFile(file);

		expect(text.length).toBeGreaterThan(0);
		expect(text.toLowerCase()).toContain('hello');
	});

	it('throws a clear error for an empty/whitespace-only extraction result', async () => {
		// A single blank page (no Tj operator) should be reported as likely image-based, not
		// silently return empty text.
		const objs: Record<number, string> = {
			1: `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`,
			2: `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`,
			3: `3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << >> /MediaBox [0 0 200 200] /Contents 4 0 R >>\nendobj\n`,
			4: `4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n`,
		};
		let out = '%PDF-1.4\n';
		const offsets: number[] = [0];
		for (let i = 1; i <= 4; i++) {
			offsets[i] = Buffer.byteLength(out, 'latin1');
			out += objs[i];
		}
		const xrefOffset = Buffer.byteLength(out, 'latin1');
		out += `xref\n0 5\n0000000000 65535 f \n`;
		for (let i = 1; i <= 4; i++) {
			out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
		}
		out += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
		const pdfBytes = Buffer.from(out, 'latin1');
		const file = new File([new Uint8Array(pdfBytes)], 'blank.pdf', { type: 'application/pdf' });

		const service = new GraphApiService();
		await expect(service.extractTextFromFile(file)).rejects.toThrow(/image-based|scanned/i);
	});
});
