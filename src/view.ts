import { Menu, TextFileView, WorkspaceLeaf, setIcon } from 'obsidian';
import { Board, Card, parse, serialize } from './board';
import { CardModal, renderTagPill, tagHue } from './card-modal';

// [hue, saturation%] for well-known column names; anything else gets a hue from its name.
const COLUMN_COLORS: Record<string, [number, number]> = {
	backlog: [220, 0],
	todo: [210, 75],
	'to do': [210, 75],
	'in progress': [35, 85],
	doing: [35, 85],
	done: [145, 55],
	archive: [220, 0],
};

export const VIEW_TYPE = 'kankan-board';

type Drag = { kind: 'card'; col: number; idx: number } | { kind: 'col'; idx: number };

export class BoardView extends TextFileView {
	private board: Board = { columns: [] };
	private drag: Drag | null = null;
	private search = '';
	private selectedTags = new Set<string>();
	private project: string | null = null; // null = all, '' = cards without a project

	constructor(
		leaf: WorkspaceLeaf,
		private onOpenAsMarkdown: (view: BoardView) => void,
	) {
		super(leaf);
	}

	getViewType() {
		return VIEW_TYPE;
	}

	getIcon() {
		return 'kanban-square';
	}

	async onOpen() {
		this.addAction('file-text', 'Open as markdown', () =>
			this.onOpenAsMarkdown(this),
		);
	}

	getViewData() {
		return serialize(this.board);
	}

	setViewData(data: string) {
		this.board = parse(data);
		this.render();
	}

	clear() {
		this.board = { columns: [] };
	}

	private commit() {
		this.requestSave();
		this.render();
	}

	private render() {
		const root = this.contentEl;
		root.empty();
		root.addClass('kankan');

		const bar = root.createDiv('kankan-toolbar');
		const projects = this.boardProjects();
		if (this.project && !projects.includes(this.project)) this.project = null;
		const picker = bar.createEl('select', { cls: 'dropdown kankan-project-select' });
		picker.createEl('option', { text: 'All projects', value: 'all' });
		picker.createEl('option', { text: 'No project', value: 'none' });
		for (const p of projects) picker.createEl('option', { text: p, value: 'p:' + p });
		picker.value = this.project === null ? 'all' : this.project === '' ? 'none' : 'p:' + this.project;
		picker.onchange = () => {
			const v = picker.value;
			this.project = v === 'all' ? null : v === 'none' ? '' : v.slice(2);
			this.render();
		};

		const search = bar.createEl('input', {
			type: 'search',
			placeholder: 'Search cards…',
			value: this.search,
		});
		search.addEventListener('input', () => {
			this.search = search.value.toLowerCase();
			this.applyFilter();
		});
		bar.createEl('button', { text: 'Add column' }).onclick = () => {
			this.board.columns.push({ name: 'New column', collapsed: false, cards: [] });
			this.commit();
		};
		bar.createDiv('kankan-spacer');
		const newCard = bar.createEl('button', { cls: 'mod-cta', text: 'New card' });
		newCard.onclick = () => {
			const cols = this.board.columns;
			const todo = cols.findIndex((c) => ['todo', 'to do'].includes(c.name.toLowerCase()));
			const target = todo !== -1 ? todo : cols.findIndex((c) => !c.collapsed);
			if (target !== -1) this.editCard(target, -1);
		};

		// Tags offered for filtering are scoped to the selected project.
		const tags = this.boardTags(this.inProject.bind(this));
		for (const t of this.selectedTags) if (!tags.includes(t)) this.selectedTags.delete(t);
		if (tags.length) {
			const row = root.createDiv('kankan-filter-tags');
			for (const t of tags) {
				const pill = renderTagPill(row, t);
				pill.toggleClass('is-selected', this.selectedTags.has(t));
				pill.onclick = () => this.toggleTag(t);
			}
			if (this.selectedTags.size) {
				row.createEl('a', { cls: 'kankan-clear', text: 'Clear' }).onclick = () => {
					this.selectedTags.clear();
					this.render();
				};
			}
		}

		const boardEl = root.createDiv('kankan-board');
		this.board.columns.forEach((_, i) => this.renderColumn(boardEl, i));
		this.applyFilter();
	}

