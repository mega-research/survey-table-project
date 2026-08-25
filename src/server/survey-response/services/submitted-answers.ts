import { and, eq, isNotNull, sql } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { contactTargets, questions, surveyVersions, surveys } from '@/db/schema';
import { encryptResponsesForStorage } from '@/lib/crypto/response-pii';
import { logger } from '@/lib/logger';
import { readOptTextsSidecar } from '@/lib/option-text-read';
import { loadCompletedPlainAnswers } from '@/server/read-models/completed-answers';
import { countCell, deriveCategoryIds, findTarget } from '@/lib/quota/matching';
import { normalizeQuotaConfig } from '@/lib/quota/normalize';
import { substituteTokens } from '@/lib/survey/substitute-tokens';

import { SurveyNotAcceptingResponsesError } from './response-gate';

/**
 * 제출된 답변을 저장 가능한 형태로 만드는 단계들 — 유효 질문 선별 · 값 크기 가드 ·
 * 정제 · 미리 채운 값 복원 · PII 암호화 · 쿼터 초과 판정.
 *
 * response.service 에서 갈라져 나왔다 — 그쪽으로 되돌아가는 import 가 없어야 한다(순환 금지).
 */

/**
 * 단일 질문 응답값의 직렬화 바이트 상한.
 * 정상 응답(랭킹/테이블 매트릭스 포함)은 수 KB 수준이므로 256KB 면 충분히 여유롭다.
 * 미인증 응답자가 거대 JSONB 를 주입해 저장소/직렬화 비용을 폭증시키는 것을 차단한다.
 */
export const MAX_ANSWER_VALUE_BYTES = 256 * 1024;

/**
 * #5 변조 가드 1: value 직렬화 바이트 상한. DB 쓰기 이전에 거대 JSONB 주입을 막는다.
 *
 * 판정 기준은 **실제로 저장되는 값**이다(PII 문항이면 암호문). 가드의 목적이 DB 적재 폭탄
 * 방지이므로 적재되는 바이트가 기준이어야 한다 — 평문 단계의 호출은 암호화 비용을 치르기
 * 전에 명백한 초과를 거르는 값싼 사전 필터이지 별개 임계가 아니다. 그래서 PII 문항의 평문
 * 실질 상한은 base64 팽창(약 4/3 배)만큼 낮은 약 191KiB 다.
 *
 * export 이유: 관리자 편집(response-edit.service)이 같은 임계·같은 에러를 써야 한다.
 * 임계 상수를 복제하지 말고 이 함수를 부를 것.
 */
export function assertAnswerValueSize(value: unknown): void {
  const serializedBytes = Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
  if (serializedBytes > MAX_ANSWER_VALUE_BYTES) {
    throw new SurveyNotAcceptingResponsesError('answer_value_too_large');
  }
}

/**
 * assertQuestionBelongsToResponse 의 "집합 반환" 버전.
 *
 * 응답이 가리키는 질문 전체의 id 집합을 단일 쿼리로 수집한다(N+1 금지).
 * - versionId 가 있으면 그 버전 스냅샷(snapshot->'questions')의 모든 elem->>'id' 를 권위 소스로 사용.
 *   non-array 스냅샷은 빈 배열로 폴백.
 * - versionId 가 없으면(레거시/버전 미연결) surveyId 의 라이브 questions 테이블로 폴백.
 *
 * completeResponse 의 JSONB 오염 가드(멤버십 필터)에서 사용한다. updateQuestionResponse 는
 * 단건 검증이라 assertQuestionBelongsToResponse 를 쓰지만, completeResponse 는 여러 키를
 * 한 번에 검증하므로 집합을 1회 로드해 키별로 in-memory 멤버십 검사를 수행한다.
 */
export async function loadValidQuestionIds(
  versionId: string | null,
  surveyId: string,
): Promise<Set<string>> {
  if (versionId) {
    // 버전 스냅샷(snapshot->'questions')의 모든 elem->>'id' 를 단일 쿼리로 수집한다.
    // non-array 스냅샷은 CASE 로 빈 배열 폴백(ERROR 방지). assertQuestionBelongsToResponse
    // 의 EXISTS subquery 와 동일한 jsonb_array_elements 패턴을 집합 추출로 확장한 것.
    const rows = await db.execute<{ id: string | null }>(sql`
      SELECT qe.elem->>'id' AS id
      FROM survey_versions sv,
           jsonb_array_elements(
             CASE WHEN jsonb_typeof(sv.snapshot->'questions') = 'array'
                  THEN sv.snapshot->'questions'
                  ELSE '[]'::jsonb
             END
           ) AS qe(elem)
      WHERE sv.id = ${versionId}
    `);
    const ids = new Set<string>();
    for (const r of rows) {
      if (r.id != null) ids.add(r.id);
    }
    return ids;
  }

  const rows = await db
    .select({ id: questions.id })
    .from(questions)
    .where(eq(questions.surveyId, surveyId));
  return new Set(rows.map((r) => r.id));
}

