import { cache } from 'react';

import { eq } from 'drizzle-orm';
import 'server-only';

import { getSurveyById } from '@/server/read-models/survey-structure';
import { db } from '@/db';
import { canExposeToRespondent } from '@/lib/contacts/respondent-visible-pii';
import { contactTargets } from '@/db/schema/contacts';
import type { VariableDef } from '@/shared/contracts/template-variables';

export const getVariableCatalog = cache(
  async (surveyId: string, options?: { purpose?: 'mail' | 'survey' }): Promise<VariableDef[]> => {
    const purpose = options?.purpose ?? 'mail';

    const system: VariableDef[] =
      purpose === 'mail'
        ? [
            {
              key: 'invite_link',
              label: '응답 페이지 링크',
              category: 'system',
              description: '조사 대상별 inviteToken 으로 자동 빌드',
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

    // 설문 프리필 토큰은 「응답 화면에 노출」을 켠 개인정보 열도 읽는다(응답 화면이 attrs 에 합친다).
    // 메일 본문은 합치지 않으므로 survey 목적에만 싣는다.
    const exposedPii: VariableDef[] =
      purpose === 'survey'
        ? (survey?.contactColumns?.columns ?? [])
            .filter((c) => c.respondentVisible === true && canExposeToRespondent(c))
            .map((c) => ({
              key: c.source.slice('pii.'.length),
              label: c.label,
              category: 'attrs' as const,
              description: '개인정보 열 — 응답 화면에 노출',
            }))
        : [];

    return [...attrsKeys, ...exposedPii, ...system];
  },
);
