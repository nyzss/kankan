import { App, Modal, Setting } from 'obsidian';
import { Card } from './board';

export interface CardResult {
	card: Card | null; // null = delete
	column: number;
}

export class CardModal extends Modal {
	private card: Card;

	constructor(
		app: App,
		card: Card,
		private column: number,
		private columns: string[],
		private onDone: (r: CardResult) => void,
	) {
		super(app);
		this.card = { ...card, tags: [...card.tags] };
	}

	onOpen() {
		const { contentEl } = this;
		this.setTitle(this.card.title ? 'Edit card' : 'New card');

		new Setting(contentEl).setName('Title').addText((t) => {
			t.setValue(this.card.title).onChange((v) => (this.card.title = v));
			t.inputEl.addClass('kankan-wide');
			window.setTimeout(() => t.inputEl.focus());
			t.inputEl.addEventListener('keydown', (e) => {
				if (e.key === 'Enter') this.save();
			});
		});

		new Setting(contentEl).setName('Description').addTextArea((t) => {
			t.setValue(this.card.desc).onChange((v) => (this.card.desc = v));
			t.inputEl.rows = 4;
			t.inputEl.addClass('kankan-wide');
		});

		new Setting(contentEl)
			.setName('Tags')
			.setDesc('Separated by spaces or commas.')
			.addText((t) => {
				t.setPlaceholder('Example: work personal')
					.setValue(this.card.tags.join(' '))
					.onChange(
						(v) =>
							(this.card.tags = v
								.split(/[\s,]+/)
								.map((s) => s.replace(/^#/, ''))
								.filter(Boolean)),
					);
				t.inputEl.addClass('kankan-wide');
			});

		new Setting(contentEl).setName('Column').addDropdown((d) => {
			this.columns.forEach((name, i) => {
				d.addOption(String(i), name);
			});
			d.setValue(String(this.column)).onChange(
				(v) => (this.column = Number(v)),
			);
		});

		new Setting(contentEl)
			.addButton((b) =>
				b
					.setButtonText('Delete')
					.setWarning()
					.onClick(() => {
						this.onDone({ card: null, column: this.column });
						this.close();
					}),
			)
			.addButton((b) =>
				b
					.setButtonText('Save')
					.setCta()
					.onClick(() => this.save()),
			);
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
