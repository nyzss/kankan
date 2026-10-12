import { App, Modal } from 'obsidian';
import {
	ValueSuggest,
	cleanProject,
	renderProp,
	renderTagEditor,
} from './card-modal';

function footer(
	modal: Modal,
	onSave: () => void,
	saveText: string,
): HTMLElement {
	modal.scope.register(['Mod'], 'Enter', onSave);
	const el = modal.modalEl.createDiv('kankan-modal-footer');
	el.createDiv('kankan-spacer');
	el.createEl('button', { text: 'Cancel' }).onclick = () => modal.close();
	el.createEl('button', { cls: 'mod-cta', text: saveText }).onclick = onSave;
	return el;
}

export class ProjectTagsModal extends Modal {
	private tags: string[];

	constructor(
		app: App,
		private project: string,
		tags: string[],
		private allTags: string[],
		private onDone: (tags: string[]) => void,
	) {
		super(app);
		this.tags = [...tags];
	}

	onOpen() {
		this.modalEl.addClass('kankan-modal');
		this.setTitle(this.project);
		this.contentEl.createDiv({
			cls: 'kankan-muted',
			text: 'Every card in this project gets these tags.',
		});
		const props = this.contentEl.createDiv('kankan-props');
		renderTagEditor(
			this.app,
			renderProp(props, 'tag', 'Tags'),
			this.tags,
			() => this.allTags,
		);
		footer(
			this,
			() => {
				this.onDone(this.tags);
				this.close();
			},
			'Save',
		);
	}

	onClose() {
		this.contentEl.empty();
	}
}

export interface BulkResult {
	delete: boolean;
	column: number | null; // null = keep
	project: string | null; // null = keep, '' = remove project
	addTags: string[];
	removeTags: string[];
}

const NO_PROJECT = 'No project';

export class BulkModal extends Modal {
	private result: BulkResult = {
		delete: false,
		column: null,
		project: null,
		addTags: [],
		removeTags: [],
	};

	constructor(
		app: App,
		private count: number,
		private columns: string[],
		private allTags: string[],
		private selectedTags: string[],
		private allProjects: string[],
		private onDone: (r: BulkResult) => void,
	) {
		super(app);
	}

	onOpen() {
		this.modalEl.addClass('kankan-modal');
		this.setTitle(`Edit ${this.count} card${this.count === 1 ? '' : 's'}`);
		const props = this.contentEl.createDiv('kankan-props');
		const r = this.result;

		const select = renderProp(props, 'columns-3', 'Column').createEl(
			'select',
			{
				cls: 'kankan-prop-select',
			},
		);
		select.createEl('option', { text: 'Keep current', value: '' });
		this.columns.forEach((name, i) =>
			select.createEl('option', { text: name, value: String(i) }),
		);
		select.onchange = () =>
			(r.column = select.value ? Number(select.value) : null);

		const project = renderProp(props, 'folder', 'Project').createEl(
			'input',
			{
				cls: 'kankan-prop-input',
				type: 'text',
				placeholder: 'Keep current',
			},
		);
		const setProject = (v: string) => {
			project.value = v;
			r.project = v === NO_PROJECT ? '' : cleanProject(v) || null;
		};
		project.addEventListener('input', () => setProject(project.value));
		new ValueSuggest(
			this.app,
			project,
			() => [NO_PROJECT, ...this.allProjects],
			cleanProject,
			(el, v) => el.createSpan({ text: v }),
			setProject,
		);

		renderTagEditor(
			this.app,
			renderProp(props, 'plus', 'Add tags'),
			r.addTags,
			() => this.allTags,
		);
		renderTagEditor(
			this.app,
			renderProp(props, 'minus', 'Remove tags'),
			r.removeTags,
			() => this.selectedTags,
			'+ Remove tags',
		);

		const el = footer(
			this,
			() => {
				this.onDone(r);
				this.close();
			},
			'Apply',
		);
		const del = createEl('button', {
			cls: 'mod-warning',
			text: 'Delete all',
		});
		el.prepend(del);
		del.onclick = () => {
			if (!confirm(`Delete ${this.count} card(s)?`)) return;
			this.onDone({ ...r, delete: true });
			this.close();
		};
	}

	onClose() {
		this.contentEl.empty();
	}
}
