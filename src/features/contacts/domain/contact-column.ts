import * as z from 'zod';

import type { ContactColumnDef, ContactColumnScheme } from '@/db/schema/schema-types';

export type { ContactColumnDef, ContactColumnScheme };

/** 복잡 JSONB 스킴은 z.custom 으로 타입만 보장(런타임 통과). */
export const ContactColumnSchemeSchema = z.custom<ContactColumnScheme>();

export const UpdateContactColumnsInput = z.object({
  surveyId: z.string(),
  scheme: ContactColumnSchemeSchema,
});
export type UpdateContactColumnsInput = z.infer<typeof UpdateContactColumnsInput>;

export const GetExistingContactsCountInput = z.object({
  surveyId: z.string(),
});
export type GetExistingContactsCountInput = z.infer<typeof GetExistingContactsCountInput>;
