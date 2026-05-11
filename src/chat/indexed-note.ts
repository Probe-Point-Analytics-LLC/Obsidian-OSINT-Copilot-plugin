export interface IndexedNote {
	path: string;
	content: string;
	tags: string[];
	links: string[];
	frontmatter?: Record<string, unknown>;
	updated: number;
}
