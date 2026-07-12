/**
 * Typed request schemas for admin ReadingSeries curation routes (#1015).
 */

import {
  array,
  boolean,
  nonEmptyString,
  object,
  oneOf,
  optional,
  string,
  type Schema,
} from "@/lib/validation";
import { SERIES_STATUSES, type SeriesStatus } from "@/lib/engagement/series";

type InferSchema<S extends Schema<unknown>> = S extends Schema<infer T> ? T : never;

const optionalDescription = optional(string({ max: 2000 }));
const optionalTopic = optional(string({ max: 120 }));
const optionalLevel = optional(string({ max: 16 }));
const optionalArticleIds = optional(array(nonEmptyString(200), { max: 500 }));
const optionalStatus = optional(oneOf<SeriesStatus>(SERIES_STATUSES));

export const createSeriesBody = object({
  slug: nonEmptyString(120),
  title: nonEmptyString(200),
  description: optionalDescription,
  topic: optionalTopic,
  targetLevelMin: optionalLevel,
  targetLevelMax: optionalLevel,
  articleIds: optionalArticleIds,
  public: optional(boolean()),
  status: optionalStatus,
});

export type CreateSeriesBody = InferSchema<typeof createSeriesBody>;

export const updateSeriesBody = object({
  slug: optional(nonEmptyString(120)),
  title: optional(nonEmptyString(200)),
  description: optionalDescription,
  topic: optionalTopic,
  targetLevelMin: optionalLevel,
  targetLevelMax: optionalLevel,
  articleIds: optionalArticleIds,
  public: optional(boolean()),
  status: optionalStatus,
});

export type UpdateSeriesBody = InferSchema<typeof updateSeriesBody>;

export const reorderSeriesBody = object({
  articleIds: array(nonEmptyString(200), { max: 500 }),
});

export type ReorderSeriesBody = InferSchema<typeof reorderSeriesBody>;
