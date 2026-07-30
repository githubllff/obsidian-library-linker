const BOOK_PATTERN = String.raw`(?:[1-5]\.?\s*)?[\p{L}][\p{L}\s.\-]{0,40}`;
const REFERENCE_PATTERN = String.raw`\d+:\d+(?:\s*-\s*(?:\d+(?::\d+)?))?(?:\s*,\s*\d+(?:\s*-\s*\d+)?)*`;

export const BIBLE_REFERENCE_REGEX = new RegExp(
  String.raw`(?!\s)(?:\{\{[^}]+\}\}|${BOOK_PATTERN}\s*${REFERENCE_PATTERN})(?<!\s)`,
  'giu',
);