/**
 * 버전 스냅샷과 현재 questions 플래그의 합집합에서 piiEncrypted=true 인 질문 id 집합을 로드한다.
 *
 * 암호화 판단은 스냅샷 단독이 아니라 스냅샷 ∪ 현재 설정 합집합이다 — 진행 중(이어하기) 세션은
 * 옛 versionId 에 고정되므로, 토글을 새로 켜고 배포해도 그 세션은 여전히 옛 스냅샷을 참조한다.
 * 합집합이면 어느 쪽이든 켜져 있을 때 암호화하므로 과소 암호화(평문 유출) 갭이 사라진다.
 * live-only id(스냅샷엔 없지만 현재 questions 에만 켜진 id)가 집합에 섞여도 무해하다 —
 * completeResponse/saveAdminEdit 는 이 집합을 "제출된 맵의 키 중 암호화 대상"으로만 쓰므로,
 * 애초에 제출 맵에 없는 키는 걸러지지 않는다(과잉 암호화 방향만 허용, 과소 암호화 없음).
 */
export async function loadPiiQuestionIds(
  versionId: string | null,
  surveyId: string,
): Promise<Set<string>> {
  if (versionId) {
    const rows = await db.execute<{ id: string | null }>(sql`
      SELECT qe.elem->>'id' AS id
      FROM survey_versions sv,
           jsonb_array_elements(
             CASE WHEN jsonb_typeof(sv.snapshot->'questions') = 'array'
                  THEN sv.snapshot->'questions'
                  ELSE '[]'::jsonb
             END
           ) AS qe(elem)
      WHERE sv.id = ${versionId}
        AND (qe.elem->>'piiEncrypted')::boolean IS TRUE
      UNION
      SELECT q.id::text AS id
      FROM questions q
      WHERE q.survey_id = ${surveyId}::uuid AND q.pii_encrypted = true
    `);
    const ids = new Set<string>();
    for (const r of rows) {
      if (r.id != null) ids.add(r.id);
    }
    return ids;
  }

  const rows = await db
    .select({ id: questions.id })
    .from(questions)
    .where(and(eq(questions.surveyId, surveyId), eq(questions.piiEncrypted, true)));
  return new Set(rows.map((r) => r.id));
}

/**
 * soft quota 초과 감지 — 완료 직전 셀 충족 여부를 재판정한다 (집행 아님).
 *
 * 게이트 판정(quota.check)과 완료 사이의 race(같은 셀 동시 진행자가 먼저 완료) 또는
 * 게이트 판정이 fail-open 으로 스킵된 완료를 식별한다. 정책(2026-08-11): 완주자는
 * 정상 완료로 수용하고 metadata.quotaOverflow 플래그만 남긴다 — 운영/데이터 처리에서
 * 식별·제외할 수 있게 한다. 카운트 소스는 quota.service.checkQuota 와 동일
 * (완료 응답 로드 후 lib/quota 순수 함수). 판정 실패는 fail-open — 완료를 막지 않는다.
 */
export async function detectQuotaOverflow(
  surveyId: string,
  plainAnswers: Record<string, unknown>,
): Promise<boolean> {
  try {
    const surveyRow = await db.query.surveys.findFirst({
      where: eq(surveys.id, surveyId),
      columns: { quotaConfig: true },
    });
    // JSONB 드리프트 보정 — 소비처(deriveCategoryIds·findTarget·countCell)는
    // dimensions·cells·categories 를 배열로 순회한다.
    const config = normalizeQuotaConfig(surveyRow?.quotaConfig ?? null);
    if (!config?.enabled) return false;

    const categoryIds = deriveCategoryIds(config, plainAnswers);
    if (!categoryIds) return false;
    const target = findTarget(config, categoryIds);
    if (target === null) return false;

    const answersList = await loadCompletedPlainAnswers(surveyId, 'real');
    return countCell(config, categoryIds, answersList) >= target;
  } catch (err) {
    logger.error({ surveyId, err }, '[quota] 완료 시점 초과 감지 실패 — fail-open 통과');
    return false;
  }
}

