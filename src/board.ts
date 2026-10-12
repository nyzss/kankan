// Board files use this Markdown format:
//
// ---
// kankan: board
// ---
//
// %% project: Website #work %%
//
// ## Todo
// - Card title [project:: Website] #work #urgent
//   Description lines, indented.
//
// ## Archive %% collapsed %%

export interface Card {
	title: string;
	desc: string;
	tags: string[];
	project: string; // '' = no project
}

export interface Column {
	name: string;
	collapsed: boolean;
	cards: Card[];
}

export interface Board {
	columns: Column[];
	projectTags: Record<string, string[]>; // tags every card in the project inherits
}

export const FRONTMATTER_KEY = 'kankan';
const COLLAPSED = '%% collapsed %%';
const TAG_RE = /(^|\s)#([^\s#]+)/g;
const PROJECT_RE = /\[project::\s*([^\]]*)\]/;
const PROJECT_LINE_RE = /^%% project:\s*(.*?)\s*%%$/;

export function effectiveTags(board: Board, card: Card): string[] {
	return [
		...new Set([...card.tags, ...(board.projectTags[card.project] ?? [])]),
	];
}

export const DEFAULT_BOARD = serialize({
	columns: [
		{ name: 'Backlog', collapsed: false, cards: [] },
		{ name: 'Todo', collapsed: false, cards: [] },
		{ name: 'In progress', collapsed: false, cards: [] },
		{ name: 'Done', collapsed: false, cards: [] },
		{ name: 'Archive', collapsed: true, cards: [] },
	],
	projectTags: {},
});

export function parse(text: string): Board {
	const columns: Column[] = [];
	const projectTags: Record<string, string[]> = {};
	let card: Card | null = null;
	const body = text.replace(/^---\n[\s\S]*?\n---\n?/, '');

	for (const line of body.split('\n')) {
		const projectLine = line.match(PROJECT_LINE_RE);
		if (projectLine) {
			const raw = projectLine[1] ?? '';
			const name = raw.replace(TAG_RE, '').trim();
			if (name)
				projectTags[name] = [...raw.matchAll(TAG_RE)].map(
					(m) => m[2] ?? '',
				);
			continue;
		}
		const heading = line.match(/^##\s+(.*)$/);
		if (heading) {
			const raw = heading[1] ?? '';
			columns.push({
				name: raw.replace(COLLAPSED, '').trim(),
				collapsed: raw.includes(COLLAPSED),
				cards: [],
			});
			card = null;
			continue;
		}
		const col = columns[columns.length - 1];
		if (!col) continue;

		const item = line.match(/^[-*]\s+(?:\[.\]\s+)?(.*)$/);
		if (item) {
			const raw = item[1] ?? '';
			const tags = [...raw.matchAll(TAG_RE)].map((m) => m[2] ?? '');
			card = {
				title: raw.replace(TAG_RE, '').replace(PROJECT_RE, '').trim(),
				desc: '',
				tags,
				project: raw.match(PROJECT_RE)?.[1]?.trim() ?? '',
			};
			col.cards.push(card);
		} else if (card && /^\s+\S/.test(line)) {
			// Blank lines in descriptions are dropped. Keep them if a card has multiple paragraphs.
			card.desc += (card.desc ? '\n' : '') + line.trim();
		}
	}
	return { columns, projectTags };
}

export function serialize(board: Board): string {
	const out = ['---', `${FRONTMATTER_KEY}: board`, '---', ''];
	const projects = Object.entries(board.projectTags).filter(
		([, tags]) => tags.length,
	);
	for (const [name, tags] of projects) {
		out.push(`%% project: ${name}${tags.map((t) => ' #' + t).join('')} %%`);
	}
	if (projects.length) out.push('');
	for (const col of board.columns) {
		out.push(`## ${col.name}${col.collapsed ? ' ' + COLLAPSED : ''}`);
		for (const c of col.cards) {
			const tags = c.tags.map((t) => ' #' + t).join('');
			const project = c.project ? ` [project:: ${c.project}]` : '';
			out.push(`- ${c.title}${project}${tags}`);
			for (const d of c.desc.split('\n').filter((l) => l.trim())) {
				out.push('  ' + d.trim());
			}
		}
		out.push('');
	}
	return out.join('\n');
}
