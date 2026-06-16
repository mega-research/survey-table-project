import { NextRequest, NextResponse } from 'next/server';

import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { surveyResponses, surveys } from '@/db/schema';
import { completedResponse, notDeletedResponse } from '@/data/response-filters';
import { normalizeQuestions } from '@/lib/question';
import { requireAuth } from '@/lib/auth';
import { isAdminUserAllowed } from '@/lib/auth/admin-allowlist';
import {
  detectSplitCandidates,
  planSplit,
  SPLIT_SOFT_LIMIT,
  SPLIT_EXCEL_LIMIT,
} from '@/lib/analytics/split-export';
import { generateSPSSColumns } from '@/lib/analytics/spss-excel-export';
import { hydrateQuestionsForSpss } from '@/lib/spss/hydrate-questions';

export const maxDuration = 30;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ surveyId: string }> },
) {
  try {
    // 인증 + admin allowlist 가드(export/route.ts 와 동일 정책). 설문 구조·응답 집계를
    // 노출하므로 임의 인증사용자의 형제 우회를 차단한다.
    const user = await requireAuth();
    if (!isAdminUserAllowed(user.id)) {
      return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
    }
    const { surveyId } = await params;
    const basis = request.nextUrl.searchParams.get('basis');

    const surveyData = await db.query.surveys.findFirst({
      where: eq(surveys.id, surveyId),
      with: { questions: true },
    });
    if (!surveyData) return NextResponse.json({ error: 'Survey not found' }, { status: 404 });

    // 셀/옵션 코드 hydrate (export/route.ts와 공용 헬퍼)
    const questions = hydrateQuestionsForSpss(normalizeQuestions(surveyData.questions));

    if (!basis) {
      const totalVars = generateSPSSColumns([...questions].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))).length;
      return NextResponse.json({
        totalVars,
        softLimit: SPLIT_SOFT_LIMIT,
        excelLimit: SPLIT_EXCEL_LIMIT,
        candidates: detectSplitCandidates(questions),
      });
    }

    // resp 집계: raw export와 동일 모수 (deleted 제외 + completed만)
    const responses = await db.query.surveyResponses.findMany({
      where: and(
        eq(surveyResponses.surveyId, surveyId),
        notDeletedResponse,
        completedResponse,
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
