import { AbstractInputSuggest, App, Modal, setIcon } from 'obsidian';
import { Card } from './board';

export interface CardResult {
	card: Card | null; // null = delete
	column: number;
}

// Stable per-tag hue so a tag looks the same everywhere.
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

const cleanTag = (s: string) => s.trim().replace(/^#/, '').replace(/[\s,#]+/g, '-');

class TagSuggest extends AbstractInputSuggest<string> {
	constructor(
		app: App,
		private input: HTMLInputElement,
		private available: () => string[],
		private onPick: (tag: string) => void,
	) {
		super(app, input);
	}

	getSuggestions(query: string): string[] {
		const q = cleanTag(query).toLowerCase();
		const tags = this.available();
		const matches = tags.filter((t) => t.toLowerCase().includes(q));
		if (q && !tags.some((t) => t.toLowerCase() === q)) matches.push(cleanTag(query));
		return matches;
	}

	renderSuggestion(tag: string, el: HTMLElement) {
		if (!this.available().includes(tag)) el.createSpan({ text: 'Create ', cls: 'kankan-muted' });
		renderTagPill(el, tag);
	}

	selectSuggestion(tag: string) {
		this.onPick(tag);
		this.input.value = '';
		this.close();
	}
}

export class CardModal extends Modal {
	private card: Card;
	private isNew: boolean;

	constructor(
		app: App,
		card: Card,
		private column: number,
		private columns: string[],
		private allTags: string[],
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

		const select = this.prop(props, 'columns-3', 'Column').createEl('select', {
			cls: 'kankan-prop-select',
		});
		this.columns.forEach((name, i) => {
			select.createEl('option', { text: name, value: String(i) });
		});
		select.value = String(this.column);
		select.addEventListener('change', () => (this.column = Number(select.value)));

		this.renderTags(this.prop(props, 'tag', 'Tags'));

		contentEl.createDiv({ cls: 'kankan-section-label', text: 'Description' });
		const desc = contentEl.createEl('textarea', {
			cls: 'kankan-modal-desc',
			placeholder: 'Add a description…',
		});
		desc.value = this.card.desc;
		desc.addEventListener('input', () => (this.card.desc = desc.value));

		const footer = this.modalEl.createDiv('kankan-modal-footer');
		if (!this.isNew) {
			const del = footer.createEl('button', { cls: 'mod-warning', text: 'Delete' });
			del.onclick = () => {
				this.onDone({ card: null, column: this.column });
				this.close();
			};
		}
		footer.createDiv('kankan-spacer');
		footer.createEl('button', { text: 'Cancel' }).onclick = () => this.close();
		footer.createEl('button', {
			cls: 'mod-cta',
			text: `${this.isNew ? 'Create' : 'Save'} (⇧↵)`,
		}).onclick = () => this.save();
	}

	private prop(parent: HTMLElement, icon: string, label: string): HTMLElement {
		const row = parent.createDiv('kankan-prop');
		const name = row.createDiv('kankan-prop-name');
		setIcon(name.createSpan('kankan-prop-icon'), icon);
		name.createSpan({ text: label });
		return row.createDiv('kankan-prop-value');
	}

	private renderTags(box: HTMLElement) {
		box.addClass('kankan-pill-box');
		const input = createEl('input', { type: 'text', placeholder: 'Add tags' });

		const add = (raw: string) => {
			const tag = cleanTag(raw);
			if (tag && !this.card.tags.includes(tag)) this.card.tags.push(tag);
			draw();
		};
		const draw = (focus = true) => {
			box.empty();
			for (const tag of this.card.tags) {
				const pill = renderTagPill(box, tag);
				const x = pill.createSpan('kankan-pill-x');
				setIcon(x, 'x');
				x.onclick = () => {
					this.card.tags.remove(tag);
					draw();
				};
			}
			input.placeholder = this.card.tags.length ? '' : 'Add tags';
			box.appendChild(input);
			if (focus) input.focus();
		};

		new TagSuggest(
			this.app,
			input,
			() => this.allTags.filter((t) => !this.card.tags.includes(t)),
			add,
		);
		// Enter goes through the suggester (it always offers the typed text);
		// comma/space commit directly, backspace on empty removes the last pill.
		input.addEventListener('keydown', (e) => {
			if ((e.key === ',' || e.key === ' ') && input.value.trim()) {
				e.preventDefault();
				add(input.value);
				input.value = '';
			} else if (e.key === 'Backspace' && !input.value && this.card.tags.length) {
				this.card.tags.pop();
				draw();
			}
		});
		box.onclick = (e) => {
			if (e.target === box) input.focus();
		};

		draw(false);
	}

	private save() {
		if (!this.card.title.trim()) return;
		this.card.title = this.card.title.trim();
		this.onDone({ card: this.card, column: this.column });
		this.close();
	}

	onClose() {
		this.contentEl.empty();
	}
}
