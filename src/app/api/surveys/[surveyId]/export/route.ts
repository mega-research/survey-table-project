import { NextRequest, NextResponse } from 'next/server';

import { and, count, eq } from 'drizzle-orm';
import * as XLSX from 'xlsx';

import { db } from '@/db';
import { surveyResponses, surveys } from '@/db/schema';
import { notDeletedResponse } from '@/data/response-filters';
import { requireAuth } from '@/lib/auth';
import {
  generateSummaryWorkbook,
  generateVariableMapWorkbook,
} from '@/lib/excel-transformer';
import { Question, Survey, SurveySubmission } from '@/types/survey';
import { generateAllOptionCodes } from '@/utils/option-code-generator';
import { generateAllCellCodes } from '@/utils/table-cell-code-generator';

// Vercel serverless 최대 실행시간 30초 (기본 10초)
export const maxDuration = 30;

const ALLOWED_EXPORT_TYPES = ['summary', 'map', 'sav'] as const;
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
    let responses: typeof surveyResponses.$inferSelect[] = [];

    if (type !== 'map') {
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

    // 3. SPSS .sav는 별도 바이너리 응답
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

    // 4. xlsx 계열 분기
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
