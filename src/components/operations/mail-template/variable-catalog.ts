import 'server-only';

import { eq } from 'drizzle-orm';
import { cache } from 'react';

import { getSurveyById } from '@/data/surveys';
import { db } from '@/db';
import { contactTargets } from '@/db/schema/contacts';

export interface VariableDef {
  key: string;
  label: string;
  category: 'attrs' | 'system';
  description?: string;
}

export const getVariableCatalog = cache(
  async (
    surveyId: string,
    options?: { purpose?: 'mail' | 'survey' },
  ): Promise<VariableDef[]> => {
    const purpose = options?.purpose ?? 'mail';

    const system: VariableDef[] =
      purpose === 'mail'
        ? [
            {
              key: 'invite_link',
              label: '응답 페이지 링크',
              category: 'system',
              description: '컨택별 inviteToken 으로 자동 빌드',
            },
          ]
        : [];

    const survey = await getSurveyById(surveyId);
    let attrsKeys: VariableDef[] = [];
    if (survey?.contactColumns?.columns) {
      attrsKeys = survey.contactColumns.columns
        .filter((c) => c.source.startsWith('attrs.'))
        .map((c) => ({
          key: c.source.slice(6),
          label: c.label,
          category: 'attrs' as const,
        }));
    }

    if (attrsKeys.length === 0) {
      const [sample] = await db
        .select({ attrs: contactTargets.attrs })
        .from(contactTargets)
        .where(eq(contactTargets.surveyId, surveyId))
        .limit(1);
      if (sample) {
        attrsKeys = Object.keys(sample.attrs).map((k) => ({
          key: k,
          label: k,
          category: 'attrs' as const,
        }));
      }
    }

    return [...attrsKeys, ...system];
  },
);
