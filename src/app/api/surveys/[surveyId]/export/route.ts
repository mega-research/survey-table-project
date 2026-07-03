import { NextRequest, NextResponse } from 'next/server';

import { and, count, eq, inArray } from 'drizzle-orm';

import { db } from '@/db';
import { contactTargets, surveyResponses, surveys } from '@/db/schema';
import { completedResponse, notDeletedResponse, notTestResponse } from '@/data/response-filters';
import { normalizeQuestions } from '@/lib/question';
import { requireAuth } from '@/lib/auth';
import { isAdminUserAllowed } from '@/lib/auth/admin-allowlist';
import { generateRawDataWorkbook, type RawExportResponseRow } from '@/lib/analytics/raw-workbook';
import { buildSplitWorkbook } from '@/lib/analytics/split-workbook';
import { planSplit } from '@/lib/analytics/split-export';
import { hydrateQuestionsForSpss } from '@/lib/spss/hydrate-questions';
import { isSpssVarNameError } from '@/lib/spss/variable-name-guard';
import { SurveySubmission } from '@/types/survey';

// Vercel serverless 최대 실행시간 30초 (기본 10초)
export const maxDuration = 30;

const ALLOWED_EXPORT_TYPES = ['sav', 'raw', 'raw-split', 'sps'] as const;
type ExportType = (typeof ALLOWED_EXPORT_TYPES)[number];

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_EXPORT_RESPONSES = 10000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ surveyId: string }> },
) {
  try {
    // 인증 + admin allowlist 가드. oRPC authed 미들웨어와 동일한 isAdminUserAllowed 를
    // 적용해, ADMIN_USER_IDS 로 어드민을 잠갔을 때 이 REST 라우트가 형제 우회 경로가
    // 되지 않도록 한다(임의 인증사용자의 전체 응답 export 차단).
    const user = await requireAuth();
    if (!isAdminUserAllowed(user.id)) {
      return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
    }

    const { surveyId } = await params;
    const type = request.nextUrl.searchParams.get('type') as ExportType | null;

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
    const hydratedQuestions = hydrateQuestionsForSpss(normalizeQuestions(surveyData.questions));

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

      responses = await db.query.surveyResponses.findMany({
        where: and(
          eq(surveyResponses.surveyId, surveyId),
          notDeletedResponse,
          completedResponse,
          notTestResponse,
        ),
        orderBy: (responses, { desc }) => [desc(responses.createdAt)],
      });
    }

    const dateSlice = new Date().toISOString().slice(0, 10);
    const safeTitle = encodeURIComponent(surveyData.title);

    // 3-0. MRSETS .sps 문법 파일 (복수응답 세트 등록 - .sav 보조 파일)
    if (type === 'sps') {
      const { generateSPSSColumns } = await import('@/lib/analytics/spss-excel-export');
      const { generateMrsetsSyntax } = await import('@/lib/spss/mrsets-syntax');
      const syntax = generateMrsetsSyntax(generateSPSSColumns(hydratedQuestions), hydratedQuestions);
      if (syntax === null) {
        return NextResponse.json(
          { error: '복수응답(checkbox) 변수가 없어 MRSETS 문법을 생성할 항목이 없습니다.' },
          { status: 400 },
        );
      }
      return new NextResponse(syntax, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="${safeTitle}_MRSETS_${dateSlice}.sps"`,
        },
      });
    }

    // 3. Raw Data xlsx
    if (type === 'raw') {
      // raw 전용 모수: deleted 제외 + completed만 + 테스트 응답 제외 (행 포함 정책 통일)
      const rawResponses = await db.query.surveyResponses.findMany({
        where: and(
          eq(surveyResponses.surveyId, surveyId),
          notDeletedResponse,
          completedResponse,
          notTestResponse,
        ),
        orderBy: (r, { asc }) => [asc(r.startedAt)],
      });

      if (rawResponses.length > MAX_EXPORT_RESPONSES) {
        return NextResponse.json(
          { error: `응답이 ${MAX_EXPORT_RESPONSES.toLocaleString()}건을 초과하여 내보내기할 수 없습니다.` },
          { status: 413 },
        );
      }

      // resid / groupValue 매핑 (컨택 매칭 응답만)
      const contactIds = rawResponses
        .map((r) => r.contactTargetId)
        .filter((v): v is string => !!v);
      const contactMap = new Map<string, { resid: number; groupValue: string | null }>();
      if (contactIds.length > 0) {
        const targets = await db
          .select({ id: contactTargets.id, resid: contactTargets.resid, groupValue: contactTargets.groupValue })
          .from(contactTargets)
          .where(inArray(contactTargets.id, contactIds));
        for (const t of targets) contactMap.set(t.id, { resid: t.resid, groupValue: t.groupValue });
      }

      const identifierMode = surveyData.requireInviteToken ? 'systemId' : 'sequence';

      const rows: RawExportResponseRow[] = rawResponses.map((r) => {
        const c = r.contactTargetId ? contactMap.get(r.contactTargetId) : undefined;
        return {
          id: r.id,
          questionResponses: (r.questionResponses ?? {}) as Record<string, unknown>,
          groupValue: c?.groupValue ?? null,
          resid: c?.resid ?? null,
          platform: r.platform,
          browser: r.browser,
          status: r.status,
          startedAt: r.startedAt,
          completedAt: r.completedAt,
          totalSeconds: r.totalSeconds,
        };
      });

      const workbook = generateRawDataWorkbook(
        hydratedQuestions,
        rows,
        identifierMode,
      );
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

      const basisQuestion = hydratedQuestions.find((q) => q.id === basis);
      if (!basisQuestion) {
        return NextResponse.json({ error: '유효하지 않은 분할 기준 문항입니다.' }, { status: 400 });
      }

      const rawResponses = await db.query.surveyResponses.findMany({
        where: and(
          eq(surveyResponses.surveyId, surveyId),
          notDeletedResponse,
          completedResponse,
          notTestResponse,
        ),
        orderBy: (r, { asc }) => [asc(r.startedAt)],
      });

      if (rawResponses.length > MAX_EXPORT_RESPONSES) {
        return NextResponse.json(
          { error: `응답이 ${MAX_EXPORT_RESPONSES.toLocaleString()}건을 초과하여 내보내기할 수 없습니다.` },
          { status: 413 },
        );
      }

      const contactIds = rawResponses
        .map((r) => r.contactTargetId)
        .filter((v): v is string => !!v);
      const contactMap = new Map<string, { resid: number; groupValue: string | null }>();
      if (contactIds.length > 0) {
        const targets = await db
          .select({ id: contactTargets.id, resid: contactTargets.resid, groupValue: contactTargets.groupValue })
          .from(contactTargets)
          .where(inArray(contactTargets.id, contactIds));
        for (const t of targets) contactMap.set(t.id, { resid: t.resid, groupValue: t.groupValue });
      }

      const identifierMode = surveyData.requireInviteToken ? 'systemId' : 'sequence';

      const rows: RawExportResponseRow[] = rawResponses.map((r) => {
        const c = r.contactTargetId ? contactMap.get(r.contactTargetId) : undefined;
        return {
          id: r.id,
          questionResponses: (r.questionResponses ?? {}) as Record<string, unknown>,
          groupValue: c?.groupValue ?? null,
          resid: c?.resid ?? null,
          platform: r.platform,
          browser: r.browser,
          status: r.status,
          startedAt: r.startedAt,
          completedAt: r.completedAt,
          totalSeconds: r.totalSeconds,
        };
      });

      const plan = planSplit(hydratedQuestions, basis);
      if (plan.exceedsExcelLimit) {
        return NextResponse.json(
          { error: '선택한 기준으로는 일부 시트가 Excel 열 한계를 초과합니다. 다른 기준을 선택해 주세요.' },
          { status: 413 },
        );
      }

      const workbook = buildSplitWorkbook(
        hydratedQuestions,
        rows,
        basis,
        identifierMode,
      );
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
      const savBuffer = await generateSavBuffer(
        hydratedQuestions,
        responses as unknown as SurveySubmission[],
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
    console.error('Export Error:', error);
    return NextResponse.json(
      { error: '데이터 내보내기 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}
