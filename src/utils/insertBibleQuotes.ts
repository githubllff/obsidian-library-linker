import { Editor } from 'obsidian';
import { convertBibleTextToMarkdownLink } from '@/utils/convertBibleTextToMarkdownLink';
import { formatBibleText } from '@/utils/formatBibleText';
import type { BibleCitationProvider, LinkReplacerSettings } from '@/types';
import {
  findJWLibraryLinks,
  findJWLibraryLinksInLine,
  parseJWLibraryLink,
  type JWLibraryLinkInfo,
  type ContentSelection,
} from '@/utils/findJWLibraryLinks';
import { logger } from '@/utils/logger';
import { getBookLanguage } from './signLanguage';

function processTemplate(
  template: string,
  variables: {
    bibleRef: string;
    bibleRefLinked: string;
    quote: string;
  },
): string {
  // Only use the quote part of the template — strip the {bibleRefLinked} line
  // since the reference already exists in the note
  return template
    .replace(/\{bibleRef\}/g, variables.bibleRef.trim())
    .replace(/\{bibleRefLinked\}/g, variables.bibleRefLinked.trim())
    .replace(/\{quote\}/g, variables.quote.trim());
}

/**
 * Given a full template output, strip the first line if it only contains
 * the bibleRef or bibleRefLinked (since the link already exists in the note).
 * This prevents duplicating the reference.
 */
function stripReferenceLine(templateOutput: string, bibleRefLinked: string, bibleRef: string): string {
  const lines = templateOutput.split('\n');
  const firstLine = lines[0].trim();

  // If the first line is just the reference link, remove it
  if (firstLine === bibleRefLinked.trim() || firstLine === bibleRef.trim()) {
    return lines.slice(1).join('\n');
  }

  return templateOutput;
}

