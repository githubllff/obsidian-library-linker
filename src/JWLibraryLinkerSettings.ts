import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import type JWLibraryLinkerPlugin from '@/main';
import type {
  BookLength,
  UpdatedLinkStructure,
  LinkFormat,
  AutoDetectAction,
  Language,
} from '@/types';
import { BIBLE_QUOTE_TEMPLATES } from '@/types';

export class JWLibraryLinkerSettings extends PluginSettingTab {
  plugin: JWLibraryLinkerPlugin;

  constructor(app: App, plugin: JWLibraryLinkerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'JW Library Linker settings' });

    new Setting(containerEl)
      .setName('Language')
      .setDesc('Language used for Bible books, references, and online Bible lookups.')
      .addText((text) =>
        text.setValue(this.plugin.settings.language).onChange(async (value) => {
          this.plugin.settings.language = value as Language;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Book name length')
      .setDesc('Choose whether generated Bible references use short, medium, or long book names.')
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            short: 'Short',
            medium: 'Medium',
            long: 'Long',
          })
          .setValue(this.plugin.settings.bookLength)
          .onChange(async (value) => {
            this.plugin.settings.bookLength = value as BookLength;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Open automatically')
      .setDesc('Open converted links immediately after inserting them.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.openAutomatically).onChange(async (value) => {
          this.plugin.settings.openAutomatically = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Insert quote automatically')
      .setDesc('Automatically insert a Bible quote after creating a Bible link where supported.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.insertQuoteAutomatically).onChange(async (value) => {
          this.plugin.settings.insertQuoteAutomatically = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Link format')
      .setDesc('Choose whether created links use the JW Library app URI or the JW.org finder/share link.')
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            jwlibrary: 'JW Library app link',
            'jworg-finder': 'JW.org share/finder link',
          })
          .setValue(this.plugin.settings.linkFormat)
          .onChange(async (value) => {
            this.plugin.settings.linkFormat = value as LinkFormat;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('No language parameter')
      .setDesc('Omit the language parameter from generated links when possible.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.noLanguageParameter).onChange(async (value) => {
          this.plugin.settings.noLanguageParameter = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Reconvert existing links')
      .setDesc('Allow commands to reconvert references that are already linked.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.reconvertExistingLinks).onChange(async (value) => {
          this.plugin.settings.reconvertExistingLinks = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName('Updated link structure')
      .setDesc('Choose whether updated links keep their current structure or use plugin settings.')
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            keepCurrentStructure: 'Keep current structure',
            usePluginSettings: 'Use plugin settings',
          })
          .setValue(this.plugin.settings.updatedLinkStructure)
          .onChange(async (value) => {
            this.plugin.settings.updatedLinkStructure = value as UpdatedLinkStructure;
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl('h3', { text: 'Quote insertion' });

    new Setting(containerEl)
      .setName('Quote template')
      .setDesc('Template used when inserting Bible quotes.')
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            [BIBLE_QUOTE_TEMPLATES.short]: 'Short',
            [BIBLE_QUOTE_TEMPLATES.foldable]: 'Long (foldable callout)',
            [BIBLE_QUOTE_TEMPLATES.expanded]: 'Long (expanded callout)',
            [BIBLE_QUOTE_TEMPLATES.plain]: 'Plain blockquote',
          })
          .setValue(this.plugin.settings.bibleQuote.template)
          .onChange(async (value) => {
            this.plugin.settings.bibleQuote.template = value;
            await this.plugin.saveSettings();
          }),
      );

    containerEl.createEl('h3', { text: 'Offline Bible' });

    new Setting(containerEl)
      .setName('Enable offline Bible')
      .setDesc('Use imported offline Bible data when available.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.offlineBible.enabled).onChange(async (value) => {
          this.plugin.settings.offlineBible.enabled = value;
          await this.plugin.saveSettings();
          this.display();
        }),
      );

    new Setting(containerEl)
      .setName('Prefer offline Bible')
      .setDesc('Prefer the offline Bible over online lookup when both are available.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.offlineBible.preferOffline)
          .setDisabled(!this.plugin.settings.offlineBible.enabled)
          .onChange(async (value) => {
            this.plugin.settings.offlineBible.preferOffline = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Allow online fallback')
      .setDesc('Use the online Bible when offline data is unavailable or incomplete.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.offlineBible.allowOnlineFallback)
          .setDisabled(!this.plugin.settings.offlineBible.enabled)
          .onChange(async (value) => {
            this.plugin.settings.offlineBible.allowOnlineFallback = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Import EPUB Bible')
      .setDesc('Import an EPUB Bible into the plugin’s offline library.')
      .addButton((button) =>
        button.setButtonText('Import EPUB').setCta().onClick(async () => {
          new Notice('EPUB import command wiring can stay as your existing implementation.');
        }),
      );

    containerEl.createEl('h3', { text: 'Reading view detection' });

    new Setting(containerEl)
      .setName('Auto-detect Bible references')
      .setDesc('Detect Bible references automatically in notes.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.autoDetectReferences).onChange(async (value) => {
          this.plugin.settings.autoDetectReferences = value;
          await this.plugin.saveSettings();
          this.display();
        }),
      );

    new Setting(containerEl)
      .setName('Detect in Reading view')
      .setDesc('Convert detected references into clickable links in Reading view.')
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoDetectInReadingView)
          .setDisabled(!this.plugin.settings.autoDetectReferences)
          .onChange(async (value) => {
            this.plugin.settings.autoDetectInReadingView = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Detected reference click action')
      .setDesc('Choose whether clicking an auto-detected reference opens it directly or shows a popup.')
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            popup: 'Show popup',
            open: 'Open directly',
          })
          .setValue(this.plugin.settings.autoDetectAction)
          .setDisabled(!this.plugin.settings.autoDetectReferences)
          .onChange(async (value) => {
            this.plugin.settings.autoDetectAction = value as AutoDetectAction;
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    new Setting(containerEl)
      .setName('Direct open uses JW.org share link')
      .setDesc(
        'When detected references are set to open directly, use the JW.org share/finder link instead of the jwlibrary:// app link.',
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoDetectOpenUsesWebShareLink)
          .setDisabled(
            !this.plugin.settings.autoDetectReferences ||
              this.plugin.settings.autoDetectAction !== 'open',
          )
          .onChange(async (value) => {
            this.plugin.settings.autoDetectOpenUsesWebShareLink = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName('Popup button uses JW.org share link')
      .setDesc(
        'When the popup is shown, the "Open in JW Library" button uses the JW.org share/finder link instead of the jwlibrary:// app link.',
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.popupOpenButtonUsesWebShareLink)
          .setDisabled(!this.plugin.settings.autoDetectReferences)
          .onChange(async (value) => {
            this.plugin.settings.popupOpenButtonUsesWebShareLink = value;
            await this.plugin.saveSettings();
          }),
      );
  }
}
