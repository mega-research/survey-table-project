import { NextRequest, NextResponse } from 'next/server';

import { and, count, eq, inArray } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets, surveyResponses, surveys } from '@/db/schema';
import { getQuestionGroupsBySurvey } from '@/data/surveys';
import { getSurveyContactStats } from '@/lib/operations/contact-stats.server';
import { completedResponse, notDeletedResponse, notTestResponse } from '@/data/response-filters';
import { decryptQuestionResponses } from '@/lib/crypto/response-pii';
import { normalizeQuestions } from '@/lib/question';
import { requireAuth } from '@/lib/auth';
import { canAccessSurvey, isGuestUser } from '@/lib/auth/guest-grants';
import { withRouteLogging, type RouteLogContext } from '@/lib/logger';
import {
  generateRawDataWorkbook,
  toSpssColumnOptions,
  type RawExportContext,
  type RawExportResponseRow,
} from '@/lib/analytics/raw-workbook';
import { applyExportRowExclusions } from '@/lib/analytics/export-exclusions';
import { buildQuestionMetaMap, buildStepLabelMap } from '@/lib/analytics/raw-export-helpers';
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
const MAX_EXPORT_RESPONSES = 10000;

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
            notTestResponse,
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
          notTestResponse,
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
      const changeConfirmQuestionIds = await loadChangeConfirmQuestionIds(surveyId, {
        isTest: false,
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
      const rows = await loadRawExportRows(surveyId);
      if (rows === 'too_many') {
        return NextResponse.json(
          { error: `응답이 ${MAX_EXPORT_RESPONSES.toLocaleString()}건을 초과하여 내보내기할 수 없습니다.` },
          { status: 413 },
        );
      }
      ctx.bind({ rowCount: rows.length });
      const exportCtx = await buildRawExportContext(surveyId, surveyData.questions);
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

      const rows = await loadRawExportRows(surveyId);
      if (rows === 'too_many') {
        return NextResponse.json(
          { error: `응답이 ${MAX_EXPORT_RESPONSES.toLocaleString()}건을 초과하여 내보내기할 수 없습니다.` },
          { status: 413 },
        );
      }

      const exportCtx = await buildRawExportContext(surveyId, surveyData.questions);
      // 한계 판정은 실제 워크북과 같은 변수 집합으로 해야 한다 — 변동 확인 변수를 빼고
      // 세면 통과했다가 워크북 생성에서 열 한계를 넘는다.
      const plan = planSplit(hydratedQuestions, basis, {}, toSpssColumnOptions(exportCtx));
      if (plan.exceedsExcelLimit) {
        return NextResponse.json(
          { error: '선택한 기준으로는 일부 시트가 Excel 열 한계를 초과합니다. 다른 기준을 선택해 주세요.' },
          { status: 413 },
        );
      }

      ctx.bind({ rowCount: rows.length });
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
      // 추적조사 변동 확인 변수 — .sav 모수도 실 응답이라 real 파티션을 본다.
      const changeConfirmQuestionIds = await loadChangeConfirmQuestionIds(surveyId, {
        isTest: false,
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

/**
 * raw/raw-split 공용 응답 로더.
 * 모수: 삭제·테스트 제외 전 상태 (진행중·이탈 포함 — 상태 컬럼으로 구분).
 * .sav 의 완료 전용 모수와 다름 (response-filters.ts 참조).
 */
async function loadRawExportRows(
  surveyId: string,
): Promise<RawExportResponseRow[] | 'too_many'> {
  const rawWhere = and(
    eq(surveyResponses.surveyId, surveyId),
    notDeletedResponse,
    notTestResponse,
  );

  // 한도 초과 판정은 JSONB 페이로드를 물화하기 전에 count 로 먼저 한다 (.sav 경로와 동일).
  // 전 상태 모수 확장으로 행 수가 커질 수 있어, 초과 설문에서 413 대신 서버리스
  // 메모리 고갈/타임아웃이 나는 것을 막는다.
  const totalRows = await db.select({ total: count() }).from(surveyResponses).where(rawWhere);
  if ((totalRows[0]?.total ?? 0) > MAX_EXPORT_RESPONSES) return 'too_many';

  const rawResponses = await db.query.surveyResponses.findMany({
    where: rawWhere,
    orderBy: (r, { asc }) => [asc(r.startedAt)],
  });

  // count 와 fetch 사이 유입 경합 대비 벨트 (정상 경로에서는 no-op)
  if (rawResponses.length > MAX_EXPORT_RESPONSES) return 'too_many';

  const contactIds = rawResponses
    .map((r) => r.contactTargetId)
    .filter((v): v is string => !!v);
  const contactMap = new Map<
    string,
    { resid: number; groupValue: string | null; inviteCode: string | null }
  >();
  if (contactIds.length > 0) {
    const targets = await db
      .select({
        id: contactTargets.id,
        resid: contactTargets.resid,
        groupValue: contactTargets.groupValue,
        inviteCode: contactTargets.inviteCode,
      })
      .from(contactTargets)
      .where(inArray(contactTargets.id, contactIds));
    for (const t of targets) {
      contactMap.set(t.id, { resid: t.resid, groupValue: t.groupValue, inviteCode: t.inviteCode });
    }
  }

  return rawResponses.map((r) => {
    const c = r.contactTargetId ? contactMap.get(r.contactTargetId) : undefined;
    return {
      id: r.id,
      questionResponses: decryptQuestionResponses(
        (r.questionResponses ?? {}) as Record<string, unknown>,
        { responseId: r.id },
      ),
      groupValue: c?.groupValue ?? null,
      resid: c?.resid ?? null,
      inviteCode: c?.inviteCode ?? null,
      ipHash: r.ipHash,
      currentStepId: r.currentStepId,
      platform: r.platform,
      browser: r.browser,
      status: r.status,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      totalSeconds: r.totalSeconds,
    };
  });
}

/** 메타 컬럼 렌더 컨텍스트 — 개별 URL 베이스와 마지막 입력 문항 라벨 맵. */
async function buildRawExportContext(
  surveyId: string,
  questions: Array<{
    id: string;
    order: number;
    title: string;
    type: string;
    groupId: string | null;
    pageBreakBefore: boolean | null;
    questionCode: string | null;
  }>,
): Promise<RawExportContext> {
  const groups = await getQuestionGroupsBySurvey(surveyId);
  // 조건부 메타 열 판정 — 설문 설정 기준 (응답 매칭 여부 무관):
  // 컨택 타겟이 없으면 시스템ID 열, 그룹값이 전무하면 조사 대상 그룹 열을 만들지 않는다.
  // raw export 모수는 테스트 응답 제외이므로 컨택 통계도 real 스코프로 한정한다.
  const { hasContacts, hasContactGroups } = await getSurveyContactStats(surveyId, 'real');
  // 추적조사 — raw export 모수가 실 응답이므로 이월 응답도 real 파티션만 본다.
  const changeConfirmQuestionIds = await loadChangeConfirmQuestionIds(surveyId, { isTest: false });
  const stepQs = questions.map((q) => ({
    id: q.id,
    order: q.order,
    title: q.title,
    type: q.type,
    groupId: q.groupId,
    pageBreakBefore: q.pageBreakBefore ?? false,
    questionCode: q.questionCode,
  }));
  return {
    appUrl: (process.env['NEXT_PUBLIC_APP_URL'] ?? '').replace(/\/+$/, ''),
    stepLabels: buildStepLabelMap(stepQs, groups),
    hasContacts,
    hasContactGroups,
    questionMeta: buildQuestionMetaMap(questions),
    changeConfirmQuestionIds,
  };
}
