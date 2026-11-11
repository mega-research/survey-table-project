import 'server-only';

import { and, asc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets } from '@/db/schema/contacts';
import { surveys } from '@/db/schema/surveys';
import {
  targetScopeCondition,
  testFlagForScope,
  type OperationsDataScope,
} from '@/server/data-scope';

import { loadSendEmailForTarget } from './send-address';

export interface FirstContactSample {
  /** contact_targets.id */
  id: string;
  attrs: Record<string, string>;
  inviteCode: string;
  /** 발송 주소(email PII 복호화 평문) — 미리보기 표시용. 없으면 null. */
  email: string | null;
  resid: number;
}

interface ContactSampleRow {
  id: string;
  attrs: unknown;
  inviteCode: string;
  resid: number;
}

/**
 * email 복호화 블록 — `getFirstContactSample` / `getContactSampleById` 공유.
 * 한 컨택에 여러 email 컬럼이 있으면 발송 주소 규칙으로 고른다(`loadSendEmailForTarget`) — 순서상
 * 보낼 수 있는 첫 주소이고 반송은 보지 않는다(단건 발송이 쓰는 주소와 같다).
 */
async function withDecryptedEmail(
  row: ContactSampleRow,
  surveyId: string,
  scope: OperationsDataScope,
): Promise<FirstContactSample> {
  const email = await loadSendEmailForTarget({
    id: row.id,
    surveyId,
    isTest: testFlagForScope(scope),
  });

  return {
    id: row.id,
    attrs: row.attrs as Record<string, string>,
    inviteCode: row.inviteCode,
    email,
    resid: row.resid,
  };
}

/**
 * 메일 미리보기용 — `resid ASC` 정렬 첫 컨택 1건.
 * 가장 먼저 업로드된 row 로 미리보기를 채운다.
 * 컨택이 0건이면 null.
 *
 * email 은 contact_pii 사이드 테이블에서 복호화 — 한 컨택에 여러 email 컬럼이 있으면
 * 발송 주소 순서를 따른다.
 */
export async function getFirstContactSample(
  surveyId: string,
  scope: OperationsDataScope,
): Promise<FirstContactSample | null> {
  const [row] = await db
    .select({
      id: contactTargets.id,
      attrs: contactTargets.attrs,
      inviteCode: contactTargets.inviteCode,
      resid: contactTargets.resid,
    })
    .from(contactTargets)
    .where(and(eq(contactTargets.surveyId, surveyId), targetScopeCondition(scope)))
    .orderBy(asc(contactTargets.resid))
    .limit(1);
  if (!row) return null;

  return withDecryptedEmail(row, surveyId, scope);
}

/**
 * 메일 템플릿 미리보기·테스트 발송용 — 설문의 **테스트 모드가 켜져 있을 때** 첫 테스트 조사 대상자
 * (`resid ASC`). 테스트 모드가 꺼져 있거나 테스트 대상자가 없으면 null.
 *
 * 이 브라우저가 실데이터를 보는 중이어도 테스트 파티션에서 읽는다 — 미리보기와 테스트 메일의 초대 링크가
 * 실제 조사 대상의 것이면 눌렀을 때 실제 응답이 생긴다(CONTEXT.md 「테스트 발송」). 테스트 모드가 꺼져
 * 있으면 테스트 대상자 링크가 열리지 않으므로 돌려주지 않는다.
 */
export async function getFirstTestTargetSample(surveyId: string): Promise<FirstContactSample | null> {
  const [survey] = await db
    .select({ testModeEnabled: surveys.testModeEnabled })
    .from(surveys)
    .where(eq(surveys.id, surveyId))
    .limit(1);
  if (!survey?.testModeEnabled) return null;
  return getFirstContactSample(surveyId, 'test');
}

/**
 * 특정 컨택 1건 샘플 — 단건 발송 미리보기용. 스코프 불일치/미존재면 null.
 */
export async function getContactSampleById(
  surveyId: string,
  contactTargetId: string,
  scope: OperationsDataScope,
): Promise<FirstContactSample | null> {
  const [row] = await db
    .select({
      id: contactTargets.id,
      attrs: contactTargets.attrs,
      inviteCode: contactTargets.inviteCode,
      resid: contactTargets.resid,
    })
    .from(contactTargets)
    .where(
      and(
        eq(contactTargets.id, contactTargetId),
        eq(contactTargets.surveyId, surveyId),
        targetScopeCondition(scope),
      ),
    )
    .limit(1);
  if (!row) return null;
  return withDecryptedEmail(row, surveyId, scope);
}