	private allCards(): Card[] {
		return this.board.columns.flatMap((c) => c.cards);
	}

	private boardTags(where: (c: Card) => boolean = () => true): string[] {
		return [...new Set(this.allCards().filter(where).flatMap((k) => k.tags))].sort();
	}

	private boardProjects(): string[] {
		return [...new Set(this.allCards().map((k) => k.project).filter(Boolean))].sort();
	}

	private inProject(card: Card): boolean {
		return this.project === null || card.project === this.project;
	}

	private toggleTag(tag: string) {
		if (!this.selectedTags.delete(tag)) this.selectedTags.add(tag);
		this.render();
	}

	// Card shows if it's in the selected project, its title matches the search,
	// and it has any of the selected tags.
	private applyFilter() {
		this.contentEl.querySelectorAll<HTMLElement>('.kankan-card').forEach((el) => {
			const tags = (el.dataset.tags ?? '').split(' ');
			const show =
				(this.project === null || el.dataset.project === this.project) &&
				(el.dataset.title ?? '').includes(this.search) &&
				(!this.selectedTags.size || tags.some((t) => this.selectedTags.has(t)));
			el.toggleClass('kankan-hidden', !show);
		});
	}

	private renderColumn(parent: HTMLElement, ci: number) {
		const col = this.board.columns[ci]!;
		const colEl = parent.createDiv('kankan-column');
		colEl.toggleClass('is-collapsed', col.collapsed);
		const [hue, sat] = COLUMN_COLORS[col.name.toLowerCase()] ?? [tagHue(col.name), 65];
		colEl.style.setProperty('--kankan-col-hue', String(hue));
		colEl.style.setProperty('--kankan-col-sat', `${sat}%`);

		// Column reordering: drop a dragged column onto another one.
		colEl.addEventListener('dragover', (e) => {
			if (this.drag?.kind === 'col') e.preventDefault();
		});
		colEl.addEventListener('drop', (e) => {
			if (this.drag?.kind !== 'col') return;
			e.preventDefault();
			const [moved] = this.board.columns.splice(this.drag.idx, 1);
			this.board.columns.splice(ci, 0, moved!);
			this.drag = null;
			this.commit();
		});

		const header = colEl.createDiv('kankan-column-header');
		header.draggable = true;
		header.addEventListener('dragstart', (e) => {
			this.drag = { kind: 'col', idx: ci };
			e.dataTransfer?.setData('text/plain', col.name);
		});

		const collapseBtn = header.createDiv('clickable-icon');
		setIcon(collapseBtn, col.collapsed ? 'chevron-right' : 'chevron-down');
		collapseBtn.onclick = () => {
			col.collapsed = !col.collapsed;
			this.commit();
		};

		header.createSpan('kankan-dot');
		const title = header.createDiv({ cls: 'kankan-column-title', text: col.name });
		title.title = 'Double-click to rename';
		title.ondblclick = () => this.renameColumn(title, ci);
		header.createSpan({ cls: 'kankan-count', text: String(col.cards.length) });

		const menuBtn = header.createDiv('clickable-icon');
		setIcon(menuBtn, 'more-horizontal');
		menuBtn.onclick = (e) => this.columnMenu(e, ci, title);

		if (col.collapsed) return;

		const list = colEl.createDiv('kankan-cards');
		list.addEventListener('dragover', (e) => {
			if (this.drag?.kind === 'card') e.preventDefault();
		});
		list.addEventListener('drop', (e) => {
			if (this.drag?.kind !== 'card') return;
			e.preventDefault();
			e.stopPropagation();
			this.moveCard(this.drag.col, this.drag.idx, ci, this.dropIndex(list, e.clientY));
		});

		col.cards.forEach((card, idx) => this.renderCard(list, card, ci, idx));

		const add = colEl.createDiv({ cls: 'kankan-add', text: '+ Add card' });
		add.onclick = () => this.editCard(ci, -1);
	}

