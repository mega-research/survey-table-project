import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { buildDownloadCandidates } from '@/lib/operations/contacts-export-format';
import type { ContactsListPageData } from '@/shared/contracts/contacts-io';
import type { SurveyCapability } from '@/shared/contracts/workspace';

import { EmptyState } from '../empty-state';
import { operationsPaths } from '../operations-paths';
import { ContactUploadAction } from './contact-upload-action';
import { ContactsDownloadDialog } from './contacts-download-dialog';
import { ContactsFilterBar } from './contacts-filter-bar';
import { contactDetailHref } from './contacts-list-return';
import { ContactsPageClient } from './contacts-page-client';

/**
 * 조사 대상 목록 화면 — 내부 콘솔과 외주 실사 링크 트리가 함께 쓰는 **한 벌** (ADR-0026, 티켓 06).
 *
 * ADR 의 「화면을 따로 짜면 두 벌이 되어 한쪽만 고쳐진다」가 라우트가 둘이어도 지켜지는
 * 자리다. 트리마다 다른 것은 셋뿐이고 전부 props 로 들어온다.
 *  - `basePath`      — 필터·정렬·페이지·행 클릭이 자기 트리 안에 머문다.
 *  - `capabilities`  — 액션 버튼이 **그려지느냐**를 정한다.
 *  - `data`          — 조회 결과(read-model 이 조립).
 *
 * **버튼 노출은 근사가 아니라 서버 판정 그대로다.** 다운로드·업로드·이월 임포트·대상 추가·
 * 컬럼 설정은 전부 `contacts.manage`(내보내기만 `export.download`)를 요구하고, 링크 열에는
 * 둘 다 없어 하나도 그려지지 않는다. 화면이 감추는 것과 서버가 막는 것이 같은 값을 보는
 * 것이 요점이다 — 갈리면 「보이는데 누르면 거부」가 된다.
 *
 * 네 번째로 갈리는 것이 하나 더 있는데 **capability 축이 아니다** — 행 클릭
 * (`canOpenDetail`). 상세를 여는 요구는 목록과 같은 `contacts.view` 라 판정으로 갈리지 않고,
 * 묻는 것은 「이 트리에 그 화면이 있는가」다.
 *
 * 서버 컴포넌트다. `ContactsPageClient`·`ContactsFilterBar` 만 클라이언트이고 이 껍데기는
 * 데이터를 받아 배치만 한다 — 두 트리의 RSC 가 각자 로더를 부르고 이것을 렌더한다.
 */
interface Props {
  surveyId: string;
  /** 이 콘솔의 주소 접두. */
  basePath: string;
  capabilities: ReadonlySet<SurveyCapability>;
  /**
   * 행을 눌러 단건 상세로 들어갈 수 있는가 — **이 트리에 그 화면이 있는가**이지
   * capability 가 아니다(`ContactsPageClient` 주석 참조). 외주 실사 링크 트리는 티켓 08 에서
   * 참이 된다.
   */
  canOpenDetail: boolean;
  data: ContactsListPageData;
  /**
   * 지금 목록 주소의 쿼리(`listQueryFromSearchParams`) — 「+ 조사 대상 추가」가 실어 가 저장 뒤
   * 이 목록의 페이지·필터로 돌아온다. 행 클릭은 클라이언트가 주소에서 직접 읽는다.
   */
  listQuery?: string;
}

export function ContactsListView({
  surveyId,
  basePath,
  capabilities,
  canOpenDetail,
  data,
  listQuery = '',
}: Props) {
  const paths = operationsPaths(basePath);
  const canManage = capabilities.has('contacts.manage');
  const canDownload = capabilities.has('export.download');

  if (!data.scheme) {
    return (
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-4">
          <h2 className="text-xl font-bold text-gray-900">조사 대상 목록</h2>
        </div>
        <Card>
          <CardContent className="px-5 py-4">
            <EmptyState
              message="아직 업로드된 조사 대상이 없습니다"
              description={
                canManage
                  ? '엑셀 파일을 업로드해 명단을 적재하세요.'
                  : '담당 연구원이 명단을 올리면 여기에 표시됩니다.'
              }
            />
            {canManage && (
              <div className="mt-4 flex justify-center">
                <ContactUploadAction
                  href={paths.contactsUploadNew}
                  label="엑셀 업로드"
                  disabled={data.isTestScope}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">조사 대상 목록</h2>
          <p className="text-sm text-slate-500">총 {data.total.toLocaleString('ko-KR')}건</p>
        </div>
        <div className="flex items-center gap-2">
          {canDownload && (
            <ContactsDownloadDialog
              surveyId={surveyId}
              candidates={buildDownloadCandidates(data.scheme)}
            />
          )}
          {canManage && (
            <>
              <ContactUploadAction
                href={paths.contactsUploadNew}
                label="+ 업로드"
                disabled={data.isTestScope}
              />
              {/* 이월 응답은 명단과 다른 경로다 — 명단 업로드의 replace 는 개별 링크를 재발급한다. */}
              <Button asChild variant="outline" size="sm">
                <Link href={`${paths.contacts}/prior-answers`}>이월 응답 임포트</Link>
              </Button>
              <Button asChild size="sm">
                <Link href={contactDetailHref(paths.contacts, 'new', listQuery)}>
                  + 조사 대상 추가
                </Link>
              </Button>
            </>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="px-5 py-4 space-y-4">
          <ContactsFilterBar
            surveyId={surveyId}
            initialClauses={data.initialClauses}
            columnCandidates={data.columnCandidates}
            resultCodeOptions={data.resultCodes}
            assignmentOptions={data.assignmentOptions}
            {...(canManage ? { columnsSettingsHref: paths.contactsColumns } : {})}
          />
          {data.rows.length === 0 ? (
            <EmptyState
              message={data.hasFilter ? '검색 결과가 없습니다' : '조사 대상이 없습니다'}
              description={
                data.hasFilter
                  ? '필터를 변경해 보세요.'
                  : canManage
                    ? '엑셀로 명단을 업로드하세요.'
                    : '담당 연구원이 명단을 올리면 여기에 표시됩니다.'
              }
            />
          ) : (
            <ContactsPageClient
              basePath={basePath}
              canOpenDetail={canOpenDetail}
              rows={data.rows}
              total={data.total}
              page={data.page}
              pageSize={data.pageSize}
              scheme={data.scheme}
              surveyId={surveyId}
              sort={data.sort}
              dir={data.dir}
              resultCodeOptions={data.resultCodes}
              assignmentOptions={data.assignmentOptions}
            />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