async function generateBibleQuoteText(
  linkInfo: JWLibraryLinkInfo,
  settings: LinkReplacerSettings,
  provider: BibleCitationProvider,
): Promise<string | null> {
  try {
    const result = await provider.getCitation(
      linkInfo.reference,
      getBookLanguage(settings.language),
    );

    if (!result.success || !result.text) {
      logger.warn('generateBibleQuoteText: fetch failed —', result.error ?? 'empty text');
      return null;
    }

    const bibleRefLinked = convertBibleTextToMarkdownLink(linkInfo.reference, settings);
    if (!bibleRefLinked) {
      logger.warn('generateBibleQuoteText: convertBibleTextToMarkdownLink returned falsy');
      return null;
    }

    const bibleRef = formatBibleText(linkInfo.reference, settings.bookLength, settings.language);

    const fullOutput = processTemplate(settings.bibleQuote.template, {
      bibleRef,
      bibleRefLinked,
      quote: result.text,
    });

    // Remove the reference line from the output — it already exists in the note
    return stripReferenceLine(fullOutput, bibleRefLinked, bibleRef);
  } catch (error: unknown) {
    logger.error(
      'generateBibleQuoteText: error:',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

/**
 * Finds the character position immediately after a given URL within a line of markdown.
 * Handles both [text](url) markdown links and bare URLs.
 */
function findEndOfLinkInLine(line: string, url: string): number {
  // Look for markdown link pattern [text](url)
  const escapedUrl = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const markdownLinkRegex = new RegExp(`\\[[^\\]]*\\]\\(${escapedUrl}[^)]*\\)`);
  const match = line.match(markdownLinkRegex);

  if (match && match.index !== undefined) {
    return match.index + match[0].length;
  }

  // Fallback: find bare URL
  const urlIndex = line.indexOf(url);
  if (urlIndex !== -1) {
    return urlIndex + url.length;
  }

  // Last resort: end of line
  return line.length;
}

interface InsertQuotesResult {
  inserted: number;
  linksFound: number;
  fetchFailed: number;
}

export async function insertAllBibleQuotes(
  editor: Editor,
  settings: LinkReplacerSettings,
  provider: BibleCitationProvider,
  selection?: ContentSelection,
): Promise<InsertQuotesResult> {
  const links = findJWLibraryLinks(editor, selection);

  logger.log('insertAllBibleQuotes: found links:', links.length);

  if (links.length === 0) {
    return { inserted: 0, linksFound: 0, fetchFailed: 0 };
  }

  const changes: Array<{
    from: { line: number; ch: number };
    to: { line: number; ch: number };
    text: string;
  }> = [];

  let skippedAlreadyQuoted = 0;
  let fetchFailed = 0;

  // Process in reverse order to preserve line/character positions
  for (let i = links.length - 1; i >= 0; i--) {
    const linkInfo = links[i];

    if (linkInfo.lineNumber > editor.lastLine()) continue;

    const currentLine = editor.getLine(linkInfo.lineNumber);
    const nextLine =
      linkInfo.lineNumber < editor.lastLine() ? editor.getLine(linkInfo.lineNumber + 1) : '';

    // Skip if a quote block already follows this line
    if (nextLine && nextLine.trim().startsWith('>')) {
      skippedAlreadyQuoted++;
      logger.log(`Skipping line ${linkInfo.lineNumber} — already has quote below`);
      continue;
    }

    try {
      const quoteText = await generateBibleQuoteText(linkInfo, settings, provider);
      if (quoteText) {
        // Find exactly where the link ends in the line
        const insertAt = findEndOfLinkInLine(currentLine, linkInfo.url);

        // Get text before and after the link on the same line
        const textAfterLink = currentLine.substring(insertAt);

        // Build insertion: newline + quote + any text that was after the link
        let insertion = '\n' + quoteText;
        if (textAfterLink.trim()) {
          insertion += '\n' + textAfterLink.trim();
        }

        changes.push({
          from: { line: linkInfo.lineNumber, ch: insertAt },
          to: { line: linkInfo.lineNumber, ch: currentLine.length },
          text: insertion,
        });
      } else {
        fetchFailed++;
      }
    } catch (error: unknown) {
      fetchFailed++;
      logger.error(
        `Error processing link ${i}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  logger.log(
    `insertAllBibleQuotes: ${links.length} found, ${changes.length} inserted, ${skippedAlreadyQuoted} skipped, ${fetchFailed} failed`,
  );

  if (changes.length > 0) {
    editor.transaction({ changes });
  }

  return { inserted: changes.length, linksFound: links.length, fetchFailed };
}

export async function insertBibleQuoteAtCursor(
  editor: Editor,
  settings: LinkReplacerSettings,
  provider: BibleCitationProvider,
): Promise<{ inserted: boolean; alreadyExists: boolean; fetchFailed: boolean }> {
  const cursor = editor.getCursor();
  const cursorLine = cursor.line;

  if (cursorLine > editor.lastLine()) {
    return { inserted: false, alreadyExists: false, fetchFailed: false };
  }

  const currentLine = editor.getLine(cursorLine);
  const nextLine = cursorLine < editor.lastLine() ? editor.getLine(cursorLine + 1) : '';

  // Skip if quote already exists below
  if (nextLine && nextLine.trim().startsWith('>')) {
    return { inserted: false, alreadyExists: true, fetchFailed: false };
  }

  const candidateLineNumbers = [
    cursorLine,
    cursorLine > 0 ? cursorLine - 1 : null,
    cursorLine < editor.lastLine() ? cursorLine + 1 : null,
  ].filter((lineNumber): lineNumber is number => lineNumber !== null);

  let linksOnTargetLine: JWLibraryLinkInfo[] = [];
  let targetLineNumber = cursorLine;
  let targetLineText = currentLine;

  for (const lineNumber of candidateLineNumbers) {
    const lineText = editor.getLine(lineNumber);
    const links = findJWLibraryLinksInLine(lineText, lineNumber);
    if (links.length > 0) {
      linksOnTargetLine = links;
      targetLineNumber = lineNumber;
      targetLineText = lineText;
      break;
    }
  }

  if (linksOnTargetLine.length === 0) {
    return { inserted: false, alreadyExists: false, fetchFailed: false };
  }

  // Use the last link on the line as the insertion point
  const lastLink = linksOnTargetLine[linksOnTargetLine.length - 1];
  const insertAt = findEndOfLinkInLine(targetLineText, lastLink.url);
  const textAfterLink = targetLineText.substring(insertAt);

  const quoteTexts: string[] = [];
  for (const linkInfo of linksOnTargetLine) {
    const reference = parseJWLibraryLink(linkInfo.url);
    if (reference) {
      const quoteText = await generateBibleQuoteText({ ...linkInfo, reference }, settings, provider);
      if (quoteText) {
        quoteTexts.push(quoteText);
      }
    }
  }

  if (quoteTexts.length > 0) {
    let combinedText = '\n' + quoteTexts.join('\n\n');
    if (textAfterLink.trim()) {
      combinedText += '\n' + textAfterLink.trim();
    }

    editor.transaction({
      changes: [
        {
          from: { line: targetLineNumber, ch: insertAt },
          to: { line: targetLineNumber, ch: targetLineText.length },
          text: combinedText,
        },
      ],
    });
    return { inserted: true, alreadyExists: false, fetchFailed: false };
  }

  return { inserted: false, alreadyExists: false, fetchFailed: linksOnTargetLine.length > 0 };
}
