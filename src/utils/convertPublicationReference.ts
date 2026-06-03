export function convertPublicationReference(url: string, format: 'jwlibrary' | 'jworg-finder' = 'jwlibrary'): string {
  const parts = url.split('/');
  const pubRef = parts[3];
  const [locale, docId] = pubRef.split(':');
  const paragraph = parts[4];

  const params = new URLSearchParams({ wtlocale: locale, docid: docId });
  if (paragraph) params.set('par', paragraph);

  if (format === 'jworg-finder') {
    return `https://www.jw.org/finder?${params.toString()}`;
  }

  return `jwlibrary:///finder?${params.toString()}`;
}
