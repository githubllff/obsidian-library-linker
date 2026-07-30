import { Editor, Notice, Plugin, Menu } from 'obsidian';
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
import {
  insertAllBibleQuotes,
  insertBibleQuoteAtCursor,
  generateBibleQuoteText,
} from '@/utils/insertBibleQuotes';
import { logger } from '@/utils/logger';
import { getBookLanguage } from '@/utils/signLanguage';
import { ContentSelection } from '@/utils/findJWLibraryLinks';
import { parseBibleReference, extractBibleReferenceFromMatch } from '@/utils/parseBibleReference';
import { BIBLE_REFERENCE_REGEX } from '@/utils/bibleReferenceRegex';
import { buildBookNameRegex } from '@/utils/buildBookNameRegex';
import { formatBibleText } from '@/utils/formatBibleText';
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
