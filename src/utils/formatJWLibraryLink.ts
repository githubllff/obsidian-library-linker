import { bibleBookExists } from '@/utils/bibleBookExists';
import type { BibleReference, Language, LinkFormat } from '@/types';
import { padBook, padChapter, padVerse } from '@/utils/padNumber';

export function formatJWLibraryLink(
  reference: BibleReference,
  language?: Language,
  linkFormat: LinkFormat = 'jwlibrary',
): string | string[] {
  const { book, chapter, endChapter, verseRanges } = reference;

  if (!bibleBookExists(book)) {
    throw new Error('errors.bookNotFound');
  }

  const link = (finderParam: string, isChapterOnly = false) => {
    if (linkFormat === 'jworg-finder') {
      const locale = language ?? 'E';
      const bibleParam = isChapterOnly ? `book=${finderParam}` : `bible=${finderParam}`;
      return `https://www.jw.org/finder?srcid=jwlshare&wtlocale=${locale}&prefer=lang&${bibleParam}&pub=nwtsty`;
    }

    if (isChapterOnly) {
      return `jwlibrary:///finder?book=${finderParam}${language ? `&wtlocale=${language}` : ''}`;
    }

    return `jwlibrary:///finder?bible=${finderParam}${language ? `&wtlocale=${language}` : ''}`;
  };

  const padRange = (bookNumber: number, chapterNumber: number, verseNumber: number) =>
    `${padBook(bookNumber)}${padChapter(chapterNumber)}${padVerse(verseNumber)}`;

  const padBookChapter = (bookNumber: number, chapterNumber: number) =>
    `${padBook(bookNumber)}${padChapter(chapterNumber)}`;

  // Whole-book / chapter-only link support
  if (!verseRanges || verseRanges.length === 0) {
    return link(padBookChapter(book, chapter), true);
  }

  // Single range -> single string
  if (verseRanges.length === 1) {
    const { start, end } = verseRanges[0];
    const startChapter = chapter;
    const endChapterValue = endChapter || chapter;
    const baseReference = padRange(book, startChapter, start);

    if (start === end && startChapter === endChapterValue) {
      return link(baseReference);
    }

    return link(`${baseReference}-${padRange(book, endChapterValue, end)}`);
  }

  // Multiple ranges -> array of links
  return verseRanges.map(({ start, end }) => {
    const baseReference = padRange(book, chapter, start);

    if (start === end) {
      return link(baseReference);
    }

    return link(`${baseReference}-${padRange(book, chapter, end)}`);
  });
}