	private renderCard(list: HTMLElement, card: Card, ci: number, idx: number) {
		const el = list.createDiv('kankan-card');
		el.draggable = true;
		el.dataset.tags = card.tags.join(' ');
		el.dataset.title = card.title.toLowerCase();
		el.dataset.project = card.project;
		el.addEventListener('dragstart', (e) => {
			e.stopPropagation();
			this.drag = { kind: 'card', col: ci, idx };
			e.dataTransfer?.setData('text/plain', card.title);
			el.addClass('is-dragging');
		});
		el.addEventListener('dragend', () => el.removeClass('is-dragging'));
		el.onclick = () => this.editCard(ci, idx);

		if (card.project && this.project === null) {
			const label = el.createDiv({ cls: 'kankan-card-project' });
			setIcon(label.createSpan(), 'folder');
			label.createSpan({ text: card.project });
		}
		el.createDiv({ cls: 'kankan-card-title', text: card.title });
		if (card.desc) el.createDiv({ cls: 'kankan-card-desc', text: card.desc });
		if (card.tags.length) {
			const tags = el.createDiv('kankan-tags');
			for (const t of card.tags) {
				const chip = renderTagPill(tags, t);
				chip.onclick = (e) => {
					e.stopPropagation();
					this.toggleTag(t);
				};
			}
		}
	}

	// Index (in the full list) of the first visible card below the pointer.
	private dropIndex(list: HTMLElement, y: number): number {
		const cards = Array.from(list.querySelectorAll<HTMLElement>('.kankan-card'));
		const i = cards.findIndex((c) => {
			if (c.hasClass('kankan-hidden')) return false;
			const r = c.getBoundingClientRect();
			return y < r.top + r.height / 2;
		});
		return i === -1 ? cards.length : i;
	}

	private moveCard(fromCol: number, fromIdx: number, toCol: number, toIdx: number) {
		const [card] = this.board.columns[fromCol]!.cards.splice(fromIdx, 1);
		if (fromCol === toCol && fromIdx < toIdx) toIdx--;
		this.board.columns[toCol]!.cards.splice(toIdx, 0, card!);
		this.drag = null;
		this.commit();
	}

	private editCard(ci: number, idx: number) {
		const isNew = idx === -1;
		const card = isNew
			? { title: '', desc: '', tags: [], project: this.project ?? '' }
			: this.board.columns[ci]!.cards[idx]!;
		new CardModal(
			this.app,
			card,
			ci,
			this.board.columns.map((c) => c.name),
			this.boardTags(),
			this.boardProjects(),
			({ card: result, column }) => {
				if (!isNew) this.board.columns[ci]!.cards.splice(idx, 1);
				if (result) this.board.columns[column]!.cards.splice(
					isNew || column !== ci ? this.board.columns[column]!.cards.length : idx,
					0,
					result,
				);
				this.commit();
			},
		).open();
	}

	private renameColumn(titleEl: HTMLElement, ci: number) {
		const col = this.board.columns[ci]!;
		const input = createEl('input', { type: 'text', value: col.name });
		titleEl.replaceWith(input);
		input.focus();
		input.select();
		let finished = false; // commit() re-renders, which fires blur again
		const done = (save: boolean) => {
			if (finished) return;
			finished = true;
			if (save && input.value.trim()) col.name = input.value.trim();
			this.commit();
		};
		input.onkeydown = (e) => {
			if (e.key === 'Enter') done(true);
			if (e.key === 'Escape') done(false);
		};
		input.onblur = () => done(true);
	}

	private columnMenu(e: MouseEvent, ci: number, titleEl: HTMLElement) {
		const cols = this.board.columns;
		new Menu()
			.addItem((i) =>
				i.setTitle('Rename').setIcon('pencil').onClick(() => this.renameColumn(titleEl, ci)),
			)
			.addItem((i) =>
				i.setTitle('Add column after').setIcon('plus').onClick(() => {
					cols.splice(ci + 1, 0, { name: 'New column', collapsed: false, cards: [] });
					this.commit();
				}),
			)
			.addItem((i) =>
				i.setTitle('Delete column').setIcon('trash').setWarning(true).onClick(() => {
					const n = cols[ci]!.cards.length;
					if (n && !confirm(`Delete "${cols[ci]!.name}" and its ${n} card(s)?`)) return;
					cols.splice(ci, 1);
					this.commit();
				}),
			)
			.showAtMouseEvent(e);
	}
}
