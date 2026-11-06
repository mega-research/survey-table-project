import 'server-only';

import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { contactPriorAnswers, contactTargets } from '@/db/schema/contacts';
import { decryptQuestionResponses } from '@/lib/crypto/response-pii';
import { isPiiRedactedValue } from '@/lib/survey/pii-retention';
import { normalizePriorAnswers } from '@/lib/survey/prior-answers';
import { isValidUUID } from '@/lib/utils';
import type { PriorAnswersOutput } from '@/shared/contracts/contacts-io';

/*
 * 이월 응답 읽기 — 조사 대상 도메인(초대 토큰 경로·Raw 내보내기)과 관리자 화면(응답 편집 ·
 * 「설문 보기」 · 빌더 미리보기)이 함께 읽는다. 빌더(survey-builder)가 contacts 서비스를 부를 수 없어
 * 읽기 경계를 이 read-model 이 소유한다 — 복호화·파기 표식 제거가 갈리지 않게 한 곳에 둔다.
 */

/**
 * 이월 응답 JSONB 한 벌의 읽기 경계 — 복호화 + 파기 표식 제거.
 *
 * 조회 경로가 둘(초대 토큰 · 조사 대상 id)이라 후처리를 한 곳에 둔다. 갈라지면 관리자
 * 편집 화면에만 암호문이나 파기 표식이 그대로 채워진다.
 */
export function readPriorAnswerRow(raw: unknown): PriorAnswersOutput {
  const answers = normalizePriorAnswers(raw);
  if (Object.keys(answers).length === 0) return null;
  // 응답 PII 인라인 암호화(ADR-0012)와 같은 읽기 경계를 태운다. 이월 응답은 응답 저장
  // 형태와 동형이므로 PII 문항 값이 암호문('v1:...')으로 적재될 수 있고, 그대로 내보내면
  // 응답 화면에 암호문이 그대로 채워진다. 접두사 감지식이라 평문은 그대로 통과한다.
  const decrypted = decryptQuestionResponses(answers);

  // 보관기한 파기 표식은 값이 아니라 "값이 사라졌다" 는 기록이다. 그대로 내보내면
  // 잠긴 입력에 표식이 채워지고 변동 확인까지 붙어, "같음" 이 그 표식을 올해 응답으로
  // 복사한다. 파기된 문항은 이월 값이 없는 것으로 본다.
  const kept: Record<string, unknown> = {};
  for (const [questionId, value] of Object.entries(decrypted)) {
    if (isPiiRedactedValue(value)) continue;
    kept[questionId] = value;
  }
  return Object.keys(kept).length > 0 ? kept : null;
}

/**
 * 조사 대상 id 로 이월 응답 조회 — 관리자 화면(응답 편집 · 「설문 보기」 · 빌더 미리보기) 전용.
 *
 * 초대 토큰 경로(`lookupPriorAnswers`)를 쓸 수 없다. 관리자 편집은 초대 링크로 들어오지
 * 않아 토큰을 손에 쥐고 있지 않고, 응답 행이 들고 있는 것은 `contactTargetId` 뿐이다.
 *
 * **RSC 가 직접 부른다**(procedure 없음). 호출부는 이미 `requireSurveyOwnership` 를 통과한
 * 관리자 화면이고, 파티션(`isTest`)도 그쪽이 결정해 넘긴다 — 콘솔의 스코프 판정을 이
 * 서비스가 다시 하면 결정 지점이 둘로 갈린다.
 *
 * 관리자 편집에서는 이월 표시(빨강)에만 쓰이고 프리필도 변동 확인도 걸리지 않는다. 「설문 보기」·빌더
 * 미리보기는 응답 화면처럼 프리필한다(저장하지 않는 화면이다).
 */
export async function lookupPriorAnswersByContactTarget(args: {
  surveyId: string;
  contactTargetId: string;
  isTest: boolean;
}): Promise<PriorAnswersOutput> {
  const { surveyId, contactTargetId, isTest } = args;
  if (!isValidUUID(surveyId)) return null;

  const [row] = await db
    .select({ answers: contactPriorAnswers.answers })
    .from(contactPriorAnswers)
    .innerJoin(contactTargets, eq(contactPriorAnswers.contactTargetId, contactTargets.id))
    .where(
      and(
        eq(contactPriorAnswers.contactTargetId, contactTargetId),
        eq(contactTargets.surveyId, surveyId),
        eq(contactTargets.isTest, isTest),
      ),
    )
    .limit(1);

  if (!row) return null;
  return readPriorAnswerRow(row.answers);
}
