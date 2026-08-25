import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { canAccessSurvey, isGuestUser } from '@/lib/auth/guest-grants';
import { withRouteLogging, type RouteLogContext } from '@/lib/logger';
import { resolveExportColumns } from '@/lib/operations/contacts-export';
import {
  buildContactsExportWorkbook,
  decryptPiiForExport,
} from '@/server/operations/services/contacts-export';
import {
  getContactColumnScheme,
  listContactsForExport,
  MAX_CONTACT_EXPORT_ROWS,
} from '@/server/read-models/contacts';
import { loadOperationsDataScope } from '@/server/data-scope';

// 대형 명단 + PII 복호화 대비 (기본 10초 → 30초)
export const maxDuration = 30;

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * 조사 대상 명단 엑셀 다운로드.
 * PII 를 평문으로 내보내므로 응답 export 라우트와 동일하게
 * requireAuth + 게스트 설문 스코프 가드(canAccessSurvey)를 적용한다.
 */
async function handleContactsExport(
  request: NextRequest,
  ctx: RouteLogContext,
  { params }: { params: Promise<{ surveyId: string }> },
) {
  try {
    const user = await requireAuth();
    const { surveyId } = await params;
    // 다운로드 발생 사실 자체를 access 로그에 남긴다 — 법정 감사기록(접속기록)과는
    // 별개의 운영 기록. PII 평문 export 경유 지점이므로 로그에는 건수(컬럼·행) 외
    // 어떤 값·id 매핑도 싣지 않는다 (contacts-export.server.ts 의 기존 원칙과 동일).
    ctx.bind({
      userId: user.id,
      role: isGuestUser(user.id) ? 'guest' : 'admin',
      surveyId,
    });
    if (!canAccessSurvey(user.id, surveyId)) {
      return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
    }

    const scope = await loadOperationsDataScope(surveyId);

    const scheme = await getContactColumnScheme(surveyId, scope);
    if (!scheme) {
      return NextResponse.json(
        { error: '컬럼 스킴이 없습니다. 명단을 먼저 업로드하세요.' },
        { status: 400 },
      );
    }

    const columns = resolveExportColumns(
      request.nextUrl.searchParams.getAll('cols'),
      scheme,
    );
    if (columns.length === 0) {
      return NextResponse.json({ error: '선택된 컬럼이 없습니다.' }, { status: 400 });
    }

    const sourceRows = await listContactsForExport(surveyId, scope);
    ctx.bind({ columnCount: columns.length, rowCount: sourceRows.length });
    if (sourceRows.length > MAX_CONTACT_EXPORT_ROWS) {
      return NextResponse.json(
        {
          error: `다운로드 상한(${MAX_CONTACT_EXPORT_ROWS.toLocaleString('ko-KR')}건)을 초과했습니다.`,
        },
        { status: 400 },
      );
    }

    // 선택된 PII 컬럼만 일괄 복호화
    const piiColumnKeys = columns
      .filter((c) => c.source.startsWith('pii.'))
      .map((c) => c.source.slice('pii.'.length));
    const piiMap = await decryptPiiForExport(
      sourceRows.map((r) => r.id),
      piiColumnKeys,
    );

    const inviteBaseUrl = (process.env['NEXT_PUBLIC_APP_URL'] ?? '').replace(/\/+$/, '');
    const rows = sourceRows.map((r) => ({
      resid: r.resid,
      attrs: r.attrs,
      piiPlain: piiMap.get(r.id) ?? {},
      latestResultCode: r.latestResultCode,
      latestAttemptNo: r.latestAttemptNo,
      latestMailStatus: r.latestMailStatus,
      progressPct: r.progressPct,
      responseStatus: r.responseStatus,
      inviteCode: r.inviteCode,
    }));

    const workbook = buildContactsExportWorkbook(columns, rows, inviteBaseUrl);
    const buffer = await workbook.xlsx.writeBuffer();

    // Content-Disposition 은 ByteString 만 허용 — 한글은 퍼센트 인코딩 (기존 export 라우트 관행)
    const dateSlice = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `${encodeURIComponent('조사대상')}_${dateSlice}.xlsx`;
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': XLSX_MIME,
        'Content-Disposition': `attachment; filename="${filename}"`,
        // PII 평문 응답 캐시 방지
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === '인증이 필요합니다.') {
      return NextResponse.json({ error: '권한 없음' }, { status: 401 });
    }
    if (error instanceof Error && error.message === '설문을 찾을 수 없습니다.') {
      return NextResponse.json({ error: '설문을 찾을 수 없습니다.' }, { status: 404 });
    }
    // 그 외 예기치 못한 에러는 로깅 래퍼가 err 기록 + 500 응답으로 처리한다.
    throw error;
  }
}

export const GET = withRouteLogging(
  '/api/surveys/[surveyId]/contacts/export',
  handleContactsExport,
  { errorMessage: '명단 다운로드 중 오류가 발생했습니다.' },
);
