import { Editor, Notice, Plugin, Menu, MarkdownView, TFile, debounce } from 'obsidian';
import { ConversionType, convertLinks } from '@/utils/convertLinks';
import type {
  LinkReplacerSettings,
  LinkStyles,
  BibleQuoteFormat,
  BibleReference,
  LinkFormat,
} from '@/types';
import { BIBLE_QUOTE_TEMPLATES } from '@/types';
import { TranslationService } from '@/services/TranslationService';
import { VaultOfflineBibleRepository } from '@/services/VaultOfflineBibleRepository';
import { OfflineBibleCitationProvider } from '@/services/OfflineBibleCitationProvider';
import { OnlineBibleCitationProvider } from '@/services/OnlineBibleCitationProvider';
import { ConfiguredBibleCitationProvider } from '@/services/ConfiguredBibleCitationProvider';
import { BibleEpubImportService } from '@/services/BibleEpubImportService';
import { getOfflineBibleVaultPath } from '@/services/PluginDataPathService';
import { BibleTextFetcher } from '@/services/BibleTextFetcher';
import { loadBibleBooks } from '@/stores/bibleBooks';
import { JWLibraryLinkerSettings } from '@/JWLibraryLinkerSettings';
import { BibleReferenceSuggester } from '@/BibleReferenceSuggester';
import { linkUnlinkedBibleReferences } from '@/utils/linkUnlinkedBibleReferences';
import { ConvertSuggester } from '@/ConvertSuggester';
import { insertAllBibleQuotes, insertBibleQuoteAtCursor } from '@/utils/insertBibleQuotes';
import { logger } from '@/utils/logger';
import { getBookLanguage } from '@/utils/signLanguage';
import { ContentSelection } from '@/utils/findJWLibraryLinks';
import { parseBibleReference, extractBibleReferenceFromMatch } from '@/utils/parseBibleReference';
import { BIBLE_REFERENCE_REGEX } from '@/utils/bibleReferenceRegex';
import { buildBookNameRegex } from '@/utils/buildBookNameRegex';
import { formatJWLibraryLink } from '@/utils/formatJWLibraryLink';
import { DetectedReferenceModal } from '@/DetectedReferenceModal';

export const DEFAULT_STYLES: LinkStyles = {
  bookLength: 'medium',
  prefixOutsideLink: '',
  prefixInsideLink: '',
  suffixInsideLink: '',
  suffixOutsideLink: ' ',
  fontStyle: 'normal',
};

export const DEFAULT_SETTINGS: LinkReplacerSettings = {
  language: 'E',
  openAutomatically: false,
  insertQuoteAutomatically: false,
  updatedLinkStructure: 'keepCurrentStructure',
  noLanguageParameter: false,
  reconvertExistingLinks: false,
  linkFormat: 'jwlibrary',
  bibleQuote: {
    template: BIBLE_QUOTE_TEMPLATES.short,
  },
  offlineBible: {
    enabled: true,
    preferOffline: true,
    allowOnlineFallback: true,
  },
  autoDetectReferences: true,
  autoDetectInReadingView: true,
  autoDetectAction: 'popup',
  autoDetectOpenUsesWebShareLink: true,
  popupOpenButtonUsesWebShareLink: false,
  ...DEFAULT_STYLES,
};

function migrateFormatToTemplate(format: BibleQuoteFormat): string {
  switch (format) {
    case 'short':
      return BIBLE_QUOTE_TEMPLATES.short;
    case 'long-foldable':
      return BIBLE_QUOTE_TEMPLATES.foldable;
    case 'long-expanded':
      return BIBLE_QUOTE_TEMPLATES.expanded;
    default:
      return BIBLE_QUOTE_TEMPLATES.short;
  }
}

const ANY_BIBLE_LINK_REGEX =
  /(?:jwlibrary:\/\/\/finder\?bible=\d{8}(?:-\d{8})?(?:&[^)\s]*)?|https:\/\/www\.jw\.org\/finder\?[^)"\s]*bible=\d{8}(?:-\d{8})?(?:&[^)"\s]*)?)/;

