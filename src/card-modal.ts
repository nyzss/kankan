import { AbstractInputSuggest, App, Modal, setIcon } from 'obsidian';
import { Card } from './board';

export interface CardResult {
	card: Card | null; // null = delete
	column: number;
}

// Give each tag a stable hue so it looks the same across the board.
export function tagHue(tag: string): number {
	let h = 0;
	for (const ch of tag.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) % 360;
	return h;
}

export function renderTagPill(parent: HTMLElement, tag: string): HTMLElement {
	const pill = parent.createSpan({ cls: 'kankan-pill', text: tag });
	pill.style.setProperty('--kankan-hue', String(tagHue(tag)));
	return pill;
}

export const cleanTag = (s: string) =>
	s
		.trim()
		.replace(/^#/, '')
		.replace(/[\s,#]+/g, '-');
// Remove brackets and # so they do not break the `[project:: X]` field or tag parsing.
export const cleanProject = (s: string) => s.replace(/[[\]#]/g, '').trim();

// Suggest existing values and offer the typed text as a "Create …" entry.
export class ValueSuggest extends AbstractInputSuggest<string> {
	constructor(
		app: App,
		input: HTMLInputElement,
		private available: () => string[],
		private clean: (s: string) => string,
		private renderValue: (el: HTMLElement, v: string) => void,
		private onPick: (v: string) => void,
	) {
		super(app, input);
	}

	getSuggestions(query: string): string[] {
		const q = this.clean(query).toLowerCase();
		const values = this.available();
		const matches = values.filter((v) => v.toLowerCase().includes(q));
		if (q && !values.some((v) => v.toLowerCase() === q))
			matches.push(this.clean(query));
		return matches;
	}

	renderSuggestion(v: string, el: HTMLElement) {
		if (!this.available().includes(v))
			el.createSpan({ text: 'Create ', cls: 'kankan-muted' });
		this.renderValue(el, v);
	}

	selectSuggestion(v: string) {
		this.onPick(v);
		this.close();
	}
}

export function renderProp(
	parent: HTMLElement,
	icon: string,
	label: string,
): HTMLElement {
	const row = parent.createDiv('kankan-prop');
	const name = row.createDiv('kankan-prop-name');
	setIcon(name.createSpan('kankan-prop-icon'), icon);
	name.createSpan({ text: label });
	return row.createDiv('kankan-prop-value');
}

// Edit `tags` in place as removable pills with an autocompleting input.
export function renderTagEditor(
	app: App,
	box: HTMLElement,
	tags: string[],
	allTags: () => string[],
	placeholder = '+ Add tags',
) {
	box.addClass('kankan-pill-box');
	const input = createEl('input', { type: 'text', placeholder });

	const add = (raw: string) => {
		const tag = cleanTag(raw);
		if (tag && !tags.includes(tag)) tags.push(tag);
		draw();
	};
	const draw = (focus = true) => {
		box.empty();
		for (const tag of tags) {
			const pill = renderTagPill(box, tag);
			const x = pill.createSpan('kankan-pill-x');
			setIcon(x, 'x');
			x.onclick = () => {
				tags.remove(tag);
				draw();
			};
		}
		input.placeholder = tags.length ? '' : placeholder;
		box.appendChild(input);
		if (focus) input.focus();
	};

	new ValueSuggest(
		app,
		input,
		() => allTags().filter((t) => !tags.includes(t)),
		cleanTag,
		renderTagPill,
		(t) => {
			add(t);
			input.value = '';
		},
	);
	input.addEventListener('keydown', (e) => {
		if ((e.key === ',' || e.key === ' ') && input.value.trim()) {
			e.preventDefault();
			add(input.value);
			input.value = '';
		} else if (e.key === 'Backspace' && !input.value && tags.length) {
			tags.pop();
			draw();
		}
	});
	box.onclick = (e) => {
		if (e.target === box) input.focus();
	};

	draw(false);
}

export class CardModal extends Modal {
	private card: Card;
	private isNew: boolean;
	private saved = false;

	constructor(
		app: App,
		card: Card,
		private column: number,
		private columns: string[],
		private allTags: string[],
		private allProjects: string[],
		private onDone: (r: CardResult) => void,
	) {
		super(app);
		this.isNew = !card.title;
		this.card = { ...card, tags: [...card.tags] };
	}

	onOpen() {
		const { contentEl } = this;
		this.modalEl.addClass('kankan-modal');
		this.scope.register(['Shift'], 'Enter', () => this.save());
		this.scope.register(['Mod'], 'Enter', () => this.save());

		const title = contentEl.createEl('input', {
			cls: 'kankan-modal-title',
			type: 'text',
			placeholder: 'Untitled',
			value: this.card.title,
		});
		title.addEventListener('input', () => (this.card.title = title.value));
		title.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.shiftKey) this.save();
		});
		window.setTimeout(() => title.focus());

		const props = contentEl.createDiv('kankan-props');

		const select = renderProp(props, 'columns-3', 'Column').createEl(
			'select',
			{
				cls: 'kankan-prop-select',
			},
		);
		this.columns.forEach((name, i) => {
			select.createEl('option', { text: name, value: String(i) });
		});
		select.value = String(this.column);
		select.addEventListener(
			'change',
			() => (this.column = Number(select.value)),
		);

		const project = renderProp(props, 'folder', 'Project').createEl(
			'input',
			{
				cls: 'kankan-prop-input',
				type: 'text',
				placeholder: '+ Add project',
				value: this.card.project,
			},
		);
		project.addEventListener(
			'input',
			() => (this.card.project = cleanProject(project.value)),
		);
		new ValueSuggest(
			this.app,
			project,
			() => this.allProjects,
			cleanProject,
			(el, v) => el.createSpan({ text: v }),
			(v) => {
				project.value = this.card.project = v;
			},
		);

		renderTagEditor(
			this.app,
			renderProp(props, 'tag', 'Tags'),
			this.card.tags,
			() => this.allTags,
		);

		contentEl.createDiv({
			cls: 'kankan-section-label',
			text: 'Description',
		});
		const desc = contentEl.createEl('textarea', {
			cls: 'kankan-modal-desc',
			placeholder: 'Add a description…',
		});
		desc.value = this.card.desc;
		desc.addEventListener('input', () => (this.card.desc = desc.value));

		const footer = this.modalEl.createDiv('kankan-modal-footer');
		if (!this.isNew) {
			const del = footer.createEl('button', {
				cls: 'mod-warning',
				text: 'Delete',
			});
			del.onclick = () => {
				this.onDone({ card: null, column: this.column });
				this.close();
			};
		}
		footer.createDiv('kankan-spacer');
		footer.createEl('button', { text: 'Cancel' }).onclick = () =>
			this.close();
		footer.createEl('button', {
			cls: 'mod-cta',
			text: `${this.isNew ? 'Create' : 'Save'} (⇧↵)`,
		}).onclick = () => this.save();
	}

	private save() {
		// Mod+Enter in the title fires both the scope and the input handler.
		if (this.saved || !this.card.title.trim()) return;
		this.saved = true;
		this.card.title = this.card.title.trim();
		this.onDone({ card: this.card, column: this.column });
		this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}
