import {
  Editor,
  EditorPosition,
  EditorSuggest,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
} from 'obsidian';
import type { BibleReference, BibleSuggestion } from '@/types';
import { formatBibleText } from '@/utils/formatBibleText';
import { parseBibleReference, extractBibleReferenceFromMatch } from '@/utils/parseBibleReference';
import { formatJWLibraryLink } from '@/utils/formatJWLibraryLink';
import { convertBibleTextToMarkdownLink } from '@/utils/convertBibleTextToMarkdownLink';
import type JWLibraryLinkerPlugin from '@/main';
import { BIBLE_REFERENCE_REGEX } from '@/utils/bibleReferenceRegex';
import { buildBookNameRegex } from '@/utils/buildBookNameRegex';
import { logger } from '@/utils/logger';

const TRIGGER = '/b ';

export class BibleReferenceSuggester extends EditorSuggest<BibleSuggestion> {
  plugin: JWLibraryLinkerPlugin;
  private t: (key: string, variables?: Record<string, string>) => string;
  private cachedBookRegex: RegExp | null = null;
  private cachedBookRegexLanguage: string | null = null;

  constructor(plugin: JWLibraryLinkerPlugin) {
    super(plugin.app);
    this.plugin = plugin;
    this.t = this.plugin.getTranslationService().t.bind(this.plugin.getTranslationService());
  }

  private getBookRegex(): RegExp {
    const lang = this.plugin.settings.language;
    if (this.cachedBookRegex && this.cachedBookRegexLanguage === lang) {
      return this.cachedBookRegex;
    }
    this.cachedBookRegex = buildBookNameRegex(lang);
    this.cachedBookRegexLanguage = lang;
    return this.cachedBookRegex;
  }

  onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
    const line = editor.getLine(cursor.line);

    const match = line.match(BIBLE_REFERENCE_REGEX) || line.match(this.getBookRegex());

    if (match?.[0]) {
      const result = extractBibleReferenceFromMatch(match[0], this.plugin.settings.language);

      if (result) {
        const rawMatchStart = line.indexOf(match[0]);
        const matchStart = rawMatchStart + result.offset;
        const matchEnd = matchStart + result.text.length;

        const beforeMatch = line.substring(0, matchStart);
        const afterMatch = line.substring(matchEnd);

        const hasLinkBefore = /\[\*{0,2}$/.test(beforeMatch);
        const hasLinkAfter = /^\*{0,2}\]\(/.test(afterMatch);
        const isAlreadyLinked = hasLinkBefore && hasLinkAfter;

        if (!line.includes(TRIGGER) && !isAlreadyLinked) {
          return {
            start: { ch: matchStart, line: cursor.line },
            end: { ch: matchEnd, line: cursor.line },
            query: result.text,
          };
        }
      }
    }

    const trigger = TRIGGER;
    const commandIndex = line.lastIndexOf(trigger);
    if (commandIndex === -1) return null;

    const afterCommand = line.slice(commandIndex + trigger.length);
    if (afterCommand.length > 0) {
      return {
        start: { ch: commandIndex, line: cursor.line },
        end: { ch: line.length, line: cursor.line },
        query: afterCommand.trim(),
      };
    }

    return null;
  }

  getSuggestions(context: EditorSuggestContext): BibleSuggestion[] {
    const query = context.query;
    const isExplicitMode = query.includes(TRIGGER);

    if (query.length === 0 && isExplicitMode) {
      return [
        {
          text: query,
          command: 'link',
          description: this.t('suggestions.typingEmpty'),
        },
      ];
    }

    if (!isExplicitMode && !query.match(BIBLE_REFERENCE_REGEX)) {
      return [];
    }

    let reference: BibleReference | null = null;

    try {
      reference = parseBibleReference(query, this.plugin.settings.language);
    } catch (error: unknown) {
      logger.error(error instanceof Error ? error.message : String(error));

      if (!isExplicitMode) return [];

      return [
        {
          text: query,
          command: 'typing',
          description: this.t('suggestions.typing', { text: query }),
        },
      ];
    }

    if (!reference) {
      return [];
    }

    const formattedText = formatBibleText(
      reference,
      this.plugin.settings.bookLength,
      this.plugin.settings.language,
    );

    const links = formatJWLibraryLink(reference, this.plugin.settings.language);
    const hasMultipleLinks = Array.isArray(links) && links.length > 1;

    const linkSuggestion: BibleSuggestion = {
      text: query,
      command: 'link',
      description: hasMultipleLinks
        ? this.t('suggestions.createLinks', { text: formattedText })
        : this.t('suggestions.createLink', { text: formattedText }),
    };

    const openSuggestion: BibleSuggestion = {
      text: query,
      command: 'open',
      description: hasMultipleLinks
        ? this.t('suggestions.createMultipleAndOpenFirst', { text: formattedText })
        : this.t('suggestions.createAndOpen', { text: formattedText }),
    };

    const quoteSuggestion: BibleSuggestion = {
      text: query,
      command: 'linkAndQuote',
      description: hasMultipleLinks
        ? `Create links & insert quote for ${formattedText}`
        : `Create link & insert quote for ${formattedText}`,
    };

    // Default order: link, open, linkAndQuote
    const suggestions: BibleSuggestion[] = [linkSuggestion, openSuggestion, quoteSuggestion];

    // openAutomatically floats open to top
    if (this.plugin.settings.openAutomatically) {
      suggestions.splice(suggestions.indexOf(openSuggestion), 1);
      suggestions.unshift(openSuggestion);
    }

    // insertQuoteAutomatically floats linkAndQuote to top (takes priority)
    if (this.plugin.settings.insertQuoteAutomatically) {
      suggestions.splice(suggestions.indexOf(quoteSuggestion), 1);
      suggestions.unshift(quoteSuggestion);
    }

    return suggestions;
  }

  renderSuggestion(suggestion: BibleSuggestion, el: HTMLElement): void {
    el.setText(suggestion.description);
  }

  selectSuggestion(suggestion: BibleSuggestion): void {
    if (!this.context) return;

    const { context } = this;
    const editor = context.editor;

    const reference = parseBibleReference(suggestion.text, this.plugin.settings.language);
    const linkLanguage = this.plugin.settings.noLanguageParameter
      ? undefined
      : this.plugin.settings.language;

    const convertedLink = convertBibleTextToMarkdownLink(reference, this.plugin.settings);

    if (suggestion.command === 'typing' || !convertedLink) {
      return;
    }

    editor.replaceRange(convertedLink, context.start, context.end);
    this.close();

    if (suggestion.command === 'open') {
      const url = formatJWLibraryLink(reference, linkLanguage);
      if (Array.isArray(url)) {
        window.open(url[suggestion.linkIndex || 0]);
      } else {
        window.open(url);
      }
    }

    if (suggestion.command === 'linkAndQuote') {
      // No setTimeout needed — we pass the reference directly so no editor
      // line scanning is required. The quote fetch is async and inserts
      // at end-of-line once the citation comes back.
      void this.plugin.insertBibleQuoteForReference(editor, reference);
    }
  }
}
