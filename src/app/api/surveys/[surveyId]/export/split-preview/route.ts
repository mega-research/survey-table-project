import { NextRequest, NextResponse } from 'next/server';

import { and, eq, isNull, ne } from 'drizzle-orm';

import { db } from '@/db';
import { surveyResponses, surveys } from '@/db/schema';
import { requireAuth } from '@/lib/auth';
import {
  detectSplitCandidates,
  planSplit,
  SPLIT_SOFT_LIMIT,
  SPLIT_EXCEL_LIMIT,
} from '@/lib/analytics/split-export';
import { generateSPSSColumns } from '@/lib/analytics/spss-excel-export';
import type { Question } from '@/types/survey';
import { generateAllOptionCodes } from '@/utils/option-code-generator';
import { generateAllCellCodes } from '@/utils/table-cell-code-generator';

export const maxDuration = 30;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ surveyId: string }> },
) {
  try {
    await requireAuth();
    const { surveyId } = await params;
    const basis = request.nextUrl.searchParams.get('basis');

    const surveyData = await db.query.surveys.findFirst({
      where: eq(surveys.id, surveyId),
      with: { questions: true },
    });
    if (!surveyData) return NextResponse.json({ error: 'Survey not found' }, { status: 404 });

    // 셀/옵션 코드 hydrate (export/route.ts와 동일 패턴)
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

    const questions = surveyData.questions as unknown as Question[];

    if (!basis) {
      const totalVars = generateSPSSColumns([...questions].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))).length;
      return NextResponse.json({
        totalVars,
        softLimit: SPLIT_SOFT_LIMIT,
        excelLimit: SPLIT_EXCEL_LIMIT,
        candidates: detectSplitCandidates(questions),
      });
    }

    // resp 집계: raw export와 동일 모수
    const responses = await db.query.surveyResponses.findMany({
      where: and(
        eq(surveyResponses.surveyId, surveyId),
        isNull(surveyResponses.deletedAt),
        ne(surveyResponses.status, 'in_progress'),
      ),
      columns: { questionResponses: true },
    });
    const respCounts: Record<string, number> = {};
    for (const r of responses) {
      const ans = (r.questionResponses as Record<string, unknown> | null)?.[basis];
      const vals = Array.isArray(ans) ? ans : ans != null ? [ans] : [];
      for (const v of new Set(vals.map((x) => String(x)))) {
        respCounts[v] = (respCounts[v] ?? 0) + 1;
      }
    }

    return NextResponse.json({ plan: planSplit(questions, basis, respCounts) });
  } catch (error) {
    console.error('split-preview error:', error);
    return NextResponse.json({ error: '미리보기 생성 중 오류가 발생했습니다.' }, { status: 500 });
  }
}
