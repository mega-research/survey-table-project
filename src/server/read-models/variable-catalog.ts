import { cache } from 'react';

import { eq } from 'drizzle-orm';
import 'server-only';

import { getSurveyById } from '@/server/read-models/survey-structure';
import { db } from '@/db';
import { piiKeyOf } from '@/lib/operations/contacts-format';
import { contactTargets } from '@/db/schema/contacts';
import { surveys } from '@/db/schema/surveys';
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

    // 설문 토큰은 개인정보로 암호화된 열도 읽는다(응답 화면이 명단 값에 합친다 —
    // read-models/respondent-contact-attrs). 메일 본문은 합치지 않으므로 survey 목적에만 싣는다.
    // 빌더는 파티션을 가리지 않으므로 실·테스트 스킴의 개인정보 열을 함께 싣는다.
    let piiKeys: VariableDef[] = [];
    if (purpose === 'survey') {
      const [schemes] = await db
        .select({ test: surveys.testContactColumns })
        .from(surveys)
        .where(eq(surveys.id, surveyId))
        .limit(1);
      const byKey = new Map<string, VariableDef>();
      for (const c of [
        ...(survey?.contactColumns?.columns ?? []),
        ...(schemes?.test?.columns ?? []),
      ]) {
        const key = piiKeyOf(c.source);
        if (key == null || attrsKeys.some((v) => v.key === key) || byKey.has(key)) continue;
        byKey.set(key, { key, label: c.label, category: 'attrs', description: '개인정보 열' });
      }
      piiKeys = [...byKey.values()];
    }

    return [...attrsKeys, ...piiKeys, ...system];
  },
);
