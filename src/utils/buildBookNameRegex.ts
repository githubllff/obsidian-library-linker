import type { Language } from '@/types';
import { getBibleBooks } from '@/stores/bibleBooks';

function escapeRegex(str: string): string {
  return str.replace(/[*+?^${}()|[\]\\]/g, '\\$&');
}

function makeFlexibleNamePattern(name: string): string {
  return escapeRegex(name.trim()).replace(/\./g, '\\.?').replace(/\s+/g, '[\\s.\\-]*');
}

export function buildBookNameRegex(language: Language): RegExp {
  const books = getBibleBooks(language);
  const allNames = new Set<string>();

  for (const book of books) {
    const names = [book.name.short, book.name.medium, book.name.long, ...book.aliases].filter(
      Boolean,
    );

    for (const name of names) {
      allNames.add(name);

      if (name.endsWith('.')) {
        allNames.add(name.slice(0, -1));
      }

      if (book.prefix) {
        allNames.add(`${book.prefix}${name}`);
        allNames.add(`${book.prefix} ${name}`);
        allNames.add(`${book.prefix}. ${name}`);
        allNames.add(`${book.prefix}.${name}`);
      }
    }
  }

  const patterns = [...allNames]
    .filter((name) => name.trim().length > 0)
    .sort((a, b) => b.length - a.length)
    .map(makeFlexibleNamePattern);

  const bookPattern = `(?:${patterns.join('|')})`;

  // Broad candidate tail:
  // - chapter:verse
  // - chapter:verse-verse
  // - chapter:verse-endChapter:endVerse
  // - comma-separated verse segments
  // - optional verse-only for single-chapter style detection
  const numericTail =
    '(?:\\s*\\d+(?::\\d+(?:\\s*-\\s*(?:\\d+(?::\\d+)?))?(?:\\s*,\\s*\\d+(?:\\s*-\\s*\\d+)?)*)?|\\s*\\d+(?:\\s*-\\s*\\d+)?(?:\\s*,\\s*\\d+(?:\\s*-\\s*\\d+)?)*)';

  return new RegExp(`${bookPattern}${numericTail}`, 'giu');
}
