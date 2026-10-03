// Board <-> markdown. Format:
//
// ---
// kankan: board
// ---
//
// ## Todo
// - Card title #work #urgent
//   Description lines, indented.
//
// ## Archive %% collapsed %%

export interface Card {
	title: string;
	desc: string;
	tags: string[];
}

export interface Column {
	name: string;
	collapsed: boolean;
	cards: Card[];
}

export interface Board {
	columns: Column[];
}

export const FRONTMATTER_KEY = 'kankan';
const COLLAPSED = '%% collapsed %%';
const TAG_RE = /(^|\s)#([^\s#]+)/g;

export const DEFAULT_BOARD = serialize({
	columns: [
		{ name: 'Backlog', collapsed: false, cards: [] },
		{ name: 'Todo', collapsed: false, cards: [] },
		{ name: 'In progress', collapsed: false, cards: [] },
		{ name: 'Done', collapsed: false, cards: [] },
		{ name: 'Archive', collapsed: true, cards: [] },
	],
});

export function parse(text: string): Board {
	const columns: Column[] = [];
	let card: Card | null = null;
	const body = text.replace(/^---\n[\s\S]*?\n---\n?/, '');

	for (const line of body.split('\n')) {
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
				title: raw.replace(TAG_RE, '').trim(),
				desc: '',
				tags,
			};
			col.cards.push(card);
		} else if (card && /^\s+\S/.test(line)) {
			// ponytail: blank lines inside a description are dropped; keep them if anyone writes multi-paragraph cards
			card.desc += (card.desc ? '\n' : '') + line.trim();
		}
	}
	return { columns };
}

export function serialize(board: Board): string {
	const out = ['---', `${FRONTMATTER_KEY}: board`, '---', ''];
	for (const col of board.columns) {
		out.push(`## ${col.name}${col.collapsed ? ' ' + COLLAPSED : ''}`);
		for (const c of col.cards) {
			const tags = c.tags.map((t) => ' #' + t).join('');
			out.push(`- ${c.title}${tags}`);
			for (const d of c.desc.split('\n').filter((l) => l.trim())) {
				out.push('  ' + d.trim());
			}
		}
		out.push('');
	}
	return out.join('\n');
}
