import ExcelJS from 'exceljs';
import { type NextRequest, NextResponse } from 'next/server';

import { autoFitRawColumns, styleHeaderRows } from '@/lib/analytics/raw-workbook';
import { type RouteLogContext, withRouteLogging } from '@/lib/logger';
import { clientLinkPath } from '@/lib/survey-url';
import {
  CLIENT_RESPONSES_EXPORT_LIMIT,
  clientResponseCellText,
  listClientResponsesForExport,
} from '@/server/operations/services/client-responses';
import { checkClientLinkAccess } from '@/server/page-client-link-access';
import { getClientSurveyHeader } from '@/server/read-models/guest-surveys';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * 클라이언트 링크 응답 내역 엑셀 내려받기 (`.scratch/client-link-response-extras`).
 *
 * 「엑셀 다운로드」 칩(`responsesExport`, 응답 내역에 딸린 칩)이 열린 링크에서만 파일이 나온다. 관문은
 * 페이지와 같은 판정(`checkClientLinkAccess`)이다 — 세션이 없으면 입구로, 칩이 닫혔으면 404(사유 비공개).
 *
 * **화면의 열 그대로다**(2026-11-27 사용자 결정) — 그 링크의 「열 설정」, 같은 투영(`listClientResponses`
 * 와 한 조립). 개인정보 열·암호화 칸은 열 후보에서 이미 빠져 있어 파일에도 없다. 좁히기는 화면에서 고른
 * 상태(`?status=`) 하나뿐이다. 내부 내보내기(`/api/surveys/[id]/export`)를 쓰지 않는 것은 그 라우트의
 * 관문이 내부 계정 전용이라서다.
 *
 * 로그에는 행·열 수만 싣는다(값 금지). 명단 값이 열로 들어갈 수 있어 캐시에 남기지 않는다.
 */
async function handleClientResponsesExport(
  request: NextRequest,
  ctx: RouteLogContext,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const check = await checkClientLinkAccess(token, request.headers, 'responsesExport');
  if (check.kind === 'entrance') {
    return NextResponse.redirect(new URL(clientLinkPath(encodeURIComponent(token)), request.url));
  }
  if (check.kind === 'denied') return new NextResponse(null, { status: 404 });

  const { surveyId } = check.viewer;
  ctx.bind({ surveyId, role: 'client_link' });
  const status = request.nextUrl.searchParams.get('status') ?? undefined;
  const [loaded, header] = await Promise.all([
    listClientResponsesForExport(surveyId, status !== undefined ? { status } : {}),
    getClientSurveyHeader(surveyId),
  ]);
  if (!header) return new NextResponse(null, { status: 404 });
  if (loaded.kind === 'too_many') {
    return NextResponse.json(
      {
        error: `응답이 ${CLIENT_RESPONSES_EXPORT_LIMIT.toLocaleString()}건을 초과하여 내려받을 수 없습니다. (현재 ${loaded.total.toLocaleString()}건) 상태로 좁혀 다시 내려받아 주세요.`,
      },
      { status: 413 },
    );
  }
  ctx.bind({ rowCount: loaded.rows.length, columnCount: loaded.columns.length });

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('응답 내역');
  ws.addRow(loaded.columns);
  for (const row of loaded.rows) ws.addRow(row.cells.map(clientResponseCellText));
  styleHeaderRows(ws, [1], loaded.columns.length);
  autoFitRawColumns(ws, loaded.columns.length);
  const buffer = await workbook.xlsx.writeBuffer();
  const date = new Date().toISOString().slice(0, 10);
  const filename = `${encodeURIComponent(header.title)}_${encodeURIComponent('응답내역')}_${date}.xlsx`;
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${filename}`,
      'Content-Type': XLSX_MIME,
      'Cache-Control': 'no-store',
    },
  });
}

export const GET = withRouteLogging(
  '/client/[token]/responses/export',
  handleClientResponsesExport,
  { errorMessage: '응답 내역 내려받기 중 오류가 발생했습니다.' },
);
