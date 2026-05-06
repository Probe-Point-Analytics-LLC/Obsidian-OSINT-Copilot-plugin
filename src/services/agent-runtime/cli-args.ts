/**
 * Split a single settings string into argv tokens (whitespace-separated).
 * Same behavior as Hermes "extra args" — no shell quoting; use simple tokens only.
 */
export function splitCliArgsLine(line: string): string[] {
    const s = line.trim();
    if (!s) return [];
    return s.split(/\s+/).filter(Boolean);
}
