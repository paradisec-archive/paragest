import fs from 'node:fs';

import * as Sentry from '@sentry/aws-serverless';
import { XMLParser } from 'fast-xml-parser';

import type { ExtractedSegment } from './extracted-content.js';
import { MAX_ENTITY_EXPANSIONS } from './xml.js';

type EafTimeSlot = {
  '@_TIME_SLOT_ID': string;
  '@_TIME_VALUE'?: string;
};

type EafAlignableAnnotation = {
  '@_ANNOTATION_ID'?: string;
  '@_TIME_SLOT_REF1': string;
  '@_TIME_SLOT_REF2': string;
  ANNOTATION_VALUE?: string;
};

type EafRefAnnotation = {
  '@_ANNOTATION_ID'?: string;
  '@_ANNOTATION_REF'?: string;
  ANNOTATION_VALUE?: string;
};

type EafAnnotation = {
  ALIGNABLE_ANNOTATION?: EafAlignableAnnotation;
  REF_ANNOTATION?: EafRefAnnotation;
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

type Interval = { startMs?: number | undefined; endMs?: number | undefined };

type AnnotationNode = {
  id?: string | undefined;
  tier: string;
  text?: string | undefined;
  // An alignable annotation's interval is resolved at construction; a ref-annotation
  // carries refId and resolves lazily through the chain
  interval?: Interval | undefined;
  refId?: string | undefined;
};

// One ANNOTATION segment per annotation across all tiers, sorted by start time.
// Ref-annotations (translations, glosses) carry the full interval of the alignable
// annotation their ANNOTATION_REF chain reaches — no interpolation. Throws on
// unparseable or structurally unrecognisable files — the caller decides the fallback.
export const extractEafSegments = (filePath: string): ExtractedSegment[] => {
  const document = parseEaf(filePath).ANNOTATION_DOCUMENT;
  if (!document) {
    throw new Error('Not an EAF file: no ANNOTATION_DOCUMENT root element');
  }

  const slots = document.TIME_ORDER?.TIME_SLOT ?? [];
  const slotIndex = new Map(slots.map((slot, index) => [slot['@_TIME_SLOT_ID'], index]));

  const annotations = (document.TIER ?? []).flatMap((tier) =>
    (tier.ANNOTATION ?? []).flatMap((annotation): AnnotationNode[] => {
      const alignable = annotation.ALIGNABLE_ANNOTATION;
      if (alignable) {
        return [
          {
            id: alignable['@_ANNOTATION_ID'],
            tier: tier['@_TIER_ID'],
            text: alignable.ANNOTATION_VALUE?.trim(),
            interval: {
              startMs: resolveSlotMs(slots, slotIndex, alignable['@_TIME_SLOT_REF1'], -1),
              endMs: resolveSlotMs(slots, slotIndex, alignable['@_TIME_SLOT_REF2'], 1),
            },
          },
        ];
      }

      const ref = annotation.REF_ANNOTATION;
      if (ref) {
        return [
          {
            id: ref['@_ANNOTATION_ID'],
            tier: tier['@_TIER_ID'],
            text: ref.ANNOTATION_VALUE?.trim(),
            refId: ref['@_ANNOTATION_REF'],
          },
        ];
      }

      return [];
    }),
  );

  const nodesById = new Map(annotations.filter((node) => node.id !== undefined).map((node) => [node.id, node]));

  // Memoised resolution to the alignable ancestor's interval. null marks a broken
  // chain (dangling ref, cycle, or a chain that never reaches an alignable annotation).
  const intervals = new Map<string | undefined, Interval | null>();

  const resolveNodeInterval = (node: AnnotationNode): Interval | null => node.interval ?? resolveRefInterval(node.refId);

  const resolveRefInterval = (id: string | undefined): Interval | null => {
    const memoised = intervals.get(id);
    if (memoised !== undefined) return memoised;

    // Mark in-progress before recursing so a reference cycle resolves as broken
    intervals.set(id, null);

    const node = id === undefined ? undefined : nodesById.get(id);
    const interval = node ? resolveNodeInterval(node) : null;
    intervals.set(id, interval);

    return interval;
  };

  let brokenChains = 0;
  const segments = annotations.flatMap((node): ExtractedSegment[] => {
    if (!node.text) return [];

    const interval = resolveNodeInterval(node);
    if (interval === null) brokenChains += 1;

    return [
      {
        type: 'ANNOTATION',
        text: node.text,
        tier: node.tier,
        startMs: interval?.startMs,
        endMs: interval?.endMs,
      },
    ];
  });

  if (brokenChains > 0) {
    Sentry.captureMessage(`EAF has ${brokenChains} annotations with unresolvable time references: ${filePath}`, 'warning');
  }

  return segments.sort((a, b) => (a.startMs ?? Number.POSITIVE_INFINITY) - (b.startMs ?? Number.POSITIVE_INFINITY));
};
