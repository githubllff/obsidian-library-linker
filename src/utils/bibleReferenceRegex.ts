export const BIBLE_REFERENCE_REGEX = new RegExp(
  String.raw`\{\{[^}]+\}\}|(?:[1-5]\.?\s*)?[\p{L}][\p{L}\s.\-]{0,40}(?:\s+\d+:\d+(?:\s*-\s*(?:\d+(?::\d+)?))?(?:\s*,\s*\d+(?:\s*-\s*\d+)?)*)`,
  'giu',
);
