import { App, Modal, Setting } from 'obsidian';

export class DetectedReferenceModal extends Modal {
  constructor(
    app: App,
    private readonly titleText: string,
    private readonly bodyText: string,
    private readonly sourceLabel?: string,
    private readonly onOpenExternal?: () => void,
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

    if (this.onOpenExternal) {
      new Setting(contentEl).addButton((button) =>
        button
          .setButtonText('Open in JW Library')
          .setCta()
          .onClick(() => {
            this.onOpenExternal?.();
            this.close();
          }),
      );
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
