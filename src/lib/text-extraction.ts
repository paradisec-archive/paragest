import fs from 'node:fs';

import * as Sentry from '@sentry/aws-serverless';
import type { Cell, Row, Worksheet } from 'exceljs';
import ExcelJS from 'exceljs';
import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import rtfParser from 'rtf-parser';

import { extractEafSegments } from './eaf.js';
import type { ExtractedContent, ExtractedSegment } from './extracted-content.js';
import { type ExtractionStrategy, getExtractionStrategy } from './media.js';
import { MAX_ENTITY_EXPANSIONS } from './xml.js';

const extractRaw = (filePath: string): string => fs.readFileSync(filePath, 'utf-8');

const collectTextNodes = (obj: unknown): string[] => {
  if (typeof obj === 'string') {
    return [obj.trim()].filter(Boolean);
  }

  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return [String(obj)];
  }

  if (Array.isArray(obj)) {
    return obj.flatMap(collectTextNodes);
  }

  if (obj && typeof obj === 'object') {
    return Object.values(obj).flatMap(collectTextNodes);
  }

  return [];
};

const extractXml = (filePath: string): string => {
  const content = fs.readFileSync(filePath, 'utf-8');
  const parser = new XMLParser({
    // We only care about text content, not attribute values
    ignoreAttributes: true,
    // Strip whitespace from text nodes for cleaner extracted output
    trimValues: true,
    processEntities: { maxTotalExpansions: MAX_ENTITY_EXPANSIONS },
  });

  try {
    const parsed = parser.parse(content);
    return collectTextNodes(parsed).join(' ');
  } catch (error) {
    Sentry.captureMessage(`XML parsing failed, falling back to raw text: ${error}`, 'warning');
    return content;
  }
};

const extractMammoth = async (filePath: string): Promise<string> => {
  const result = await mammoth.extractRawText({ path: filePath });

  return result.value;
};

const extractXlsx = async (filePath: string): Promise<string> => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const sheets: string[] = [];
  workbook.eachSheet((worksheet: Worksheet) => {
    const rows: string[] = [];
    worksheet.eachRow((row: Row) => {
      const cells: string[] = [];
      row.eachCell((cell: Cell) => {
        cells.push(String(cell.value ?? ''));
      });
      rows.push(cells.join(','));
    });
    sheets.push(rows.join('\n'));
  });

  return sheets.join('\n');
};

const extractPdf = async (filePath: string): Promise<string> => {
  // Lazily imported: pdf-parse pulls in pdf.js, which eagerly references browser globals
  // (DOMMatrix) at module load. A static import crashes esbuild-bundled Fargate jobs on start,
  // so only load it when a PDF is actually processed.
  const { PDFParse } = await import('pdf-parse');
  const data = fs.readFileSync(filePath);
  const pdf = new PDFParse({ data: new Uint8Array(data) });
  const result = await pdf.getText();
  await pdf.destroy();

  return result.text;
};

// TODO: rtf-parser is unmaintained (last updated 2019), explore alternatives like rtf-parser-wasm
const extractRtf = (filePath: string): Promise<string> =>
  new Promise((resolve, reject) => {
    rtfParser.stream(fs.createReadStream(filePath), (err, doc) => {
      if (err) return reject(err);

      const extractSpans = (node: { value?: string; content?: typeof doc.content }): string[] => {
        if (node.value) return [node.value];
        if (node.content) return node.content.flatMap(extractSpans);
        return [];
      };

      resolve(doc.content.flatMap(extractSpans).join('\n'));
    });
  });

const extractOdt = async (filePath: string): Promise<string> => {
  const data = fs.readFileSync(filePath);
  const zip = await JSZip.loadAsync(data);
  const contentXml = zip.file('content.xml');
  if (!contentXml) {
    throw new Error('No content.xml found in ODT file');
  }

  const xml = await contentXml.async('string');
  const parser = new XMLParser({ ignoreAttributes: true, trimValues: true });
  const parsed = parser.parse(xml);
  return collectTextNodes(parsed).join(' ');
};

const MAX_TEXT_LENGTH = 5 * 1024 * 1024;

const truncateText = (text: string): string => {
  if (text.length <= MAX_TEXT_LENGTH) return text;

  const lastBreak = Math.max(text.lastIndexOf('\n', MAX_TEXT_LENGTH), text.lastIndexOf(' ', MAX_TEXT_LENGTH));

  return text.slice(0, lastBreak > 0 ? lastBreak : MAX_TEXT_LENGTH);
};

const extractStrategyText = async (filePath: string, strategy: Exclude<ExtractionStrategy, 'eaf'>): Promise<string> => {
  switch (strategy) {
    case 'raw':
      return extractRaw(filePath);
    case 'xml':
      return extractXml(filePath);
    case 'mammoth':
      return extractMammoth(filePath);
    case 'xlsx':
      return extractXlsx(filePath);
    case 'pdf':
      return extractPdf(filePath);
    case 'rtf':
      return extractRtf(filePath);
    case 'odt':
      return extractOdt(filePath);
  }
};

export const extractContent = async (filePath: string, extension: string): Promise<ExtractedContent | null> => {
  const strategy = getExtractionStrategy(extension);
  if (!strategy) {
    throw new Error(`No extraction strategy for extension: ${extension}`);
  }

  if (strategy === 'eaf') {
    const segments = extractElanSegments(filePath);
    if (segments) return { contentType: 'ELAN', segments };
    // Fall back to the flat-XML TEXT path so a broken EAF still ingests, and its
    // stored content type stays `text` — keeping it in the backfill's retryable population
  }

  const text = truncateText(await extractStrategyText(filePath, strategy === 'eaf' ? 'xml' : strategy));

  return text ? { contentType: 'TEXT', text } : null;
};

// Returns null (rather than throwing or returning empty) when the EAF is unparseable
// or yields no usable annotations, so the caller can fall back to flat text
const extractElanSegments = (filePath: string): ExtractedSegment[] | null => {
  try {
    const segments = extractEafSegments(filePath);
    if (segments.length > 0) return segments;

    Sentry.captureMessage(`EAF extraction produced no segments, falling back to flat XML text: ${filePath}`, 'warning');
  } catch (error) {
    Sentry.captureMessage(`EAF extraction failed, falling back to flat XML text: ${error}`, 'warning');
  }

  return null;
};

export const contentCharacterCount = (content: ExtractedContent | null): number => {
  if (!content) return 0;

  return content.contentType === 'TEXT' ? content.text.length : content.segments.reduce((sum, segment) => sum + segment.text.length, 0);
};
