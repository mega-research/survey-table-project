import { NextRequest, NextResponse } from 'next/server';

import { and, count, eq } from 'drizzle-orm';

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
import { generateRawDataWorkbook, toSpssColumnOptions } from '@/lib/analytics/raw-workbook';
import { applyExportRowExclusions } from '@/lib/analytics/export-exclusions';
import {
  MAX_EXPORT_RESPONSES,
  buildRawExportContext,
  loadRawExportRows,
  type RawExportLoadResult,
} from '@/lib/analytics/raw-export-rows.server';
import { buildSplitWorkbook } from '@/lib/analytics/split-workbook';
import { planSplit } from '@/lib/analytics/split-export';
import { loadChangeConfirmQuestionIds } from '@/features/contacts/server/services/contact-prior-answers.service';
import { hydrateQuestionsForSpss } from '@/lib/spss/hydrate-questions';
import { isSpssVarNameError } from '@/lib/spss/variable-name-guard';
import { SurveySubmission } from '@/types/survey';

// Vercel serverless 최대 실행시간 30초 (기본 10초)
export const maxDuration = 30;

const ALLOWED_EXPORT_TYPES = ['sav', 'raw', 'raw-split', 'sps'] as const;
type ExportType = (typeof ALLOWED_EXPORT_TYPES)[number];

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * raw/raw-split 한도 초과 응답 — 토글이 켜졌으면 응답 수와 미응답 조사 대상 수를 따로 보여
 * 어느 쪽을 줄여야 하는지 알 수 있게 한다. 꺼진 경로의 문구는 도입 전 그대로다.
 */
function tooManyRowsResponse(
  result: Extract<RawExportLoadResult, { kind: 'too_many' }>,
  includeNonRespondents: boolean,
) {
  const limit = MAX_EXPORT_RESPONSES.toLocaleString();
  const error = includeNonRespondents
    ? `응답 ${result.responseCount.toLocaleString()}건과 미응답 조사 대상 ${result.nonRespondentCount.toLocaleString()}명을 합쳐 ${limit}행을 초과하여 내보내기할 수 없습니다.`
    : `응답이 ${limit}건을 초과하여 내보내기할 수 없습니다.`;
  return NextResponse.json({ error }, { status: 413 });
}

