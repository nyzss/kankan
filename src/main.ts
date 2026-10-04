import { Plugin, TFile, ViewState, WorkspaceLeaf } from 'obsidian';
import { DEFAULT_BOARD, FRONTMATTER_KEY } from './board';
import { BoardView, VIEW_TYPE } from './view';

export default class KankanPlugin extends Plugin {
	// Leaves the user explicitly switched to markdown, with the file they did it for.
	private asMarkdown = new WeakMap<WorkspaceLeaf, string>();

	async onload() {
		this.registerView(
			VIEW_TYPE,
			(leaf) =>
				new BoardView(leaf, (view) => {
					if (!view.file) return;
					this.asMarkdown.set(view.leaf, view.file.path);
					void view.leaf.setViewState({
						type: 'markdown',
						state: { file: view.file.path },
					});
				}),
		);

		// Every way of opening a file (explorer, links, quick switcher, history)
		// goes through setViewState, so swap markdown -> board right there.
		// eslint-disable-next-line @typescript-eslint/unbound-method -- invoked via .call(this) below and restored on unload
		const original = WorkspaceLeaf.prototype.setViewState;
		const toBoard = (leaf: WorkspaceLeaf, state: ViewState): ViewState => {
			const path = state.state?.file;
			if (state.type !== 'markdown' || typeof path !== 'string') return state;
			if (this.asMarkdown.get(leaf) === path) return state;
			const file = this.app.vault.getFileByPath(path);
			return file && this.isBoard(file) ? { ...state, type: VIEW_TYPE } : state;
		};
		WorkspaceLeaf.prototype.setViewState = function (state, eState) {
			return original.call(this, toBoard(this, state), eState);
		};
		this.register(() => {
			WorkspaceLeaf.prototype.setViewState = original;
		});

		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file, _source, leaf) => {
				if (!(file instanceof TFile) || !leaf || !this.isBoard(file)) return;
				if (leaf.view.getViewType() !== 'markdown') return;
				menu.addItem((i) =>
					i.setTitle('Open as board').setIcon('kanban-square').onClick(() => {
						void this.openAsBoard(leaf, file);
					}),
				);
			}),
		);

		this.addRibbonIcon('kanban-square', 'New kanban board', () => this.createBoard());
		this.addCommand({
			id: 'create-board',
			name: 'Create new board',
			callback: () => this.createBoard(),
		});
	}

	private isBoard(file: TFile) {
		return (
			this.app.metadataCache.getFileCache(file)?.frontmatter?.[FRONTMATTER_KEY] ===
			'board'
		);
	}

	private async openAsBoard(leaf: WorkspaceLeaf, file: TFile) {
		this.asMarkdown.delete(leaf);
		await leaf.setViewState({ type: VIEW_TYPE, state: { file: file.path } });
	}

	private async createBoard() {
		const folder = this.app.fileManager.getNewFileParent('');
		const base = (folder.isRoot() ? '' : folder.path + '/') + 'Board';
		let path = base + '.md';
		for (let n = 1; this.app.vault.getAbstractFileByPath(path); n++) path = `${base} ${n}.md`;
		const file = await this.app.vault.create(path, DEFAULT_BOARD);
		await this.openAsBoard(this.app.workspace.getLeaf(true), file);
	}
}
