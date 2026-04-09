import fs from 'node:fs';

import * as Sentry from '@sentry/aws-serverless';
import type { Cell, Row, Worksheet } from 'exceljs';
import ExcelJS from 'exceljs';
import { XMLParser } from 'fast-xml-parser';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import rtfParser from 'rtf-parser';

import { getExtractionStrategy } from './media.js';

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
    // Linguistic files (EAF, IMDI, FlexText) commonly exceed the default limit of 1000
    // due to standard XML escaping (&amp;, &lt;, etc.) across thousands of annotations
    processEntities: { maxTotalExpansions: 100_000 },
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

const MAX_TEXT_LENGTH = 5 * 1024 * 1024;

const truncateText = (text: string): string => {
  if (text.length <= MAX_TEXT_LENGTH) return text;

  const lastBreak = Math.max(text.lastIndexOf('\n', MAX_TEXT_LENGTH), text.lastIndexOf(' ', MAX_TEXT_LENGTH));

  return text.slice(0, lastBreak > 0 ? lastBreak : MAX_TEXT_LENGTH);
};

export const extractText = async (filePath: string, extension: string): Promise<string> => {
  const strategy = getExtractionStrategy(extension);
  if (!strategy) {
    throw new Error(`No extraction strategy for extension: ${extension}`);
  }

  switch (strategy) {
    case 'raw':
      return truncateText(extractRaw(filePath));
    case 'xml':
      return truncateText(extractXml(filePath));
    case 'mammoth':
      return truncateText(await extractMammoth(filePath));
    case 'xlsx':
      return truncateText(await extractXlsx(filePath));
    case 'pdf':
      return truncateText(await extractPdf(filePath));
    case 'rtf':
      return truncateText(await extractRtf(filePath));
  }
};