async function handleExport(
  request: NextRequest,
  ctx: RouteLogContext,
  { params }: { params: Promise<{ surveyId: string }> },
) {
  try {
    // 인증 + 게스트 설문 스코프 가드. oRPC authed 미들웨어와 동일한 canAccessSurvey 를
    // 적용해, ADMIN_USER_IDS 로 어드민을 잠갔을 때 이 REST 라우트가 형제 우회 경로가
    // 되지 않도록 한다(게스트는 grant 된 설문만, 그 외 임의 인증사용자는 전체 차단).
    const user = await requireAuth();
    const { surveyId } = await params;
    // 다운로드 발생 사실 자체를 access 로그에 남긴다 — 법정 감사기록(접속기록)과는
    // 별개의 운영 기록. 로그에는 쿼리 파라미터·행수만 싣는다 (응답 본문 금지).
    ctx.bind({
      userId: user.id,
      role: isGuestUser(user.id) ? 'guest' : 'admin',
      surveyId,
    });
    if (!canAccessSurvey(user.id, surveyId)) {
      return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
    }

    const type = request.nextUrl.searchParams.get('type') as ExportType | null;
    if (type) ctx.bind({ exportType: type });

    if (!type || !ALLOWED_EXPORT_TYPES.includes(type)) {
      return NextResponse.json({ error: '지원하지 않는 내보내기 형식입니다.' }, { status: 400 });
    }

    // 「조사 대상 중 미응답자 포함」 — Raw Data 계열(raw/raw-split)만 읽는다.
    // .sav/.sps 는 완료 전용 분석 모수라 이 파라미터와 무관하다.
    const includeNonRespondents =
      request.nextUrl.searchParams.get('includeNonRespondents') === '1';
    ctx.bind({ includeNonRespondents });

    // 1. 설문 데이터 조회
    // questions 는 반드시 order 오름차순으로 조회한다. orderBy 가 없으면 drizzle relational
    // query 가 ORDER BY 를 넣지 않아 Postgres 힙(물리) 순서를 따르고, 그 결과 SPSS/Raw
    // 변수 순서가 문항 순서와 어긋나며 편집할 때마다 흔들린다.
    const surveyData = await db.query.surveys.findFirst({
      where: eq(surveys.id, surveyId),
      with: { questions: { orderBy: (q, { asc }) => [asc(q.order)] } },
    });

    if (!surveyData) {
      return NextResponse.json({ error: 'Survey not found' }, { status: 404 });
    }

    // 운영 콘솔과 같은 파티션 규칙 — 테스트 모드면 테스트 응답만, 아니면 실 응답만 내려간다
    // (게스트는 항상 실). 테스트 검수용 다운로드에 실 응답이 섞이는 것과 그 반대를 함께 막는다.
    const scope = await loadOperationsDataScope(surveyId);
    ctx.bind({ scope });

    // strip된 셀/옵션 파생 필드 hydrate (cellCode, exportLabel, optionCode 복원)
    // 이후 일회성 export 행 제외 적용 — 등재된 설문 외에는 원본 그대로 통과
    const hydratedQuestions = applyExportRowExclusions(
      surveyId,
      hydrateQuestionsForSpss(normalizeQuestions(surveyData.questions)),
    );

    // 2. 응답 데이터 조회 (sav 전용 공용 블록)
    // raw/raw-split는 자체 모수와 가드를 별도로 가지므로 이 블록을 건너뛴다.
    let responses: typeof surveyResponses.$inferSelect[] = [];

    if (type !== 'raw' && type !== 'raw-split' && type !== 'sps') {
      const totalRows = await db
        .select({ total: count() })
        .from(surveyResponses)
        .where(
          and(
            eq(surveyResponses.surveyId, surveyId),
            notDeletedResponse,
            completedResponse,
            responseScopeCondition(scope),
          ),
        );
      const total = totalRows[0]?.total ?? 0;

      if (total > MAX_EXPORT_RESPONSES) {
        return NextResponse.json(
          { error: `응답이 ${MAX_EXPORT_RESPONSES.toLocaleString()}건을 초과하여 내보내기할 수 없습니다. (현재 ${total.toLocaleString()}건)` },
          { status: 413 },
        );
      }

      const rawFetched = await db.query.surveyResponses.findMany({
        where: and(
          eq(surveyResponses.surveyId, surveyId),
          notDeletedResponse,
          completedResponse,
          responseScopeCondition(scope),
        ),
        orderBy: (responses, { desc }) => [desc(responses.createdAt)],
      });
      responses = rawFetched.map((r) => ({
        ...r,
        questionResponses: decryptQuestionResponses(
          (r.questionResponses ?? {}) as Record<string, unknown>,
          { responseId: r.id },
        ),
      }));
      ctx.bind({ rowCount: responses.length });
    }

    const dateSlice = new Date().toISOString().slice(0, 10);
    const safeTitle = encodeURIComponent(surveyData.title);

    // 3-0. SPSS 보조 문법 .sps 파일 (표시 형식 FORMATS + 복수응답 세트 MRSETS - .sav 보조 파일)
    if (type === 'sps') {
      const { generateSPSSColumns } = await import('@/lib/analytics/spss-excel-export');
      const { generateMrsetsSyntax } = await import('@/lib/spss/mrsets-syntax');
      // 변동 확인 변수는 MRSETS·FORMATS 대상이 아니지만, 같은 설문의 변수 집합이
      // 내보내기 형식마다 갈리지 않도록 여기서도 같은 옵션으로 만든다.
      // 파티션은 다른 내보내기 형식과 동일하게 현재 스코프를 따른다.
      const changeConfirmQuestionIds = await loadChangeConfirmQuestionIds(surveyId, {
        isTest: testFlagForScope(scope),
      });
      const syntax = generateMrsetsSyntax(
        generateSPSSColumns(hydratedQuestions, { changeConfirmQuestionIds }),
        hydratedQuestions,
      );
      if (syntax === null) {
        return NextResponse.json(
          {
            error:
              '복수응답(checkbox) 변수와 숫자 표시 형식 설정이 없어 .sps 문법을 생성할 항목이 없습니다.',
          },
          { status: 400 },
        );
      }
      return new NextResponse(syntax, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="${safeTitle}_SPSS_SYNTAX_${dateSlice}.sps"`,
        },
      });
    }

    // 3. Raw Data xlsx
    if (type === 'raw') {
      const loaded = await loadRawExportRows(surveyId, scope, { includeNonRespondents });
      if (loaded.kind === 'too_many') return tooManyRowsResponse(loaded, includeNonRespondents);
      const { rows } = loaded;
      ctx.bind({ rowCount: rows.length, nonRespondentCount: loaded.nonRespondentCount });
      const exportCtx = await buildRawExportContext(surveyId, scope, surveyData.questions);
      const workbook = generateRawDataWorkbook(hydratedQuestions, rows, exportCtx);
      // exceljs 워크북 — 셀 스타일(헤더 색상/병합) 지원을 위해 XLSX 대신 사용.
      const buffer = await workbook.xlsx.writeBuffer();
      const filename = `${safeTitle}_RawData_${dateSlice}.xlsx`;
      return new NextResponse(buffer as ArrayBuffer, {
        headers: {
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Type': XLSX_MIME,
        },
      });
    }

    // 3-b. Raw Split Data xlsx
    if (type === 'raw-split') {
      const basis = request.nextUrl.searchParams.get('basis');
      if (!basis) {
        return NextResponse.json({ error: '분할 기준 문항이 필요합니다.' }, { status: 400 });
      }
      ctx.bind({ basis });

      const basisQuestion = hydratedQuestions.find((q) => q.id === basis);
      if (!basisQuestion) {
        return NextResponse.json({ error: '유효하지 않은 분할 기준 문항입니다.' }, { status: 400 });
      }

      const loaded = await loadRawExportRows(surveyId, scope, { includeNonRespondents });
      if (loaded.kind === 'too_many') return tooManyRowsResponse(loaded, includeNonRespondents);
      const { rows } = loaded;

      const exportCtx = await buildRawExportContext(surveyId, scope, surveyData.questions);
      // 한계 판정은 실제 워크북과 같은 변수 집합으로 해야 한다 — 변동 확인 변수를 빼고
      // 세면 통과했다가 워크북 생성에서 열 한계를 넘는다.
      const plan = planSplit(hydratedQuestions, basis, {}, toSpssColumnOptions(exportCtx));
      if (plan.exceedsExcelLimit) {
        return NextResponse.json(
          { error: '선택한 기준으로는 일부 시트가 Excel 열 한계를 초과합니다. 다른 기준을 선택해 주세요.' },
          { status: 413 },
        );
      }

      ctx.bind({ rowCount: rows.length, nonRespondentCount: loaded.nonRespondentCount });
      const workbook = buildSplitWorkbook(hydratedQuestions, rows, basis, exportCtx);
      const buffer = await workbook.xlsx.writeBuffer();
      const basisCode = basisQuestion.questionCode ?? 'split';
      // Content-Disposition 헤더는 ByteString만 허용 → 한글 리터럴/코드는 퍼센트 인코딩.
      // (모달이 파일명을 decodeURIComponent로 복원하므로 다운로드 시 한글로 표시됨)
      const filename = `${safeTitle}_${encodeURIComponent('분할')}_${encodeURIComponent(basisCode)}_${dateSlice}.xlsx`;
      return new NextResponse(buffer as ArrayBuffer, {
        headers: {
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Type': XLSX_MIME,
        },
      });
    }

    // 4. SPSS .sav는 별도 바이너리 응답
    if (type === 'sav') {
      const { generateSavBuffer } = await import('@/lib/spss/sav-builder');
      // 추적조사 변동 확인 변수 — .sav 모수와 같은 스코프 파티션의 이월 응답을 본다.
      const changeConfirmQuestionIds = await loadChangeConfirmQuestionIds(surveyId, {
        isTest: testFlagForScope(scope),
      });
      const savBuffer = await generateSavBuffer(
        hydratedQuestions,
        responses as unknown as SurveySubmission[],
        { changeConfirmQuestionIds },
      );
      return new NextResponse(new Uint8Array(savBuffer), {
        headers: {
          'Content-Disposition': `attachment; filename="${safeTitle}_SPSS_${dateSlice}.sav"`,
          'Content-Type': 'application/octet-stream',
        },
      });
    }

    // 도달 불가: ALLOWED_EXPORT_TYPES(sav/raw/raw-split/sps)는 위에서 모두 처리됨
    return NextResponse.json({ error: '지원하지 않는 내보내기 형식입니다.' }, { status: 400 });
  } catch (error) {
    if (error instanceof Error && error.message === '인증이 필요합니다.') {
      return NextResponse.json({ error: '권한 없음' }, { status: 401 });
    }
    // instanceof 금지: sav-builder가 동적 import라 dev HMR/이중 그래프에서
    // 클래스 identity가 어긋나 분기를 놓치고 500으로 빠진다. 구조 판별 사용.
    if (isSpssVarNameError(error)) {
      return NextResponse.json(
        { error: error.message, issues: error.issues },
        { status: 400 },
      );
    }
    // 그 외 예기치 못한 에러는 로깅 래퍼가 err 기록 + 500 응답으로 처리한다.
    throw error;
  }
}

export const GET = withRouteLogging('/api/surveys/[surveyId]/export', handleExport, {
  errorMessage: '데이터 내보내기 중 오류가 발생했습니다.',
});
