import { Menu, TextFileView, WorkspaceLeaf, setIcon } from 'obsidian';
import { Board, Card, effectiveTags, parse, serialize } from './board';
import { CardModal, renderTagPill, tagHue } from './card-modal';
import { BulkModal, ProjectTagsModal } from './modals';

// Known column names use these [hue, saturation%] values. Other names get a hue from the name.
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

type Drag =
	| { kind: 'card'; col: number; idx: number }
	| { kind: 'col'; idx: number };

export class BoardView extends TextFileView {
	private board: Board = { columns: [], projectTags: {} };
	private drag: Drag | null = null;
	private search = '';
	private selectedTags = new Set<string>();
	private projects = new Set<string>(); // empty = all, '' = cards without a project
	private selecting = false;
	private selection = new Set<Card>();

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
		this.selection.clear();
		this.render();
	}

	clear() {
		this.board = { columns: [], projectTags: {} };
	}

	private commit() {
		this.requestSave();
		this.render();
	}

	private render() {
		const root = this.contentEl;
		// Re-rendering rebuilds the DOM, so keep the scroll positions.
		const oldBoard = root.querySelector('.kankan-board');
		const scroll = {
			top: root.scrollTop,
			left: oldBoard?.scrollLeft ?? 0,
			cols: Array.from(
				root.querySelectorAll('.kankan-column'),
				(c) => c.querySelector('.kankan-cards')?.scrollTop ?? 0,
			),
		};
		root.empty();
		root.addClass('kankan');

		const bar = root.createDiv('kankan-toolbar');
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
			this.board.columns.push({
				name: 'New column',
				collapsed: false,
				cards: [],
			});
			this.commit();
		};
		bar.createDiv('kankan-spacer');
		if (this.selecting) {
			bar.createSpan({
				cls: 'kankan-muted',
				text: `${this.selection.size} selected`,
			});
			bar.createEl('button', { text: 'Done' }).onclick = () =>
				this.setSelecting(false);
			const edit = bar.createEl('button', {
				cls: 'mod-cta',
				text: 'Edit selected',
			});
			edit.disabled = !this.selection.size;
			edit.onclick = () => this.bulkEdit();
		} else {
			const select = bar.createEl('button', { text: 'Select' });
			select.title =
				'Select several cards to edit them together. Shift-click also selects.';
			select.onclick = () => this.setSelecting(true);
			const newCard = bar.createEl('button', {
				cls: 'mod-cta',
				text: 'New card',
			});
			newCard.onclick = () => {
				const cols = this.board.columns;
				const todo = cols.findIndex((c) =>
					['todo', 'to do'].includes(c.name.toLowerCase()),
				);
				const target =
					todo !== -1 ? todo : cols.findIndex((c) => !c.collapsed);
				if (target !== -1) this.editCard(target, -1);
			};
		}

		const projects = this.boardProjects();
		for (const p of this.projects)
			if (p && !projects.includes(p)) this.projects.delete(p);
		if (projects.length) {
			const row = root.createDiv('kankan-filter-tags');
			for (const p of [...projects, '']) {
				const pill = this.renderProjectPill(row, p);
				pill.toggleClass('is-selected', this.projects.has(p));
				if (p) {
					pill.title = 'Right-click to edit project tags';
					pill.oncontextmenu = (e) => {
						e.preventDefault();
						this.editProjectTags(p);
					};
				}
			}
			this.renderClear(row, this.projects);
		}

		// Show only tags from the selected projects in the filter.
		const tags = this.boardTags(this.inProject.bind(this));
		for (const t of this.selectedTags)
			if (!tags.includes(t)) this.selectedTags.delete(t);
		if (tags.length) {
			const row = root.createDiv('kankan-filter-tags');
			for (const t of tags) {
				const pill = renderTagPill(row, t);
				pill.toggleClass('is-selected', this.selectedTags.has(t));
				pill.onclick = () => this.toggle(this.selectedTags, t);
			}
			this.renderClear(row, this.selectedTags);
		}

		const boardEl = root.createDiv('kankan-board');
		this.board.columns.forEach((_, i) => this.renderColumn(boardEl, i));
		this.applyFilter();

		root.scrollTop = scroll.top;
		boardEl.scrollLeft = scroll.left;
		boardEl.querySelectorAll('.kankan-column').forEach((c, i) => {
			const list = c.querySelector('.kankan-cards');
			if (list) list.scrollTop = scroll.cols[i] ?? 0;
		});
	}

	private allCards(): Card[] {
		return this.board.columns.flatMap((c) => c.cards);
	}

	private boardTags(where: (c: Card) => boolean = () => true): string[] {
		const cards = this.allCards().filter(where);
		return [
			...new Set(cards.flatMap((k) => effectiveTags(this.board, k))),
		].sort();
	}

	// Projects with tags but no cards stay listed so their tags can still be edited.
	private boardProjects(): string[] {
		const names = [
			...this.allCards().map((k) => k.project),
			...Object.keys(this.board.projectTags),
		];
		return [...new Set(names.filter(Boolean))].sort();
	}

	private inProject(card: Card): boolean {
		return !this.projects.size || this.projects.has(card.project);
	}

	private toggle<T>(set: Set<T>, value: T) {
		if (!set.delete(value)) set.add(value);
		this.render();
	}

	private renderClear(row: HTMLElement, set: Set<string>) {
		if (!set.size) return;
		row.createEl('a', { cls: 'kankan-clear', text: 'Clear' }).onclick =
			() => {
				set.clear();
				this.render();
			};
	}

	private renderProjectPill(
		parent: HTMLElement,
		project: string,
	): HTMLElement {
		const pill = parent.createSpan({
			cls: 'kankan-pill kankan-project-pill',
		});
		pill.toggleClass('is-empty', !project);
		pill.style.setProperty('--kankan-hue', String(tagHue(project)));
		setIcon(pill.createSpan(), 'folder');
		pill.createSpan({ text: project || 'No project' });
		pill.onclick = (e) => {
			e.stopPropagation();
			this.toggle(this.projects, project);
		};
		return pill;
	}

	private editProjectTags(project: string) {
		new ProjectTagsModal(
			this.app,
			project,
			this.board.projectTags[project] ?? [],
			this.boardTags(),
			(tags) => {
				if (tags.length) this.board.projectTags[project] = tags;
				else delete this.board.projectTags[project];
				this.commit();
			},
		).open();
	}

	private setSelecting(on: boolean) {
		this.selecting = on;
		if (!on) this.selection.clear();
		this.render();
	}

	private bulkEdit() {
		const selected = [...this.selection];
		new BulkModal(
			this.app,
			selected.length,
			this.board.columns.map((c) => c.name),
			this.boardTags(),
			[...new Set(selected.flatMap((c) => c.tags))].sort(),
			this.boardProjects(),
			(r) => {
				const moved: Card[] = [];
				for (const col of this.board.columns) {
					col.cards = col.cards.filter((c) => {
						if (!this.selection.has(c)) return true;
						if (r.delete) return false;
						if (r.project !== null) c.project = r.project;
						c.tags = c.tags.filter(
							(t) => !r.removeTags.includes(t),
						);
						for (const t of r.addTags)
							if (!c.tags.includes(t)) c.tags.push(t);
						if (r.column === null) return true;
						moved.push(c);
						return false;
					});
				}
				if (r.column !== null)
					this.board.columns[r.column]!.cards.push(...moved);
				this.selecting = false;
				this.selection.clear();
				this.commit();
			},
		).open();
	}

	// Show a card if it belongs to a selected project, matches the search,
	// and has at least one selected tag.
	private applyFilter() {
		this.contentEl
			.querySelectorAll<HTMLElement>('.kankan-card')
			.forEach((el) => {
				const tags = (el.dataset.tags ?? '').split(' ');
				const show =
					(!this.projects.size ||
						this.projects.has(el.dataset.project ?? '')) &&
					(el.dataset.title ?? '').includes(this.search) &&
					(!this.selectedTags.size ||
						tags.some((t) => this.selectedTags.has(t)));
				el.toggleClass('kankan-hidden', !show);
			});
	}

	private renderColumn(parent: HTMLElement, ci: number) {
		const col = this.board.columns[ci]!;
		const colEl = parent.createDiv('kankan-column');
		colEl.toggleClass('is-collapsed', col.collapsed);
		const [hue, sat] = COLUMN_COLORS[col.name.toLowerCase()] ?? [
			tagHue(col.name),
			65,
		];
		colEl.style.setProperty('--kankan-col-hue', String(hue));
		colEl.style.setProperty('--kankan-col-sat', `${sat}%`);
		if (col.width)
			colEl.style.setProperty('--kankan-col-width', `${col.width}px`);

		// Drop a dragged column onto another column to change the order.
		// Drop a card on a column outside its card list (for example a
		// collapsed column) to add it at the end.
		colEl.addEventListener('dragover', (e) => {
			if (this.drag) e.preventDefault();
		});
		colEl.addEventListener('drop', (e) => {
			if (!this.drag) return;
			e.preventDefault();
			if (this.drag.kind === 'card') {
				this.moveCard(this.drag.col, this.drag.idx, ci, col.cards.length);
				return;
			}
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
		const title = header.createDiv({
			cls: 'kankan-column-title',
			text: col.name,
		});
		title.title = 'Double-click to rename';
		title.ondblclick = () => this.renameColumn(title, ci);
		header.createSpan({
			cls: 'kankan-count',
			text: String(col.cards.length),
		});

		const menuBtn = header.createDiv('clickable-icon');
		setIcon(menuBtn, 'more-horizontal');
		menuBtn.onclick = (e) => this.columnMenu(e, ci, title);

		if (col.collapsed) return;

		// Drag the right edge of a column to resize it.
		const handle = colEl.createDiv('kankan-resize');
		handle.onpointerdown = (e) => {
			e.preventDefault();
			handle.setPointerCapture(e.pointerId);
			const startX = e.clientX;
			const startW = colEl.offsetWidth;
			handle.onpointermove = (ev) => {
				col.width = Math.min(800, Math.max(200, Math.round(startW + ev.clientX - startX)));
				colEl.style.setProperty('--kankan-col-width', `${col.width}px`);
			};
			handle.onpointerup = () => {
				handle.onpointermove = handle.onpointerup = null;
				this.requestSave();
			};
		};

		const list = colEl.createDiv('kankan-cards');
		list.addEventListener('dragover', (e) => {
			if (this.drag?.kind === 'card') e.preventDefault();
		});
		list.addEventListener('drop', (e) => {
			if (this.drag?.kind !== 'card') return;
			e.preventDefault();
			e.stopPropagation();
			this.moveCard(
				this.drag.col,
				this.drag.idx,
				ci,
				this.dropIndex(list, e.clientY),
			);
		});

		col.cards.forEach((card, idx) => this.renderCard(list, card, ci, idx));

		const add = colEl.createDiv({ cls: 'kankan-add', text: '+ Add card' });
		add.onclick = () => this.editCard(ci, -1);
	}

	private renderCard(list: HTMLElement, card: Card, ci: number, idx: number) {
		const el = list.createDiv('kankan-card');
		el.draggable = true;
		const tags = effectiveTags(this.board, card);
		el.dataset.tags = tags.join(' ');
		el.dataset.title = card.title.toLowerCase();
		el.dataset.project = card.project;
		el.addEventListener('dragstart', (e) => {
			e.stopPropagation();
			this.drag = { kind: 'card', col: ci, idx };
			e.dataTransfer?.setData('text/plain', card.title);
			el.addClass('is-dragging');
		});
		el.addEventListener('dragend', () => el.removeClass('is-dragging'));
		el.toggleClass('is-selected', this.selection.has(card));
		el.onclick = (e) => {
			if (!this.selecting && !e.shiftKey) return this.editCard(ci, idx);
			this.selecting = true;
			this.toggle(this.selection, card);
		};

		if (card.project && this.projects.size !== 1) {
			const label = el.createDiv({ cls: 'kankan-card-project' });
			setIcon(label.createSpan(), 'folder');
			label.createSpan({ text: card.project });
			label.onclick = (e) => {
				e.stopPropagation();
				this.toggle(this.projects, card.project);
			};
		}
		el.createDiv({ cls: 'kankan-card-title', text: card.title });
		if (card.desc)
			el.createDiv({ cls: 'kankan-card-desc', text: card.desc });
		if (tags.length) {
			const row = el.createDiv('kankan-tags');
			for (const t of tags) {
				const chip = renderTagPill(row, t);
				// Tags that come only from the project are shown faded.
				chip.toggleClass('is-inherited', !card.tags.includes(t));
				chip.onclick = (e) => {
					e.stopPropagation();
					this.toggle(this.selectedTags, t);
				};
			}
		}
	}

	// Return the position of the first visible card below the pointer in the full list.
	private dropIndex(list: HTMLElement, y: number): number {
		const cards = Array.from(
			list.querySelectorAll<HTMLElement>('.kankan-card'),
		);
		const i = cards.findIndex((c) => {
			if (c.hasClass('kankan-hidden')) return false;
			const r = c.getBoundingClientRect();
			return y < r.top + r.height / 2;
		});
		return i === -1 ? cards.length : i;
	}

	private moveCard(
		fromCol: number,
		fromIdx: number,
		toCol: number,
		toIdx: number,
	) {
		const [card] = this.board.columns[fromCol]!.cards.splice(fromIdx, 1);
		if (fromCol === toCol && fromIdx < toIdx) toIdx--;
		this.board.columns[toCol]!.cards.splice(toIdx, 0, card!);
		this.drag = null;
		this.commit();
	}

	private editCard(ci: number, idx: number) {
		const isNew = idx === -1;
		const card = isNew
			? {
					title: '',
					desc: '',
					tags: [],
					project:
						this.projects.size === 1 ? [...this.projects][0]! : '',
				}
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
				if (result)
					this.board.columns[column]!.cards.splice(
						isNew || column !== ci
							? this.board.columns[column]!.cards.length
							: idx,
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
				i
					.setTitle('Rename')
					.setIcon('pencil')
					.onClick(() => this.renameColumn(titleEl, ci)),
			)
			.addItem((i) =>
				i
					.setTitle('Add column after')
					.setIcon('plus')
					.onClick(() => {
						cols.splice(ci + 1, 0, {
							name: 'New column',
							collapsed: false,
							cards: [],
						});
						this.commit();
					}),
			)
			.addItem((i) =>
				i
					.setTitle('Delete column')
					.setIcon('trash')
					.setWarning(true)
					.onClick(() => {
						const n = cols[ci]!.cards.length;
						if (
							n &&
							!confirm(
								`Delete "${cols[ci]!.name}" and its ${n} card(s)?`,
							)
						)
							return;
						cols.splice(ci, 1);
						this.commit();
					}),
			)
			.showAtMouseEvent(e);
	}
}
