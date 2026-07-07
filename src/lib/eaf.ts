import fs from 'node:fs';

import { XMLParser } from 'fast-xml-parser';

import type { ExtractedSegment } from './extracted-content.js';
import { MAX_ENTITY_EXPANSIONS } from './xml.js';

type EafTimeSlot = {
  '@_TIME_SLOT_ID': string;
  '@_TIME_VALUE'?: string;
};

type EafAlignableAnnotation = {
  '@_TIME_SLOT_REF1': string;
  '@_TIME_SLOT_REF2': string;
  ANNOTATION_VALUE?: string;
};

type EafAnnotation = {
  ALIGNABLE_ANNOTATION?: EafAlignableAnnotation;
};

type EafTier = {
  '@_TIER_ID': string;
  ANNOTATION?: EafAnnotation[];
};

type EafDocument = {
  ANNOTATION_DOCUMENT?: {
    TIME_ORDER?: {
      TIME_SLOT?: EafTimeSlot[];
    };
    TIER?: EafTier[];
  };
};

// Elements that may repeat; fast-xml-parser only produces an array when there are
// two or more, so force these to always be arrays
const ARRAY_ELEMENTS = new Set(['TIME_SLOT', 'TIER', 'ANNOTATION']);

const parseEaf = (filePath: string): EafDocument => {
  const content = fs.readFileSync(filePath, 'utf-8');
  const parser = new XMLParser({
    // Times, tier IDs and annotation references all live in attributes
    ignoreAttributes: false,
    // Keep annotation values verbatim as strings ("57" must not become a number)
    parseTagValue: false,
    trimValues: true,
    processEntities: { maxTotalExpansions: MAX_ENTITY_EXPANSIONS },
    isArray: (name) => ARRAY_ELEMENTS.has(name),
  });

  return parser.parse(content) as EafDocument;
};

// TIME_SLOTs may legally omit TIME_VALUE (unanchored). Resolve them by widening to
// the nearest anchored slot in TIME_ORDER: backwards for a start, forwards for an end.
const resolveSlotMs = (slots: EafTimeSlot[], slotIndex: Map<string, number>, slotId: string, direction: -1 | 1): number | undefined => {
  const index = slotIndex.get(slotId);
  if (index === undefined) return undefined;

  for (let i = index; i >= 0 && i < slots.length; i += direction) {
    const value = slots[i]?.['@_TIME_VALUE'];
    if (value !== undefined) return Number(value);
  }

  return undefined;
};

// One ANNOTATION segment per alignable annotation across all tiers, sorted by start
// time. Ref-annotations (translations, glosses) are not extracted yet. Throws on
// unparseable or structurally unrecognisable files — the caller decides the fallback.
export const extractEafSegments = (filePath: string): ExtractedSegment[] => {
  const document = parseEaf(filePath).ANNOTATION_DOCUMENT;
  if (!document) {
    throw new Error('Not an EAF file: no ANNOTATION_DOCUMENT root element');
  }

  const slots = document.TIME_ORDER?.TIME_SLOT ?? [];
  const slotIndex = new Map(slots.map((slot, index) => [slot['@_TIME_SLOT_ID'], index]));

  const segments = (document.TIER ?? []).flatMap((tier) =>
    (tier.ANNOTATION ?? []).flatMap((annotation): ExtractedSegment[] => {
      const alignable = annotation.ALIGNABLE_ANNOTATION;
      if (!alignable) return [];

      const text = alignable.ANNOTATION_VALUE?.trim();
      if (!text) return [];

      return [
        {
          type: 'ANNOTATION',
          text,
          tier: tier['@_TIER_ID'],
          startMs: resolveSlotMs(slots, slotIndex, alignable['@_TIME_SLOT_REF1'], -1),
          endMs: resolveSlotMs(slots, slotIndex, alignable['@_TIME_SLOT_REF2'], 1),
        },
      ];
    }),
  );

  return segments.sort((a, b) => (a.startMs ?? Number.POSITIVE_INFINITY) - (b.startMs ?? Number.POSITIVE_INFINITY));
};
