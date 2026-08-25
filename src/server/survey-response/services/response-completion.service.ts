import { and, eq, isNull, sql } from 'drizzle-orm';
import 'server-only';

import { db } from '@/db';
import { contactTargets, surveyResponses } from '@/db/schema';
import {
  decryptQuestionResponses,
  encryptResponsesForStorage,
} from '@/lib/crypto/response-pii';
import { logger } from '@/lib/logger';
import { sumActiveSeconds } from '@/lib/operations/active-seconds';
import { withCalcValues } from '@/lib/survey/cell-formula';
import { stripDisabledCellValues } from '@/lib/survey/cell-gating';
import { notTestResponse } from '@/server/response-filters';
import {
  loadVersionSnapshot,
  snapshotLookups as readSnapshotLookups,
  snapshotQuestions as readSnapshotQuestions,
} from '@/server/read-models/version-snapshot';
import { detectScreenOut } from '../domain/screen-out';
import { responsesToLookupShape } from '@/utils/branch-eval';
import type { PageVisit } from '@/shared/contracts/survey-response';
import type { Question, QuestionGroup, SurveyLookup } from '@/types/survey';

import type { CompleteResponseInput, CompleteResponseResult } from '../domain/response';
import { replaceResponseAnswers } from './response-answers.service';
import {
  assertResponseCompletable,
  loadSurveyGateRow,
  loadVersionGateRow,
  toGateBlockedResult,
} from './response-gate';
import {
  detectQuotaOverflow,
  encryptPiiAnswers,
  loadPiiQuestionIds,
  restorePrefillAnswers,
  sanitizeSubmittedResponses,
} from './submitted-answers';
import { lockAndAssertResponseMutation } from './test-target-attempt.server';

/**
 * 응답 완료 확정 — 게이트 재검증부터 정제·암호화·쿼터 판정·컨택 후처리까지.
 *
 * response.service 에서 갈라져 나왔다. 이 모듈은 그쪽 심볼을 하나도 쓰지 않는다(순환 금지) —
 * 갈라내기 전 실측에서 나가는 의존 0 · 들어오는 참조 0 인 리프였다.
 */

/**
 * surveyId 의 완료 응답 수 (soft-delete 제외, 테스트 모드 응답 제외). complete 시점 정원
 * 하드체크용 — isTest 완료는 통계·쿼터 모수에서 제외되므로(스펙 4절) 정원 카운트에도 포함하지 않는다.
 */
async function countCompletedResponses(surveyId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(surveyResponses)
    .where(
      and(
        eq(surveyResponses.surveyId, surveyId),
        eq(surveyResponses.status, 'completed'),
        isNull(surveyResponses.deletedAt),
        notTestResponse,
      ),
    );
  return row?.total ?? 0;
}

