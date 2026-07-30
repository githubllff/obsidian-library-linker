import { App, Modal } from 'obsidian';

export class DetectedReferenceModal extends Modal {
  constructor(
    app: App,
    private readonly titleText: string,
    private readonly bodyText: string,
    private readonly sourceLabel?: string,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl, titleEl } = this;
    contentEl.empty();
    titleEl.setText(this.titleText);

    if (this.sourceLabel) {
      contentEl.createEl('div', {
        text: this.sourceLabel,
        cls: 'jwll-detected-ref-source',
      });
    }

    contentEl.createEl('p', {
      text: this.bodyText,
      cls: 'jwll-detected-ref-body',
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