type StoredSettings = Partial<LinkReplacerSettings> & {
  bibleQuote?: {
    template?: string | null;
    format?: BibleQuoteFormat | null;
  } | null;
  offlineBible?: Partial<LinkReplacerSettings['offlineBible']> | null;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeBibleQuote(
  value: StoredSettings['bibleQuote'],
): LinkReplacerSettings['bibleQuote'] {
  if (!isObject(value)) {
    return { ...DEFAULT_SETTINGS.bibleQuote };
  }

  const template = value.template;
  if (typeof template === 'string' && template.trim().length > 0) {
    return { template };
  }

  const legacyFormat = value.format;
  if (typeof legacyFormat === 'string') {
    return { template: migrateFormatToTemplate(legacyFormat) };
  }

  return { ...DEFAULT_SETTINGS.bibleQuote };
}

function normalizeOfflineBible(
  value: StoredSettings['offlineBible'],
): LinkReplacerSettings['offlineBible'] {
  if (!isObject(value)) {
    return { ...DEFAULT_SETTINGS.offlineBible };
  }

  return {
    enabled:
      typeof value.enabled === 'boolean'
        ? value.enabled
        : DEFAULT_SETTINGS.offlineBible.enabled,
    preferOffline:
      typeof value.preferOffline === 'boolean'
        ? value.preferOffline
        : DEFAULT_SETTINGS.offlineBible.preferOffline,
    allowOnlineFallback:
      typeof value.allowOnlineFallback === 'boolean'
        ? value.allowOnlineFallback
        : DEFAULT_SETTINGS.offlineBible.allowOnlineFallback,
  };
}

export default class JWLibraryLinkerPlugin extends Plugin {
  settings: LinkReplacerSettings = { ...DEFAULT_SETTINGS };

  private translationService!: TranslationService;
  private bibleSuggester!: BibleReferenceSuggester;
  private offlineBibleRepository!: VaultOfflineBibleRepository;
  private bibleCitationProvider!: ConfiguredBibleCitationProvider;
  private epubImportService!: BibleEpubImportService;

  private t!: (key: string, variables?: Record<string, string>) => string;
  private cachedBookRegex: RegExp | null = null;
  private cachedBookRegexLanguage: string | null = null;
  private processingElements = new WeakSet<HTMLElement>();

  private rerenderActiveReadingView = debounce(() => {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return;

    const modeGetter = (view as unknown as { getMode?: () => string }).getMode;
    const mode = typeof modeGetter === 'function' ? modeGetter.call(view) : null;

    if (mode !== 'preview') return;

    try {
      (
        view as unknown as {
          previewMode?: { rerender?: (full?: boolean) => void };
        }
      ).previewMode?.rerender?.(true);
    } catch (error) {
      logger.error('Failed to rerender reading view:', error);
    }
  }, 250, true);

  async onload() {
    try {
      console.log('JWLL: onload start');

      this.translationService = new TranslationService();
      console.log('JWLL: translation service created');

      await this.translationService.initialize();
      console.log('JWLL: translation initialized');

      this.t = this.translationService.t.bind(this.translationService);
      console.log('JWLL: translator bound');

      await this.loadSettings();
      console.log('JWLL: settings loaded', this.settings);

      BibleTextFetcher.initialize(this.app);
      console.log('JWLL: fetcher initialized');

      const offlineBibleVaultPath = getOfflineBibleVaultPath(this.app, this.manifest.id);
      console.log('JWLL: vault path', offlineBibleVaultPath);

      this.offlineBibleRepository = new VaultOfflineBibleRepository(
        this.app.vault.adapter,
        offlineBibleVaultPath,
      );
      console.log('JWLL: repository created');

      this.epubImportService = new BibleEpubImportService(this.offlineBibleRepository);
      console.log('JWLL: epub import service created');

      this.bibleCitationProvider = new ConfiguredBibleCitationProvider(
        () => this.settings,
        new OfflineBibleCitationProvider(this.offlineBibleRepository, this.t),
        new OnlineBibleCitationProvider(),
        this.t,
      );
      console.log('JWLL: citation provider created');

      loadBibleBooks(getBookLanguage(this.settings.language));
      console.log('JWLL: bible books loaded');

      this.addSettingTab(new JWLibraryLinkerSettings(this.app, this));
      console.log('JWLL: settings tab added');

      this.registerMarkdownPostProcessor((element) => {
        if (!this.settings.autoDetectReferences || !this.settings.autoDetectInReadingView) {
          return;
        }
        this.processRenderedReferences(element);
      });
      console.log('JWLL: markdown post processor registered');

      this.registerEvent(
        this.app.vault.on('modify', (file) => {
          const activeFile = this.app.workspace.getActiveFile();

          if (!(file instanceof TFile) || !activeFile) return;
          if (file.path !== activeFile.path) return;
          if (!this.settings.autoDetectReferences || !this.settings.autoDetectInReadingView) {
            return;
          }

          this.rerenderActiveReadingView();
        }),
      );
      console.log('JWLL: modify event registered');

      this.addCommand({
        id: 'link-unlinked-bible-references',
        name: this.t('commands.linkUnlinkedBibleReferences'),
        icon: 'link-2',
        editorCallback: (editor: Editor) => {
          const selection = {
            text: editor.getSelection(),
            from: editor.getCursor('from'),
            to: editor.getCursor('to'),
          };

          if (!selection.text) {
            new Notice(this.t('notices.pleaseSelectText'));
            return;
          }

          linkUnlinkedBibleReferences(selection.text, this.settings, ({ changes, error }) => {
            if (changes.length > 0) {
              editor.transaction({
                changes: changes.map((change) => ({
                  ...change,
                  from: {
                    line: change.from.line + selection.from.line,
                    ch: change.from.ch + selection.from.ch,
                  },
                  to: {
                    line: change.to.line + selection.from.line,
                    ch: change.to.ch + selection.from.ch,
                  },
                })),
              });
              new Notice(
                this.t('notices.convertedBibleReferences', { count: String(changes.length) }),
              );
            } else {
              new Notice(this.t(error || 'notices.noBibleReferencesFound'));
            }
          });
        },
      });

      this.addCommand({
        id: 'convert-jw-links',
        name: this.t('commands.convertToJWLibraryLinks'),
        icon: 'link-2',
        editorCallback: (editor: Editor) => {
          const selection = editor.getSelection();
          if (!selection) {
            new Notice(this.t('notices.pleaseSelectText'));
            return;
          }

          new ConvertSuggester(this.app, this, (selectedType: ConversionType) => {
            const convertedLinks = convertLinks(selection, selectedType, this.settings);
            if (selection !== convertedLinks) {
              editor.replaceSelection(convertedLinks);
            }
          }).open();
        },
      });

      this.addCommand({
        id: 'insert-bible-quotes',
        name: this.t('commands.insertBibleQuotes'),
        icon: 'text-quote',
        editorCallback: async (editor: Editor) => {
          const selection = editor.getSelection();
          let contentSelection: ContentSelection | undefined;

          if (selection) {
            const selectionRange = editor.listSelections()[0];
            const startLine = Math.min(selectionRange.anchor.line, selectionRange.head.line);
            const endLine = Math.max(selectionRange.anchor.line, selectionRange.head.line);
            contentSelection = { text: selection, startLine, endLine };
          }

          try {
            const result = await insertAllBibleQuotes(
              editor,
              this.settings,
              this.bibleCitationProvider,
              contentSelection,
            );
            if (result.inserted > 0) {
              const notice = contentSelection
                ? this.t('notices.bibleQuotesInsertedSelection')
                : this.t('notices.bibleQuotesInserted');
              new Notice(notice);
            } else if (result.fetchFailed > 0) {
              new Notice(this.t('notices.bibleQuoteFetchFailed'));
            } else {
              new Notice(this.t('notices.noBibleLinksFound'));
            }
          } catch (error: unknown) {
            logger.error(
              'Error inserting Bible quotes:',
              error instanceof Error ? error.message : String(error),
            );
            new Notice(this.t('notices.errorInsertingQuotes'));
          }
        },
      });

      this.addCommand({
        id: 'insert-bible-quote-at-cursor',
        name: this.t('commands.insertBibleQuoteAtCursor'),
        icon: 'text-quote',
        editorCallback: async (editor: Editor) => {
          try {
            const result = await insertBibleQuoteAtCursor(
              editor,
              this.settings,
              this.bibleCitationProvider,
            );
            if (result.inserted) {
              new Notice(this.t('notices.bibleQuoteInsertedAtCursor'));
            } else if (result.alreadyExists) {
              new Notice(this.t('notices.bibleQuoteAlreadyExists'));
            } else if (result.fetchFailed) {
              new Notice(this.t('notices.bibleQuoteFetchFailed'));
            } else {
              new Notice(this.t('notices.noBibleLinkAtCursor'));
            }
          } catch (error: unknown) {
            logger.error(
              'Error inserting Bible quote at cursor:',
              error instanceof Error ? error.message : String(error),
            );
            new Notice(this.t('notices.errorInsertingQuotes'));
          }
        },
      });
      console.log('JWLL: commands added');

      this.bibleSuggester = new BibleReferenceSuggester(this);
      this.registerEditorSuggest(this.bibleSuggester);
      console.log('JWLL: bible suggester registered');

      this.registerEvent(
        this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor) => {
          const cursor = editor.getCursor();
          const line = editor.getLine(cursor.line);

          if (ANY_BIBLE_LINK_REGEX.test(line)) {
            menu.addItem((item) => {
              item
                .setTitle(this.t('contextMenu.insertBibleQuote'))
                .setIcon('quote-glyph')
                .onClick(async () => {
                  try {
                    const result = await insertBibleQuoteAtCursor(
                      editor,
                      this.settings,
                      this.bibleCitationProvider,
                    );
                    if (result.inserted) {
                      new Notice(this.t('notices.bibleQuoteInsertedAtCursor'));
                    } else if (result.alreadyExists) {
                      new Notice(this.t('notices.bibleQuoteAlreadyExists'));
                    } else if (result.fetchFailed) {
                      new Notice(this.t('notices.bibleQuoteFetchFailed'));
                    } else {
                      new Notice(this.t('notices.noBibleLinkAtCursor'));
                    }
                  } catch (error: unknown) {
                    logger.error(
                      'Error inserting Bible quote from context menu:',
                      error instanceof Error ? error.message : String(error),
                    );
                    new Notice(this.t('notices.errorInsertingQuotes'));
                  }
                });
            });
          }
        }),
      );
      console.log('JWLL: editor menu registered');

      logger.log('Plugin loaded');
      console.log('JWLL: onload complete');
    } catch (error) {
      console.error('JWLL: plugin failed during onload', error);
      new Notice(`JW Library Linker failed to load: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  onunload() {
    logger.log('Plugin unloaded');
  }

  getTranslationService(): TranslationService {
    return this.translationService;
  }

  async insertBibleQuoteForReference(
    _editor: Editor,
    reference: BibleReference,
  ): Promise<string | null> {
    const result = await this.bibleCitationProvider.getCitation(reference, this.settings.language);

    if (!result.success) {
      return null;
    }

    return result.text;
  }

  private getBookRegex(): RegExp {
    const lang = this.settings.language;
    if (this.cachedBookRegex && this.cachedBookRegexLanguage === lang) {
      return this.cachedBookRegex;
    }
    this.cachedBookRegex = buildBookNameRegex(lang);
    this.cachedBookRegexLanguage = lang;
    return this.cachedBookRegex;
  }

  private isIgnoredTextNode(node: Text): boolean {
    const parent = node.parentElement;
    if (!parent) return true;

    if (
      parent.closest(
        'a, code, pre, .cm-inline-code, .math, .footnote-ref, .frontmatter, .callout-title',
      )
    ) {
      return true;
    }

    const text = node.nodeValue?.trim() ?? '';
    return text.length === 0;
  }

  private openDetectedReferenceExternally(reference: BibleReference): void {
    const linkLanguage = this.settings.noLanguageParameter ? undefined : this.settings.language;

    const directLinkFormat: LinkFormat =
      this.settings.autoDetectAction === 'open'
        ? this.settings.autoDetectOpenUsesWebShareLink
          ? 'jworg-finder'
          : 'jwlibrary'
        : this.settings.popupOpenButtonUsesWebShareLink
          ? 'jworg-finder'
          : 'jwlibrary';

    const url = formatJWLibraryLink(reference, linkLanguage, directLinkFormat);

    if (Array.isArray(url)) {
      window.open(url[0], '_blank');
    } else {
      window.open(url, '_blank');
    }
  }

  private detectWholeBookReference(
    text: string,
  ): { reference: BibleReference; matchedText: string } | null {
    const trimmed = text.trim();

    const forcedMatch = trimmed.match(/^\{\{([^}]+)\}\}$/u);
    if (!forcedMatch) return null;

    const candidate = forcedMatch[1].trim();

    try {
      const parsed = parseBibleReference(candidate, this.settings.language);
      if (!parsed) return null;

      const isWholeBook = parsed.chapter === 1 && !parsed.verseRanges?.length;
      if (!isWholeBook) return null;

      return {
        reference: {
          book: parsed.book,
          chapter: 1,
        },
        matchedText: candidate,
      };
    } catch {
      return null;
    }
  }

  private detectReferenceFromText(
    text: string,
  ): { reference: BibleReference; matchedText: string } | null {
    const matches = this.detectReferencesInText(text);
    if (matches.length > 0) {
      return {
        reference: matches[0].reference,
        matchedText: matches[0].matchedText,
      };
    }

    return this.detectWholeBookReference(text);
  }

  private detectReferencesInText(text: string): Array<{
    start: number;
    end: number;
    matchedText: string;
    reference: BibleReference;
  }> {
    const results: Array<{
      start: number;
      end: number;
      matchedText: string;
      reference: BibleReference;
    }> = [];

    const seen = new Set<string>();

    const forcedWholeBookRegex = /\{\{([^}]+)\}\}/gu;
    let forcedMatch: RegExpExecArray | null;

    while ((forcedMatch = forcedWholeBookRegex.exec(text)) !== null) {
      const raw = forcedMatch[0];
      const inner = forcedMatch[1].trim();

      try {
        const parsed = parseBibleReference(inner, this.settings.language);
        if (!parsed) continue;

        const isWholeBook = parsed.chapter === 1 && !parsed.verseRanges?.length;
        if (!isWholeBook) continue;

        const start = forcedMatch.index;
        const end = start + raw.length;
        const key = `${start}:${end}:${raw}`;

        if (seen.has(key)) continue;
        seen.add(key);

        results.push({
          start,
          end,
          matchedText: raw,
          reference: {
            book: parsed.book,
            chapter: 1,
          },
        });
      } catch {
        continue;
      }
    }

    const patterns = [
      /\{\{[^}]+\}\}/gu,
      new RegExp(this.getBookRegex().source, 'giu'),
      new RegExp(BIBLE_REFERENCE_REGEX.source, 'giu'),
    ];

    for (const pattern of patterns) {
      let match: RegExpExecArray | null;

      while ((match = pattern.exec(text)) !== null) {
        const matched = match[0];
        const extracted = extractBibleReferenceFromMatch(matched, this.settings.language);
        if (!extracted) continue;

        try {
          const reference =
            extracted.reference ?? parseBibleReference(extracted.text, this.settings.language);
          if (!reference) continue;

          const start = match.index + extracted.offset;
          const end = start + extracted.text.length;

          if (start < 0 || end <= start) continue;

          const key = `${start}:${end}:${extracted.text}`;
          if (seen.has(key)) continue;
          seen.add(key);

          results.push({
            start,
            end,
            matchedText: extracted.text,
            reference,
          });
        } catch {
          continue;
        }
      }
    }

    results.sort((a, b) => {
      if (a.start !== b.start) return a.start - b.start;
      return b.end - a.end;
    });

    const resolved: typeof results = [];

    for (const candidate of results) {
      const previous = resolved[resolved.length - 1];

      if (!previous) {
        resolved.push(candidate);
        continue;
      }

      const overlaps = candidate.start < previous.end;

      if (!overlaps) {
        resolved.push(candidate);
        continue;
      }

      const previousLength = previous.end - previous.start;
      const candidateLength = candidate.end - candidate.start;

      if (candidate.start === previous.start && candidateLength > previousLength) {
        resolved[resolved.length - 1] = candidate;
      }
    }

    return resolved;
  }

  private processRenderedReferences(element: HTMLElement): void {
    if (this.processingElements.has(element)) return;
    this.processingElements.add(element);

    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];

    let currentNode = walker.nextNode();
    while (currentNode) {
      const textNode = currentNode as Text;
      if (!this.isIgnoredTextNode(textNode)) {
        textNodes.push(textNode);
      }
      currentNode = walker.nextNode();
    }

    for (const textNode of textNodes) {
      this.decorateTextNode(textNode);
    }
  }

  private decorateTextNode(textNode: Text): void {
    const text = textNode.nodeValue ?? '';
    const matches = this.detectReferencesInText(text);
    if (matches.length === 0) return;

    const fragment = document.createDocumentFragment();
    let lastIndex = 0;

    for (const match of matches) {
      if (match.start > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.start)));
      }

      const trigger = document.createElement('a');
      trigger.href = '#';
      trigger.textContent = text.slice(match.start, match.end);
      trigger.className = 'jwll-detected-reference';

      trigger.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();

        void this.handleDetectedReferenceClick(match.reference, trigger.textContent ?? '');
      });

      fragment.appendChild(trigger);
      lastIndex = match.end;
    }

    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    textNode.parentNode?.replaceChild(fragment, textNode);
  }

  private async handleDetectedReferenceClick(
    reference: BibleReference,
    matchedText: string,
  ): Promise<void> {
    if (this.settings.autoDetectAction === 'open') {
      this.openDetectedReferenceExternally(reference);
      return;
    }

    try {
      const result = await this.bibleCitationProvider.getCitation(reference, this.settings.language);
      const quoteText = result.success ? result.text : null;

      if (!quoteText) {
        this.openDetectedReferenceExternally(reference);
        return;
      }

      const sourceLabel = this.settings.offlineBible.enabled
        ? this.t('settings.offlineBible.enabled')
        : undefined;

      new DetectedReferenceModal(
        this.app,
        matchedText,
        quoteText,
        sourceLabel,
        () => this.openDetectedReferenceExternally(reference),
      ).open();
    } catch (error) {
      logger.error('Error handling detected reference click:', error);
      this.openDetectedReferenceExternally(reference);
    }
  }

  async loadSettings() {
    const raw = (await this.loadData()) as StoredSettings | null;
    const loadedData = isObject(raw) ? raw : {};

    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loadedData,
      bibleQuote: normalizeBibleQuote(loadedData.bibleQuote),
      offlineBible: normalizeOfflineBible(loadedData.offlineBible),
    };

    this.settings.language =
      typeof loadedData.language === 'string' && loadedData.language.length > 0
        ? loadedData.language
        : DEFAULT_SETTINGS.language;

    this.settings.linkFormat =
      loadedData.linkFormat === 'jwlibrary' || loadedData.linkFormat === 'jworg-finder'
        ? loadedData.linkFormat
        : DEFAULT_SETTINGS.linkFormat;

    this.settings.autoDetectAction =
      loadedData.autoDetectAction === 'popup' || loadedData.autoDetectAction === 'open'
        ? loadedData.autoDetectAction
        : DEFAULT_SETTINGS.autoDetectAction;

    this.settings.bookLength =
      loadedData.bookLength === 'short' ||
      loadedData.bookLength === 'medium' ||
      loadedData.bookLength === 'long'
        ? loadedData.bookLength
        : DEFAULT_SETTINGS.bookLength;

    this.settings.fontStyle =
      loadedData.fontStyle === 'normal' ||
      loadedData.fontStyle === 'italic' ||
      loadedData.fontStyle === 'bold' ||
      loadedData.fontStyle === 'boldItalic'
        ? loadedData.fontStyle
        : DEFAULT_SETTINGS.fontStyle;

    this.settings.prefixOutsideLink =
      typeof loadedData.prefixOutsideLink === 'string'
        ? loadedData.prefixOutsideLink
        : DEFAULT_SETTINGS.prefixOutsideLink;

    this.settings.prefixInsideLink =
      typeof loadedData.prefixInsideLink === 'string'
        ? loadedData.prefixInsideLink
        : DEFAULT_SETTINGS.prefixInsideLink;

    this.settings.suffixInsideLink =
      typeof loadedData.suffixInsideLink === 'string'
        ? loadedData.suffixInsideLink
        : DEFAULT_SETTINGS.suffixInsideLink;

    this.settings.suffixOutsideLink =
      typeof loadedData.suffixOutsideLink === 'string'
        ? loadedData.suffixOutsideLink
        : DEFAULT_SETTINGS.suffixOutsideLink;

    this.settings.openAutomatically =
      typeof loadedData.openAutomatically === 'boolean'
        ? loadedData.openAutomatically
        : DEFAULT_SETTINGS.openAutomatically;

    this.settings.insertQuoteAutomatically =
      typeof loadedData.insertQuoteAutomatically === 'boolean'
        ? loadedData.insertQuoteAutomatically
        : DEFAULT_SETTINGS.insertQuoteAutomatically;

    this.settings.noLanguageParameter =
      typeof loadedData.noLanguageParameter === 'boolean'
        ? loadedData.noLanguageParameter
        : DEFAULT_SETTINGS.noLanguageParameter;

    this.settings.reconvertExistingLinks =
      typeof loadedData.reconvertExistingLinks === 'boolean'
        ? loadedData.reconvertExistingLinks
        : DEFAULT_SETTINGS.reconvertExistingLinks;

    this.settings.autoDetectReferences =
      typeof loadedData.autoDetectReferences === 'boolean'
        ? loadedData.autoDetectReferences
        : DEFAULT_SETTINGS.autoDetectReferences;

    this.settings.autoDetectInReadingView =
      typeof loadedData.autoDetectInReadingView === 'boolean'
        ? loadedData.autoDetectInReadingView
        : DEFAULT_SETTINGS.autoDetectInReadingView;

    this.settings.autoDetectOpenUsesWebShareLink =
      typeof loadedData.autoDetectOpenUsesWebShareLink === 'boolean'
        ? loadedData.autoDetectOpenUsesWebShareLink
        : DEFAULT_SETTINGS.autoDetectOpenUsesWebShareLink;

    this.settings.popupOpenButtonUsesWebShareLink =
      typeof loadedData.popupOpenButtonUsesWebShareLink === 'boolean'
        ? loadedData.popupOpenButtonUsesWebShareLink
        : DEFAULT_SETTINGS.popupOpenButtonUsesWebShareLink;

    this.settings.updatedLinkStructure =
      typeof loadedData.updatedLinkStructure === 'string' &&
      loadedData.updatedLinkStructure.length > 0
        ? loadedData.updatedLinkStructure
        : DEFAULT_SETTINGS.updatedLinkStructure;

    if (!this.settings.bibleQuote?.template) {
      this.settings.bibleQuote = { ...DEFAULT_SETTINGS.bibleQuote };
    }
  }

  async saveSettings() {
    const safeSettings: LinkReplacerSettings = {
      ...this.settings,
      bibleQuote: normalizeBibleQuote(this.settings.bibleQuote),
      offlineBible: normalizeOfflineBible(this.settings.offlineBible),
    };

    this.settings = safeSettings;
    await this.saveData(safeSettings);
    loadBibleBooks(getBookLanguage(this.settings.language));
    this.cachedBookRegex = null;
    this.cachedBookRegexLanguage = null;
  }
}
