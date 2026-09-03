import { NextRequest, NextResponse } from 'next/server';

import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { surveyResponses, surveys } from '@/db/schema';
import { completedResponse, notDeletedResponse } from '@/data/response-filters';
import {
  loadOperationsDataScope,
  responseScopeCondition,
  testFlagForScope,
} from '@/lib/operations/data-scope.server';
import { decryptQuestionResponses } from '@/lib/crypto/response-pii';
import { normalizeQuestions } from '@/lib/question';
import { requireAuth } from '@/lib/auth';
import { canAccessSurvey, isGuestUser } from '@/lib/auth/guest-grants';
import { withRouteLogging, type RouteLogContext } from '@/lib/logger';
import {
  detectSplitCandidates,
  planSplit,
  SPLIT_SOFT_LIMIT,
  SPLIT_EXCEL_LIMIT,
} from '@/lib/analytics/split-export';
import { applyExportRowExclusions } from '@/lib/analytics/export-exclusions';
import { countRawExportPopulation } from '@/lib/analytics/raw-export-rows.server';
import { generateSPSSColumns } from '@/lib/analytics/spss-excel-export';
import { getSurveyContactStats } from '@/lib/operations/contact-stats.server';
import { loadChangeConfirmQuestionIds } from '@/features/contacts/server/services/contact-prior-answers.service';
import { hydrateQuestionsForSpss } from '@/lib/spss/hydrate-questions';

export const maxDuration = 30;

async function handleSplitPreview(
  request: NextRequest,
  ctx: RouteLogContext,
  { params }: { params: Promise<{ surveyId: string }> },
) {
  try {
    // 인증 + 게스트 설문 스코프 가드(export/route.ts 와 동일 정책). 설문 구조·응답 집계를
    // 노출하므로 게스트는 grant 된 설문만, 그 외 임의 인증사용자는 형제 우회를 차단한다.
    const user = await requireAuth();
    const { surveyId } = await params;
    ctx.bind({
      userId: user.id,
      role: isGuestUser(user.id) ? 'guest' : 'admin',
      surveyId,
    });
    if (!canAccessSurvey(user.id, surveyId)) {
      return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
    }
    const basis = request.nextUrl.searchParams.get('basis');
    if (basis) ctx.bind({ basis });
    // 「조사 대상 중 미응답자 포함」 — export 라우트와 같은 파라미터. 켜졌을 때만 모수 count 를 더한다.
    const includeNonRespondents =
      request.nextUrl.searchParams.get('includeNonRespondents') === '1';
    if (includeNonRespondents) ctx.bind({ includeNonRespondents });

    // questions 는 order 오름차순 고정 (export/route.ts 와 동일 — 변수 순서를 문항 순서에 고정).
    const surveyData = await db.query.surveys.findFirst({
      where: eq(surveys.id, surveyId),
      with: { questions: { orderBy: (q, { asc }) => [asc(q.order)] } },
    });
    if (!surveyData) return NextResponse.json({ error: 'Survey not found' }, { status: 404 });

    // 셀/옵션 코드 hydrate (export/route.ts와 공용 헬퍼) + 일회성 export 행 제외 적용
    const questions = applyExportRowExclusions(
      surveyId,
      hydrateQuestionsForSpss(normalizeQuestions(surveyData.questions)),
    );

    // 운영 콘솔·export 와 같은 파티션 규칙 — 응답 모수와 변동 확인 변수가 같은 스코프를 본다.
    const scope = await loadOperationsDataScope(surveyId);

    // 미리보기의 변수 수는 실제 워크북과 같은 집합이어야 한다 — 추적조사 변동 확인 변수 포함.
    const changeConfirmQuestionIds = await loadChangeConfirmQuestionIds(surveyId, {
      isTest: testFlagForScope(scope),
    });

    if (!basis) {
      const totalVars = generateSPSSColumns(
        [...questions].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
        { changeConfirmQuestionIds },
      ).length;
      // 다이얼로그가 「조사 대상 중 미응답자 포함」 영역을 그릴지 정하는 근거 —
      // 조사 대상이 없는 설문(hasContacts=false)에서는 영역 자체가 없다.
      const { hasContacts } = await getSurveyContactStats(surveyId, scope);
      return NextResponse.json({
        totalVars,
        softLimit: SPLIT_SOFT_LIMIT,
        excelLimit: SPLIT_EXCEL_LIMIT,
        candidates: detectSplitCandidates(questions),
        hasContacts,
      });
    }

    // resp 집계: raw export와 동일 모수 (deleted 제외 + completed만 + 현재 스코프 파티션만)
    const rawResponses = await db.query.surveyResponses.findMany({
      where: and(
        eq(surveyResponses.surveyId, surveyId),
        notDeletedResponse,
        completedResponse,
        responseScopeCondition(scope),
      ),
      columns: { id: true, questionResponses: true },
    });
    const responses = rawResponses.map((r) => ({
      ...r,
      questionResponses: decryptQuestionResponses(
        (r.questionResponses ?? {}) as Record<string, unknown>,
        { responseId: r.id },
      ),
    }));
    const respCounts: Record<string, number> = {};
    for (const r of responses) {
      const ans = (r.questionResponses as Record<string, unknown> | null)?.[basis];
      const vals = Array.isArray(ans) ? ans : ans != null ? [ans] : [];
      for (const v of new Set(vals.map((x) => String(x)))) {
        respCounts[v] = (respCounts[v] ?? 0) + 1;
      }
    }

    const plan = planSplit(questions, basis, respCounts, { changeConfirmQuestionIds });
    if (!includeNonRespondents) return NextResponse.json({ plan });

    // 켜졌을 때만 모수 count 를 더한다 — 꺼진 경로의 쿼리 수를 늘리지 않기 위해서다.
    // respCounts 는 손대지 않는다: 미응답 행은 기준 문항 값이 없어 어느 버킷에도 안 들어간다.
    const { responseCount, nonRespondentCount } = await countRawExportPopulation(
      surveyId,
      scope,
      { includeNonRespondents: true },
    );
    return NextResponse.json({
      plan,
      totalRows: responseCount + nonRespondentCount,
      nonRespondentRows: nonRespondentCount,
    });
  } catch (error) {
    if (error instanceof Error && error.message === '인증이 필요합니다.') {
      return NextResponse.json({ error: '권한 없음' }, { status: 401 });
    }
    // 그 외 예기치 못한 에러는 로깅 래퍼가 err 기록 + 500 응답으로 처리한다.
    throw error;
  }
}

export const GET = withRouteLogging(
  '/api/surveys/[surveyId]/export/split-preview',
  handleSplitPreview,
  { errorMessage: '미리보기 생성 중 오류가 발생했습니다.' },
);
