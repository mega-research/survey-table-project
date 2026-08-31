import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { canAccessSurvey, isGuestUser } from '@/lib/auth/guest-grants';
import { withRouteLogging, type RouteLogContext } from '@/lib/logger';
import { loadOperationsDataScope } from '@/lib/operations/data-scope.server';
import { sortByNeedRate } from '@/lib/operations/demand-summary';
import {
  buildDemandSummaryWorkbook,
  getDemandSummary,
} from '@/lib/operations/demand-summary.server';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * 문항 수요 집계표 엑셀 다운로드.
 *
 * 화면에 보이는 표와 같은 내용이 나오도록 정렬·그룹 필터를 쿼리로 받아 같은 순수
 * 함수를 다시 태운다. 기존 SPSS/엑셀 원자료 export 는 그대로 두고 그 옆에 하나를
 * 더하는 것이다 — 이 형식에서 원자료 export 를 감추지 않는다.
 */
async function handleDemandSummaryExport(
  request: NextRequest,
  ctx: RouteLogContext,
  { params }: { params: Promise<{ surveyId: string }> },
) {
  let userId: string;
  try {
    const user = await requireAuth();
    userId = user.id;
  } catch {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  const { surveyId } = await params;
  ctx.bind({ userId, role: isGuestUser(userId) ? 'guest' : 'admin', surveyId });
  if (!canAccessSurvey(userId, surveyId)) {
    return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
  }

  const scope = await loadOperationsDataScope(surveyId);
  const all = await getDemandSummary(surveyId, scope);

  const groupId = request.nextUrl.searchParams.get('groupId');
  const sort = request.nextUrl.searchParams.get('sort');
  const filtered = groupId ? all.filter((row) => row.groupId === groupId) : all;
  const rows =
    sort === 'need-asc'
      ? sortByNeedRate(filtered, 'asc')
      : sort === 'need-desc'
        ? sortByNeedRate(filtered, 'desc')
        : [...filtered].sort((a, b) => a.order - b.order);
  ctx.bind({ rowCount: rows.length });

  const workbook = buildDemandSummaryWorkbook(rows);
  const buffer = await workbook.xlsx.writeBuffer();

  // Content-Disposition 은 ByteString 만 허용 — 한글은 퍼센트 인코딩 (기존 export 라우트 관행)
  const dateSlice = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `${encodeURIComponent('문항수요')}_${dateSlice}.xlsx`;
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': XLSX_MIME,
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

export const GET = withRouteLogging(
  '/api/surveys/[surveyId]/demand-summary',
  handleDemandSummaryExport,
  { errorMessage: '집계표 다운로드 중 오류가 발생했습니다.' },
);
