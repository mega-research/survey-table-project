import 'server-only';
import { and, asc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets } from '@/db/schema/contacts';
import { collectReferencedContactKeys } from '@/lib/contacts/respondent-pii';
import {
  type FieldworkShare,
  shareTargetCondition,
  withoutShareAttr,
} from '@/server/fieldwork-share-scope';
import { appendContactPii } from '@/server/read-models/respondent-contact-attrs';

import { lookupPriorAnswersByContactTarget } from '@/server/read-models/contact-prior-answers';

/** 관리자 「설문 보기」가 싣는 조사 대상 한 명의 명단 값·이월 응답 */
export interface PreviewContactSeed {
  resid: number;
  isTest: boolean;
  contactAttrs: Record<string, string>;
  priorAnswers: Awaited<ReturnType<typeof lookupPriorAnswersByContactTarget>>;
}

/**
 * 「설문 보기」의 첫 번째 조사 대상 — 그 파티션에서 resid 가 가장 작은 대상의 명단 값과 이월 응답.
 * 대상이 없으면 null 이고 미리보기는 종전처럼 빈 명단 값으로 열린다.
 *
 * 명단 값은 응답자 경로와 같은 규칙으로 만든다 — 개인정보 열은 이 화면이 보는 설문 구조가
 * 토큰·조건으로 읽는 열만 합친다(`collectReferencedContactKeys`). 응답자가 그 대상의 링크로 보는 것과
 * 같은 값이고, 설문이 쓰지 않는 연락처 평문은 RSC props 로 나가지 않는다.
 * 파티션(`isTest`)은 호출부가 콘솔과 같은 `loadOperationsDataScope` 로 정해 넘긴다.
 * `share` 는 열람자의 담당 범위다 — 범위 게스트의 「첫 대상」은 자기 범위 안의 첫 대상이다(남의 범위 대상의
 * 명단 값이 설문 보기로 새지 않게). 관리자·운영 도구는 `FIELDWORK_SHARE_ALL`.
 * `resid` 를 주면 첫 대상 대신 그 대상을 싣는다 — 운영 도구(`pnpm survey:dump --resid`)용이고 화면은 넘기지 않는다.
 */
export async function loadPreviewContactSeed(input: {
  surveyId: string;
  isTest: boolean;
  structure: unknown;
  share: FieldworkShare;
  resid?: number;
}): Promise<PreviewContactSeed | null> {
  const { surveyId, isTest, structure, share, resid } = input;
  const [row] = await db
    .select({ id: contactTargets.id, resid: contactTargets.resid, attrs: contactTargets.attrs })
    .from(contactTargets)
    .where(
      and(
        eq(contactTargets.surveyId, surveyId),
        eq(contactTargets.isTest, isTest),
        shareTargetCondition(share),
        resid === undefined ? undefined : eq(contactTargets.resid, resid),
      ),
    )
    .orderBy(asc(contactTargets.resid))
    .limit(1);
  if (!row) return null;

  const [contactAttrs, priorAnswers] = await Promise.all([
    appendContactPii(
      { ...row, surveyId },
      { allowedKeys: async () => collectReferencedContactKeys(structure) },
    ),
    lookupPriorAnswersByContactTarget({ surveyId, contactTargetId: row.id, isTest }),
  ]);
  // 범위를 가르는 열의 값은 범위 게스트의 화면(RSC props)에 싣지 않는다.
  return { resid: row.resid, isTest, contactAttrs: withoutShareAttr(contactAttrs, share), priorAnswers };
}