// 응답 완료 (JSONB + response_answers 이중 쓰기)
// 읽기: response_answers 우선 (getResponsesWithAnswers), JSONB fallback
// JSONB 쓰기는 마이그레이션 완료 + 모든 읽기 경로 전환 후 제거 예정
/** completeResponse 정제 파이프라인이 공유하는 게이트 행 모양. */
export type CompleteGateRow = {
  surveyId: string;
  versionId: string | null;
  contactTargetId: string | null;
  isTest: boolean;
};

/**
 * 정제 (1/3) — 제출 페이로드의 오염 가드.
 *
 * completeResponse 는 data.questionResponses 를 verbatim 저장하므로, 미인증 응답자가
 * (a) 설문에 없는 임의 questionId 수천 개, 또는 (b) 단일 키에 수 MB 값을 주입해 JSONB
 * SSOT 를 오염·팽창시킬 수 있다(response_answers 정규화는 미존재 키를 거르지만 원본
 * JSONB 컬럼은 무방비). 유효 집합에 없는 키와 상한 초과 값을 silent drop 한다
 * (가용성 우선 — throw 아님). 이 필터가 prefill 복원보다 먼저다.
 */
export async function sanitizeSubmittedResponses(
  submitted: Record<string, unknown>,
  gateRow: CompleteGateRow,
): Promise<Record<string, unknown>> {
  const validIds = await loadValidQuestionIds(gateRow.versionId, gateRow.surveyId);
  // 프루닝 스냅샷 가드: 테스트·soft delete 응답은 버전 스냅샷 프루닝을 보호하지
  // 않으므로, 스냅샷이 비워진 버전을 참조하는 응답이 여기 도달할 수 있다. 그 경우
  // validIds 가 빈 집합이 되어 아래 멤버십 필터가 제출 답변 전체를 걸러 {} 를
  // 저장하며 성공으로 보고한다 — 조용한 전량 유실. 빈 집합일 때만 스냅샷 상태를
  // 확인해 유실 대신 명시적 에러로 전환한다. 존재 여부(IS NOT NULL)만으로는 부족하다
  // — non-null 이지만 questions 가 없거나 비배열인 드리프트 스냅샷(이 함수 뒤의
  // Array.isArray 방어가 예견하는 상태)과 항목에 id 가 없는 훼손 배열도 같은 유실을
  // 일으키므로, 빈 집합을 허용하는 유일한 상태는 "검증된 빈 배열(질문 0개 설문)"이다.
  // IS DISTINCT FROM 은 questions 키 부재(jsonb_typeof NULL)를 malformed 로 흡수한다.
  // 응답은 in_progress 로 남고, 에러는 RPC 핸들러의 Sentry 캡처로 보고된다.
  if (gateRow.versionId && validIds.size === 0) {
    const [versionRow] = await db
      .select({
        questionsState: sql<string>`
          CASE
            WHEN ${surveyVersions.snapshot} IS NULL THEN 'missing'
            WHEN jsonb_typeof(${surveyVersions.snapshot}->'questions') IS DISTINCT FROM 'array' THEN 'malformed'
            WHEN jsonb_array_length(${surveyVersions.snapshot}->'questions') > 0 THEN 'ids-unreadable'
            ELSE 'empty'
          END`,
      })
      .from(surveyVersions)
      .where(eq(surveyVersions.id, gateRow.versionId))
      .limit(1);
    if (versionRow?.questionsState !== 'empty') {
      throw new Error('응답 버전의 설문 스냅샷이 유실되어 완료할 수 없습니다.');
    }
  }
  const filtered: Record<string, unknown> = {};
  for (const [qid, value] of Object.entries(submitted)) {
    // 기타 상세 기재 사이드카 — 질문 id 가 아니므로 멤버십 필터 대상이 아니다.
    // 아래에서 별도 정제 후 보존한다 (여기서 drop 하면 제출 순간 기타 텍스트가
    // 조용히 소실된다 — 2026-08-14 프로덕션에서 확인된 실사고).
    if (qid === '__optTexts__') continue;
    // 멤버십 필터: 설문(버전 스냅샷/라이브 questions)에 없는 키는 drop.
    if (!validIds.has(qid)) continue;
    // 바이트 필터: 단일 키 직렬화 256KB 초과면 그 키만 drop.
    const serializedBytes = Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
    if (serializedBytes > MAX_ANSWER_VALUE_BYTES) continue;
    filtered[qid] = value;
  }
  // 사이드카 정제: 형태 검증(readOptTextsSidecar) + 실존 질문 키만 + 바이트 상한.
  const sidecar = readOptTextsSidecar(submitted);
  const keptSidecar: Record<string, Record<string, string>> = {};
  for (const [qid, texts] of Object.entries(sidecar)) {
    if (validIds.has(qid)) keptSidecar[qid] = texts;
  }
  if (Object.keys(keptSidecar).length > 0) {
    const sidecarBytes = Buffer.byteLength(JSON.stringify(keptSidecar), 'utf8');
    if (sidecarBytes <= MAX_ANSWER_VALUE_BYTES) {
      filtered['__optTexts__'] = keptSidecar;
    }
  }
  return filtered;
}

