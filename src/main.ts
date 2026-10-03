import { MarkdownView, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { DEFAULT_BOARD, FRONTMATTER_KEY } from './board';
import { BoardView, VIEW_TYPE } from './view';

export default class KankanPlugin extends Plugin {
	// Files the user explicitly switched to markdown; don't bounce them back to the board.
	private asMarkdown = new Set<string>();

	async onload() {
		this.registerView(
			VIEW_TYPE,
			(leaf) =>
				new BoardView(leaf, (view) => {
					if (!view.file) return;
					this.asMarkdown.add(view.file.path);
					void view.leaf.setViewState({
						type: 'markdown',
						state: { file: view.file.path },
					});
				}),
		);

		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				const leaf = this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf;
				if (file && leaf && this.isBoard(file) && !this.asMarkdown.has(file.path)) {
					void this.openAsBoard(leaf, file);
				}
			}),
		);

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
		this.asMarkdown.delete(file.path);
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
