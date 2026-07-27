import { NextRequest, NextResponse } from 'next/server';

import { requireAuth } from '@/lib/auth';
import { isAdminUserAllowed } from '@/lib/auth/admin-allowlist';
import { resolveExportColumns } from '@/lib/operations/contacts-export';
import {
  buildContactsExportWorkbook,
  decryptPiiForExport,
} from '@/lib/operations/contacts-export.server';
import {
  getContactColumnScheme,
  listContactsForExport,
  MAX_CONTACT_EXPORT_ROWS,
} from '@/lib/operations/contacts.server';
import { loadOperationsDataScope } from '@/lib/operations/data-scope.server';

// 대형 명단 + PII 복호화 대비 (기본 10초 → 30초)
export const maxDuration = 30;

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * 조사 대상 명단 엑셀 다운로드.
 * PII 를 평문으로 내보내므로 응답 export 라우트와 동일하게
 * requireAuth + isAdminUserAllowed 이중 가드를 적용한다.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ surveyId: string }> },
) {
  try {
    const user = await requireAuth();
    if (!isAdminUserAllowed(user.id)) {
      return NextResponse.json({ error: '권한이 없습니다.' }, { status: 403 });
    }

    const { surveyId } = await params;
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
    console.error('Contacts Export Error:', error);
    return NextResponse.json(
      { error: '명단 다운로드 중 오류가 발생했습니다.' },
      { status: 500 },
    );
  }
}
