import { Menu, TextFileView, WorkspaceLeaf, setIcon } from 'obsidian';
import { Board, Card, parse, serialize } from './board';
import { CardModal, renderTagPill } from './card-modal';

export const VIEW_TYPE = 'kankan-board';

type Drag = { kind: 'card'; col: number; idx: number } | { kind: 'col'; idx: number };

export class BoardView extends TextFileView {
	private board: Board = { columns: [] };
	private drag: Drag | null = null;
	private filter = '';

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
		const search = bar.createEl('input', {
			type: 'search',
			placeholder: 'Filter by tag…',
			value: this.filter,
		});
		search.addEventListener('input', () => {
			this.filter = search.value.replace(/^#/, '').toLowerCase();
			this.applyFilter();
		});
		bar.createEl('button', { text: 'Add column' }).onclick = () => {
			this.board.columns.push({ name: 'New column', collapsed: false, cards: [] });
			this.commit();
		};

		const boardEl = root.createDiv('kankan-board');
		this.board.columns.forEach((_, i) => this.renderColumn(boardEl, i));
		this.applyFilter();
	}

	private applyFilter() {
		this.contentEl.querySelectorAll<HTMLElement>('.kankan-card').forEach((el) => {
			const tags = (el.dataset.tags ?? '').split(' ');
			const show = !this.filter || tags.some((t) => t.toLowerCase().startsWith(this.filter));
			el.toggleClass('kankan-hidden', !show);
		});
	}

	private renderColumn(parent: HTMLElement, ci: number) {
		const col = this.board.columns[ci]!;
		const colEl = parent.createDiv('kankan-column');
		colEl.toggleClass('is-collapsed', col.collapsed);

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
		el.addEventListener('dragstart', (e) => {
			e.stopPropagation();
			this.drag = { kind: 'card', col: ci, idx };
			e.dataTransfer?.setData('text/plain', card.title);
			el.addClass('is-dragging');
		});
		el.addEventListener('dragend', () => el.removeClass('is-dragging'));
		el.onclick = () => this.editCard(ci, idx);

		el.createDiv({ cls: 'kankan-card-title', text: card.title });
		if (card.desc) el.createDiv({ cls: 'kankan-card-desc', text: card.desc });
		if (card.tags.length) {
			const tags = el.createDiv('kankan-tags');
			for (const t of card.tags) {
				const chip = renderTagPill(tags, t);
				chip.onclick = (e) => {
					e.stopPropagation();
					this.filter = t.toLowerCase();
					this.render();
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
			? { title: '', desc: '', tags: [] }
			: this.board.columns[ci]!.cards[idx]!;
		new CardModal(
			this.app,
			card,
			ci,
			this.board.columns.map((c) => c.name),
			[...new Set(this.board.columns.flatMap((c) => c.cards.flatMap((k) => k.tags)))].sort(),
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