export async function completeResponse(
  input: CompleteResponseInput,
): Promise<CompleteResponseResult> {
  const { responseId, data } = input;

  // 완료 게이트(하드체크): 폐쇄/draft/중단/비공개 설문 완료를 차단하고, maxResponses 정원을
  // 완료 카운트로 하드 검사한다. **마감(endDate)은 보지 않는다** — 마감은 새 응답 접수를 닫는
  // 것이지 이미 진행 중인 응답을 몰수하는 것이 아니라서, 마감 시각에 걸친 응답자는 끝까지
  // 진행해 저장된다(CHECKS_FOR.completeResponse 주석 참조).
  // 그 결과 마감 후 완료 시도가 정원 검사에 처음으로 도달한다 — 정원이 찬 설문이면 사유가
  // end_date_passed 대신 max_responses_reached 로 나온다. 어느 쪽도 차단이다.
  // 위반은 던지지 않고 blocked 로 접어 돌려준다(진입 경로 admitAndCreateResponse 와 같은 규약).
  // 던지면 운영에서 마스킹돼 500 이 되고, 응답자는 설문을 다 채운 뒤 사유를 모른 채
  // 재시도 토스트만 반복해서 본다 — 빠져나갈 길이 없다.
  // 응답 행에서 surveyId/versionId/contactTargetId 를 읽어 게이트 입력으로 사용한다. count
  // 쿼리와 실제 완료 UPDATE 사이의 동시성 갭(동시 완료가 마지막 정원을 함께 채우는 경우)은
  // DB 락 없이 허용하는 잔여 window 다.
  const gateRow = await db.query.surveyResponses.findFirst({
    where: eq(surveyResponses.id, responseId),
    columns: { surveyId: true, versionId: true, contactTargetId: true, isTest: true },
  });
  if (gateRow) {
    const survey = await loadSurveyGateRow(gateRow.surveyId);
    const version = await loadVersionGateRow(gateRow.versionId);
    const completedCount = await countCompletedResponses(gateRow.surveyId);
    try {
      assertResponseCompletable(survey, version, {
        contactTargetId: gateRow.contactTargetId,
        completedCount,
        // 응답 행 자체의 isTest 컬럼이 권위 소스 — create 시점에 확정된 값을 그대로 신뢰한다
        // (여기서 재차 testToken 을 검증하지 않는다. complete 는 responseId 만 받는 pub 엔드포인트).
        isTest: gateRow.isTest,
      });
    } catch (err) {
      // 가용성 사유만 접는다. 변조 가드 등 그 밖의 예외는 toGateBlockedResult 가 null 을
      // 돌려주므로 종전대로 던져 나간다.
      const blocked = toGateBlockedResult(err);
      if (blocked) return blocked;
      throw err;
    }
  }

  // 정제 파이프라인 — 순서가 계약이다. 오염 가드 → prefill 복원 → (calc 재계산) → PII 암호화.
  // 각 단계의 사유는 해당 함수 주석에 있다. #5 변조 가드(updateQuestionResponse 와 대칭).
  let validatedResponses: Record<string, unknown> | undefined = data?.questionResponses;
  if (data?.questionResponses && gateRow) {
    validatedResponses = await sanitizeSubmittedResponses(data.questionResponses, gateRow);
  }

  // 빈 페이로드는 "페이로드 없음" 과 동일하게 취급한다.
  //
  // questionResponses:{} 로 complete 를 부르면 아래 판정·재계산이 모두 "페이로드 경로" 로
  // 흘러 저장된 답변을 재조회하지 않는다. 그 결과 draft/beacon 으로 저장해 둔 자격미달
  // 답변이 판정 대상에서 빠져 completed 로 확정되고, 저장분까지 {} 로 덮인다
  // (적대적 리뷰 지적 — 스펙 §클라이언트 비신뢰 재확정을 우회하는 경로).
  // undefined 로 낮추면 빈 complete 경로가 row lock 아래에서 저장분을 읽어 재계산·판정하는
  // 기존 방어를 그대로 태운다. 멤버십 필터가 전량을 걸러 {} 가 된 경우도 같은 취급이 맞다.
  if (validatedResponses && Object.keys(validatedResponses).length === 0) {
    validatedResponses = undefined;
  }

  if (validatedResponses && gateRow) {
    await restorePrefillAnswers(validatedResponses, gateRow);
  }

  // calc 셀 서버 재계산 (신뢰 경계) — 클라이언트가 주입한 계산값을 그대로 믿지 않고,
  // 응답 시점 버전 스냅샷의 수식으로 다시 계산해 덮어쓴다. 요청 변조나 구버전 클라이언트가
  // 수식과 다른 값을 보내도 최종 저장 데이터(export 원천)는 수식 결과와 일치한다
  // ("수식 결과와 다른 저장값은 존재하지 않는다" — CONTEXT.md 계산 셀 불변식).
  //
  // data 없이 complete 만 호출하는 우회도 막아야 한다: 위조값을 saveDraft/beacon 으로
  // 먼저 저장한 뒤 빈 complete 를 부르면 저장된 JSONB 가 그대로 확정되므로, 스냅샷에
  // calc 셀이 있으면 저장된 응답을 재계산해 덮어쓴다. 이 경로의 읽기·재계산·저장은
  // 아래 트랜잭션 안에서 row lock(FOR UPDATE) 으로 묶는다 — tx 밖에서 읽어 통째로
  // 덮어쓰면 읽기~UPDATE 사이에 도착한 draft 답변이 유실되는 경합이 생긴다.
  //
  // 반드시 PII 암호화 이전 평문 단계에서 수행한다. 스냅샷 미확보(레거시 versionId null,
  // 손상 행)면 스킵 — 응답자 저장을 막지 않는 fail-safe (saveAdminEdit 와 동일 정책).
  // 자격미달 판정(detectScreenOut)이 쓰는 응답 시점 스냅샷 질문. calc/게이팅 재계산이
  // 필요 없는 설문에서도 판정은 해야 하므로 아래 if 블록 밖에서 보관한다.
  let snapshotQuestions: Question[] = [];
  // 자격미달 판정의 표시 조건 평가 재료 — 클라이언트와 같은 컨텍스트를 써야 판정이 갈리지
  // 않는다 (그룹 표시 조건, LUT 우변 비교, 컨택 attrs 참조).
  let snapshotGroups: QuestionGroup[] = [];
  let snapshotLookups: SurveyLookup[] = [];
  let snapshotContactAttrs: Record<string, string | undefined> = {};
  let storedRecalc: {
    questions: Question[];
    lookups: SurveyLookup[];
    contactAttrs: Record<string, string | undefined>;
    piiIds: Set<string>;
  } | null = null;
  if (gateRow?.versionId) {
    // JSONB 스키마 드리프트 방어(비배열 → 빈 배열)는 snapshot* 헬퍼가 맡는다.
    const snap = await loadVersionSnapshot(gateRow.versionId);
    const snapQuestions = readSnapshotQuestions(snap);
    snapshotQuestions = snapQuestions;
    const snapLookups = readSnapshotLookups(snap);
    snapshotLookups = snapLookups;
    snapshotGroups = Array.isArray(snap?.groups) ? (snap.groups as QuestionGroup[]) : [];
    const hasCalcCells = snapQuestions.some((q) =>
      (q.tableRowsData ?? []).some((row) => row.cells.some((c) => c.type === 'calc' && c.formula)),
    );
    const hasGatedCells = snapQuestions.some((q) =>
      (q.tableRowsData ?? []).some((row) => row.cells.some((c) => c.enabledWhen && !c.isHidden)),
    );

    // 게이팅 비활성 셀 값 strip (저장 경계 보증, 스펙 §저장 경계) — 컨트롤러 변경 직후
    // 이탈한 beacon 이 지움 전 값을 실어 보냈어도 확정 데이터에는 남지 않는다.
    // calc 재계산(withCalcValues)보다 먼저 수행해 수식이 지워진 값 기준으로 계산되게 한다.
    if (validatedResponses && hasGatedCells) {
      validatedResponses = stripDisabledCellValues(snapQuestions, validatedResponses);
    }

    // 컨택 attrs 는 calc 수식뿐 아니라 표시 조건 평가(자격미달 판정)에도 쓰이므로,
    // 둘 중 하나라도 필요하면 한 번만 읽어 공유한다.
    const hasDisplayConditions =
      snapQuestions.some((q) => q.displayCondition) ||
      snapshotGroups.some((g) => g.displayCondition);
    if ((hasCalcCells || hasDisplayConditions) && gateRow.contactTargetId) {
      const [target] = await db
        .select({ attrs: contactTargets.attrs })
        .from(contactTargets)
        .where(eq(contactTargets.id, gateRow.contactTargetId))
        .limit(1);
      snapshotContactAttrs = (target?.attrs ?? {}) as Record<string, string | undefined>;
    }

    if (hasCalcCells || hasGatedCells) {
      const calcAttrs = snapshotContactAttrs;
      if (validatedResponses) {
        // 페이로드 경로 — 제출된 전체 응답을 재계산 (tx 밖에서 안전: 컬럼을 페이로드로
        // 교체하는 것이 complete 의 기존 의미라 경합으로 잃을 저장분이 없다).
        // 게이팅만 있는 설문은 위 strip 으로 충분 — calc 셀이 있을 때만 재계산한다.
        if (hasCalcCells) {
          validatedResponses = withCalcValues(validatedResponses, {
            questions: snapQuestions,
            responses: validatedResponses,
            lookups: snapLookups,
            contactAttrs: calcAttrs,
          });
        }
      } else {
        // 빈 complete 경로 — 재계산 재료만 준비하고 실행은 tx 안 row lock 아래로 미룬다.
        storedRecalc = {
          questions: snapQuestions,
          lookups: snapLookups,
          contactAttrs: calcAttrs,
          piiIds: await loadPiiQuestionIds(gateRow.versionId, gateRow.surveyId),
        };
      }
    }
  }

  // soft quota 초과 감지 — 게이트 통과~완료 사이 race 로 셀이 먼저 찬 완료를 식별한다.
  // 쿼터 차원 매칭은 평문 답변 기준이므로 PII 암호화보다 먼저 판정한다.
  // 빈 complete 경로(페이로드 없음)는 생략 — 이 플래그는 통계 식별용이지 집행이 아니고,
  // 해당 경로는 notice-only 등 쿼터 게이트가 없는 흐름이다.
  let quotaOverflow = false;
  if (validatedResponses && gateRow && !gateRow.isTest) {
    quotaOverflow = await detectQuotaOverflow(gateRow.surveyId, validatedResponses);
  }

  // 판정용 표시 조건 평가 컨텍스트. 응답 페이지가 쓰는 것과 같은 재료(스냅샷 그룹·LUT·
  // 컨택 attrs)를 넘겨야 서버 판정이 응답자가 실제로 본 화면과 어긋나지 않는다.
  const buildScreenOutOptions = (judged: Record<string, unknown>) => ({
    groups: snapshotGroups,
    evalCtx: {
      responses: responsesToLookupShape(judged),
      contactAttrs: snapshotContactAttrs,
      lookups: snapshotLookups,
    },
  });

  // 자격미달 판정 — 클라이언트 신고를 신뢰하지 않고 응답 시점 스냅샷의 분기 규칙을
  // 서버가 다시 평가한다 (응답 페이지는 pub 표면). 스냅샷이 없으면(prune·레거시)
  // 판정을 건너뛰어 기존 완료 동작을 유지한다 — 저장을 막지 않는 fail-safe.
  let screenedOut = false;
  if (validatedResponses && snapshotQuestions.length > 0) {
    screenedOut = detectScreenOut(
      snapshotQuestions,
      validatedResponses,
      buildScreenOutOptions(validatedResponses),
    );
  }

  if (validatedResponses && gateRow) {
    validatedResponses = await encryptPiiAnswers(validatedResponses, gateRow);
  }

  const completedAt = new Date();
  const result = await db.transaction(async (tx) => {
    if (gateRow?.isTest) {
      await lockAndAssertResponseMutation(tx, {
        responseId,
        attemptId: input.attemptId,
        sessionId: input.sessionId,
      });
    }
    // 빈 complete 의 calc 재계산 — row lock 을 잡은 뒤 저장분을 읽어 재계산한다.
    // 동시 draft UPDATE 는 이 lock 을 대기하므로 읽기~쓰기 사이 유실 경합이 없다.
    //
    // 빈 complete(payload 없이 responseId 만 호출)는 자격미달 판정도 이 잠금 아래에서
    // 다시 해야 한다 — storedRecalc 는 calc/게이팅 셀이 있는 설문에서만 준비되지만,
    // 그 조건과 무관하게 draft 로 저장해 둔 자격미달 답변이 payload 없는 complete 로
    // 우회 완료될 수 있다(리뷰 지적 — 스펙 §클라이언트 비신뢰 재확정). 판정 재료는
    // 항상 이 잠금 아래에서 확보한다.
    let storedRecalcResponses: Record<string, unknown> | undefined;
    const needsScreenOutLookup = !validatedResponses && snapshotQuestions.length > 0;
    if (storedRecalc || needsScreenOutLookup) {
      const [locked] = await tx
        .select({ questionResponses: surveyResponses.questionResponses })
        .from(surveyResponses)
        .where(eq(surveyResponses.id, responseId))
        .for('update');
      // 수식이 암호화된 숫자 단답을 참조할 수 있으므로 평문화 후 재계산, 저장 직전 재암호화.
      // 분기 매칭도 평문 기준이어야 하므로 자격미달 판정은 이 평문 단계에서 수행한다.
      const plain = decryptQuestionResponses(
        (locked?.questionResponses ?? {}) as Record<string, unknown>,
        { responseId },
      );
      // 판정에 쓸 최종 평문 응답 — calc/게이팅 셀이 있으면 strip+재계산 결과, 없으면
      // 저장된 값 그대로.
      let judgedResponses: Record<string, unknown> = plain;
      if (storedRecalc) {
        // 게이팅 strip → calc 재계산 순서 — 비활성 셀 잔존 값을 지운 뒤 그 기준으로
        // 수식을 계산한다 (스펙 §저장 경계. 빈 complete 우회로 저장된 값도 여기서 봉합).
        const stripped = stripDisabledCellValues(storedRecalc.questions, plain);
        let recomputed = withCalcValues(stripped, {
          questions: storedRecalc.questions,
          responses: stripped,
          lookups: storedRecalc.lookups,
          contactAttrs: storedRecalc.contactAttrs,
        });
        judgedResponses = recomputed;
        // 이 경로에는 크기 가드를 두지 않는다 — 재료가 이미 저장된 행이라 새 주입 표면이
        // 아니고(모든 쓰기 경로가 저장값 기준으로 걸러진 뒤의 값이다), 복호화→재암호화 왕복은
        // 크기를 되돌릴 뿐이다. 여기서 drop 하면 이미 수집된 답변을 완료 시점에 조용히 잃는다.
        if (storedRecalc.piiIds.size > 0) {
          recomputed = encryptResponsesForStorage(recomputed, storedRecalc.piiIds);
        }
        storedRecalcResponses = recomputed;
      }
      if (needsScreenOutLookup) {
        screenedOut = detectScreenOut(
          snapshotQuestions,
          judgedResponses,
          buildScreenOutOptions(judgedResponses),
        );
      }
    }
    // metadata 에 이번 완료로 새로 얹을 키만 모은다 (exposedQuestionIds/exposedRowIds/quotaOverflow).
    // 아래 UPDATE 는 이 값을 객체 리터럴로 통째 대입하지 않고 jsonb `||` 병합으로 반영한다 —
    // 관리자 수정이 남긴 adminEditRollback/migratedFromVersionId, draftSeq 등 기존 키가
    // in_progress 재진입 완료 시 이 UPDATE 에 지워지는 걸 막기 위함 (whole-branch 리뷰 I-1).
    const newMetadataKeys: Record<string, unknown> = {
      ...(data?.exposedQuestionIds ? { exposedQuestionIds: data.exposedQuestionIds } : {}),
      ...(data?.exposedRowIds ? { exposedRowIds: data.exposedRowIds } : {}),
      // soft quota: 초과 완료 식별 플래그 (위 detectQuotaOverflow 판정 결과)
      ...(quotaOverflow ? { quotaOverflow: true } : {}),
    };
    // 1. 기존 JSONB 방식 저장 + 운영 현황 추적 컬럼 갱신
    const [updated] = await tx
      .update(surveyResponses)
      .set({
        // 자격미달은 부적격이라 완료 수(분자)에 들어가면 안 된다 — is_completed 로 갈린다.
        isCompleted: !screenedOut,
        completedAt,
        // 운영 현황 콘솔용 추적 컬럼
        status: screenedOut ? 'screened_out' : 'completed',
        progressPct: 100,
        lastActivityAt: completedAt,
        // 서버 클럭 기준 경과 초 (started_at부터 now()까지)
        totalSeconds: sql`EXTRACT(EPOCH FROM (now() - ${surveyResponses.startedAt}))::int`,
        // 마지막 pageVisits 항목의 leftAt이 NULL이면 now()로 백필
        // (sweep_stale_sessions 함수의 CASE 패턴과 동일)
        pageVisits: sql`CASE
          WHEN jsonb_array_length(COALESCE(${surveyResponses.pageVisits}, '[]'::jsonb)) > 0
           AND (COALESCE(${surveyResponses.pageVisits}, '[]'::jsonb) -> -1 ->> 'leftAt') IS NULL
          THEN jsonb_set(
                 COALESCE(${surveyResponses.pageVisits}, '[]'::jsonb),
                 ARRAY[(jsonb_array_length(COALESCE(${surveyResponses.pageVisits}, '[]'::jsonb)) - 1)::text, 'leftAt'],
                 to_jsonb(now())
               )
          ELSE COALESCE(${surveyResponses.pageVisits}, '[]'::jsonb)
        END`,
        ...(validatedResponses
          ? { questionResponses: validatedResponses }
          : storedRecalcResponses
            ? { questionResponses: storedRecalcResponses }
            : {}),
        ...(Object.keys(newMetadataKeys).length > 0
          ? {
              // 기존 metadata 와 병합 — 객체 리터럴 통째 대입 금지(jsonb 컬럼에
              // JSON.stringify 직접 바인딩도 금지, ::jsonb 텍스트 캐스트만 허용하는 레포 관례).
              metadata: sql`COALESCE(${surveyResponses.metadata}, '{}'::jsonb) || ${JSON.stringify(newMetadataKeys)}::jsonb`,
            }
          : {}),
      })
      // soft-delete(deletedAt) 또는 종결 상태(completed/screened_out/quotaful_out/bad/drop)
      // 행은 완료 처리에서 제외한다. pub 엔드포인트는 responseId 만 있으면 호출 가능하므로,
      // 지연/리플레이된 complete 호출이 삭제된 행을 되살리거나 종결 status 를 덮어쓰지 못하게 막는다.
      .where(
        and(
          eq(surveyResponses.id, responseId),
          isNull(surveyResponses.deletedAt),
          eq(surveyResponses.status, 'in_progress'),
        ),
      )
      .returning();

    let completedResponse = updated;
    let alreadyCompleted = false;
    if (!completedResponse) {
      // 가드에 막혀 0행 — 이미 완료된 같은 응답이면 멱등 재시도로 보고 기존 행을 그대로 반환.
      // (정상 제출 후 네트워크 응답 유실로 인한 사용자 수동 재시도 케이스 보존)
      const [existing] = await tx
        .select()
        .from(surveyResponses)
        .where(eq(surveyResponses.id, responseId))
        .limit(1);
      // 가드는 isCompleted 가 아니라 status 로 종결을 판정한다 — screened_out 행은
      // is_completed=false 인데도 이미 종결 상태라, isCompleted 만 보면 자격미달 응답의
      // 재시도 complete 가 멱등 흡수 대신 에러로 떨어진다(리뷰 지적).
      if (existing && existing.status !== 'in_progress' && existing.deletedAt == null) {
        completedResponse = existing;
        // 이미 종결된 행에 대한 늦은 complete — 다른 화면이 먼저 제출했거나 본인 재시도.
        // 클라이언트가 가짜 감사 화면 대신 "이미 완료된 설문입니다" 안내로 접도록 표식한다.
        alreadyCompleted = true;
      } else {
        // 행이 없거나(삭제/존재 안 함) 종결 상태(screened_out 등)면 완료 처리를 거부한다.
        throw new Error(
          `completeResponse: 완료 처리 불가 행 (responseId=${responseId}, status=${existing?.status ?? 'not_found'}, deleted=${existing?.deletedAt != null})`,
        );
      }
    }

    if (updated) {
      // totalSeconds 정정: pageVisits 활성시간 합으로 덮어쓴다.
      // (UPDATE 1의 벽시계 EXTRACT는 활성 segment가 없을 때의 폴백으로 남는다.)
      // 백필된 updated.pageVisits 기준 — 마지막 leftAt이 now()로 채워진 상태.
      const activeSeconds = sumActiveSeconds(updated.pageVisits as PageVisit[] | null);
      if (activeSeconds !== null) {
        await tx
          .update(surveyResponses)
          .set({ totalSeconds: activeSeconds })
          .where(eq(surveyResponses.id, responseId));
      }

      // 2. response_answers 정규화 저장 (replaceResponseAnswers — saveAdminEdit 과 공유)
      // 빈 complete 의 calc 재계산 경로도 JSONB 와 동일한 맵으로 정규화한다.
      const normalizedSource = validatedResponses ?? storedRecalcResponses;
      if (normalizedSource && Object.keys(normalizedSource).length > 0) {
        await replaceResponseAnswers(tx, responseId, updated.surveyId, normalizedSource);
      }
    }

    // 대상자 테스트 응답만 response 완료와 target 연결을 원자적으로 커밋한다.
    // 테스트 reset/acquire와 같은 survey → target → response 잠금 순서를 보존해야 하므로
    // lockAndAssertResponseMutation에서 target을 먼저 잠근 뒤 여기서 같은 행을 갱신한다.
    if (completedResponse.isTest && completedResponse.contactTargetId) {
      await tx
        .update(contactTargets)
        .set({
          respondedAt: completedAt,
          responseId: completedResponse.id,
          updatedAt: completedAt,
        })
        .where(
          and(
            eq(contactTargets.id, completedResponse.contactTargetId),
            eq(contactTargets.surveyId, completedResponse.surveyId),
          ),
        );
    }

    return alreadyCompleted ? { ...completedResponse, alreadyCompleted: true } : completedResponse;
  });

  // 실제 대상자 연결은 응답 완료 커밋 이후 best-effort로 유지한다. 이를 완료 트랜잭션에
  // 넣으면 response → target 순서가 되어, target → response 순서인 컨택 삭제/hard reset과
  // 교착할 수 있다. 후처리 실패는 이미 커밋된 완료 응답을 rollback하지 않는다.
  if (!result.isTest && result.contactTargetId) {
    try {
      await db
        .update(contactTargets)
        .set({
          respondedAt: completedAt,
          responseId: result.id,
          updatedAt: completedAt,
        })
        .where(
          and(
            eq(contactTargets.id, result.contactTargetId),
            eq(contactTargets.surveyId, result.surveyId),
          ),
        );
    } catch (err) {
      logger.error(
        {
          surveyId: result.surveyId,
          responseId: result.id,
          contactTargetId: result.contactTargetId,
          err,
        },
        '[completeResponse] contact_targets UPDATE 실패 — 응답 완료는 성공',
      );
    }
  }

  // revalidatePath('/analytics') 는 백엔드에서 제거 — 공개 응답이 admin /analytics
  // 캐시를 cross 무효화하던 부분으로, 소비처 통합 단계에서 query invalidation 등으로 보강.
  return result;
}
