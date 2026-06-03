import { NextRequest, NextResponse } from 'next/server';

import { and, count, eq, inArray, isNull, ne } from 'drizzle-orm';
import * as XLSX from 'xlsx';

import { db } from '@/db';
import { contactTargets, surveyResponses, surveys } from '@/db/schema';
import { notDeletedResponse } from '@/data/response-filters';
import { requireAuth } from '@/lib/auth';
import {
  generateRawDataWorkbook,
  generateSummaryWorkbook,
  generateVariableMapWorkbook,
  type RawExportResponseRow,
} from '@/lib/excel-transformer';
import { Question, Survey, SurveySubmission } from '@/types/survey';
import { generateAllOptionCodes } from '@/utils/option-code-generator';
import { generateAllCellCodes } from '@/utils/table-cell-code-generator';

// Vercel serverless 최대 실행시간 30초 (기본 10초)
export const maxDuration = 30;

const ALLOWED_EXPORT_TYPES = ['summary', 'map', 'sav', 'raw'] as const;
type ExportType = (typeof ALLOWED_EXPORT_TYPES)[number];

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_EXPORT_RESPONSES = 10000;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ surveyId: string }> },
) {
  try {
    await requireAuth();

    const { surveyId } = await params;
    const type = request.nextUrl.searchParams.get('type') as ExportType | null;

    if (!type || !ALLOWED_EXPORT_TYPES.includes(type)) {
      return NextResponse.json({ error: '지원하지 않는 내보내기 형식입니다.' }, { status: 400 });
    }

    // 1. 설문 데이터 조회
    const surveyData = await db.query.surveys.findFirst({
      where: eq(surveys.id, surveyId),
      with: { questions: true },
    });

    if (!surveyData) {
      return NextResponse.json({ error: 'Survey not found' }, { status: 404 });
    }

    // strip된 셀 데이터 hydrate (cellCode, exportLabel 등 복원)
    for (const q of surveyData.questions) {
      if (q.type === 'table' && q.tableRowsData && q.tableColumns) {
        (q as any).tableRowsData = generateAllCellCodes(
          q.questionCode ?? undefined, q.title, q.tableColumns as any, q.tableRowsData as any,
        );
      }
      if ((q as any).options && ['radio', 'checkbox', 'select', 'multiselect'].includes(q.type)) {
        (q as any).options = generateAllOptionCodes((q as any).options);
      }
    }

    // 2. 응답 데이터 조회 (Variable Map은 응답 불필요 → 스킵)
    // raw는 자체 모수(in_progress 제외)와 가드를 별도로 가지므로 이 공용 블록을 건너뛴다.
    let responses: typeof surveyResponses.$inferSelect[] = [];

    if (type !== 'map' && type !== 'raw') {
      const [{ total }] = await db
        .select({ total: count() })
        .from(surveyResponses)
        .where(and(eq(surveyResponses.surveyId, surveyId), notDeletedResponse));

      if (total > MAX_EXPORT_RESPONSES) {
        return NextResponse.json(
          { error: `응답이 ${MAX_EXPORT_RESPONSES.toLocaleString()}건을 초과하여 내보내기할 수 없습니다. (현재 ${total.toLocaleString()}건)` },
          { status: 413 },
        );
      }

      responses = await db.query.surveyResponses.findMany({
        where: and(eq(surveyResponses.surveyId, surveyId), notDeletedResponse),
        orderBy: (responses, { desc }) => [desc(responses.createdAt)],
      });
    }

    const dateSlice = new Date().toISOString().slice(0, 10);
    const safeTitle = encodeURIComponent(surveyData.title);

    // 3. Raw Data xlsx
    if (type === 'raw') {
      // raw 전용 모수: deleted 제외 + in_progress 제외, started_at ASC
      const rawResponses = await db.query.surveyResponses.findMany({
        where: and(
          eq(surveyResponses.surveyId, surveyId),
          isNull(surveyResponses.deletedAt),
          ne(surveyResponses.status, 'in_progress'),
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
        surveyData.questions as unknown as Question[],
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

    // 4. SPSS .sav는 별도 바이너리 응답
    if (type === 'sav') {
      const { generateSavBuffer } = await import('@/lib/spss/sav-builder');
      const savBuffer = await generateSavBuffer(
        surveyData.questions as unknown as Question[],
        responses as unknown as SurveySubmission[],
      );
      return new NextResponse(new Uint8Array(savBuffer), {
        headers: {
          'Content-Disposition': `attachment; filename="${safeTitle}_SPSS_${dateSlice}.sav"`,
          'Content-Type': 'application/octet-stream',
        },
      });
    }

    // 5. xlsx 계열 분기
    let workbook: XLSX.WorkBook;
    let filenamePrefix: string;

    if (type === 'summary') {
      workbook = generateSummaryWorkbook(
        surveyData as unknown as Survey,
        responses as unknown as SurveySubmission[],
      );
      filenamePrefix = 'Summary';
    } else {
      // type === 'map'
      workbook = generateVariableMapWorkbook(surveyData as unknown as Survey);
      filenamePrefix = 'VariableMap';
    }

    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
    const filename = `${safeTitle}_${filenamePrefix}_${dateSlice}.xlsx`;

    return new NextResponse(buffer, {
      headers: {
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Type': XLSX_MIME,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === '인증이 필요합니다.') {
      return NextResponse.json({ error: '권한 없음' }, { status: 401 });
    }
    console.error('Export Error:', error);
    return NextResponse.json(
      { error: '데이터 내보내기 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}