/**
 * 정제 (2/3) — prefill 강제 복원.
 *
 * defaultValueTemplate 이 있는 질문의 응답값은 contact_targets.attrs 로 치환한 expected 와
 * 일치해야 한다. 클라이언트가 disabled 입력을 우회 조작해도 서버가 expected 로 되돌린다.
 * 오염 가드를 통과한 값에만 적용한다 — 원본으로 되돌리면 가드가 무력해진다.
 */
export async function restorePrefillAnswers(
  validated: Record<string, unknown>,
  gateRow: CompleteGateRow,
): Promise<void> {
  // contactTargetId/surveyId 는 gateRow 에서 이미 조회됨 — 중복 select 제거(쿼리 최소화).
  const contactTargetId = gateRow.contactTargetId;

  if (contactTargetId) {
    const [target] = await db
      .select({ attrs: contactTargets.attrs })
      .from(contactTargets)
      .where(eq(contactTargets.id, contactTargetId))
      .limit(1);
    const attrs = (target?.attrs ?? {}) as Record<string, string>;

    const prefillQuestions = await db
      .select({ id: questions.id, template: questions.defaultValueTemplate })
      .from(questions)
      .where(
        and(eq(questions.surveyId, gateRow.surveyId), isNotNull(questions.defaultValueTemplate)),
      );

    // 멤버십/바이트 필터를 통과한 validated 를 기반으로 prefill 복원을 적용한다.
    // (필터 결과를 다시 원본 questionResponses 로 덮어쓰면 오염 가드가 무력화되므로 금지.)
    for (const q of prefillQuestions) {
      if (!q.template?.trim()) continue;
      const expected = substituteTokens(q.template, attrs);
      // 제출된(=필터 통과한) 키만 검증 대상. 조건부로 숨겨져 응답에 포함되지 않은 prefill
      // 질문은 건드리지 않아 미노출 질문에 허위 답변이 주입되지 않도록 한다.
      if (!(q.id in validated)) continue;
      const submitted = validated[q.id];
      // 타입 가드 없이 expected 와 다르면 무조건 강제 복원.
      // 클라이언트가 문자열이 아닌 값(숫자/불리언/배열/객체/null)으로 우회 조작해도
      // expected 문자열과 일치하지 않으므로 서버에서 복원된다.
      if (submitted !== expected) {
        // 조작 의심 — 서버에서 expected 값으로 강제 복원 (silent)
        validated[q.id] = expected;
      }
    }
  }
}

/**
 * 정제 (3/3) — PII 문항 암호화. prefill 복원(평문 비교) 이후, 저장 직전이어야 한다.
 */
export async function encryptPiiAnswers(
  validated: Record<string, unknown>,
  gateRow: CompleteGateRow,
): Promise<Record<string, unknown>> {
  const piiIds = await loadPiiQuestionIds(gateRow.versionId, gateRow.surveyId);
  if (piiIds.size > 0) {
    const encrypted = encryptResponsesForStorage(validated, piiIds);
    // 바이트 필터 2단(저장값 기준): 위쪽 평문 필터를 통과했어도 암호문은 상한을 넘을 수
    // 있다. 크기가 변한 키는 암호화된 것뿐이라 piiIds 만 다시 잰다. 이 경로의 의미론은
    // 이 함수의 다른 오염 가드와 같은 silent drop 이다 — 완주자의 완료 자체는 막지 않는다.
    for (const qid of piiIds) {
      if (!(qid in encrypted)) continue;
      const storedBytes = Buffer.byteLength(JSON.stringify(encrypted[qid] ?? null), 'utf8');
      if (storedBytes > MAX_ANSWER_VALUE_BYTES) delete encrypted[qid];
    }
    return encrypted;
  }

  return validated;
}
