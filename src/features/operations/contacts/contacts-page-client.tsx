'use client';

import { useRouter } from 'next/navigation';

import { ContactsTable } from '@/features/operations/contacts/contacts-table';
import type { ContactsSortDir, ContactsSortKey } from '@/lib/operations/contacts-format';
import type { ContactColumnScheme, ContactResultCode } from '@/shared/contracts/contacts';
import type { ContactsRow } from '@/shared/contracts/contacts-io';

import { operationsPaths } from '../operations-paths';

interface ContactsPageClientProps {
  surveyId: string;
  /** 이 콘솔의 주소 접두 — 행 클릭이 자기 트리 안에 머문다. */
  basePath: string;
  /**
   * 행을 눌러 단건 상세로 들어갈 수 있는가.
   *
   * capability 축이 **아니다** — 상세를 여는 요구는 목록과 같은 `contacts.view` 라 판정으로는
   * 갈리지 않는다. 묻는 것은 「이 트리에 그 화면이 있는가」이고, 외주 실사 링크 트리에는
   * 아직 없다(티켓 08). 없는 곳에서 행을 누르면 404 로 떨어지므로 아예 누를 수 없게 둔다 —
   * 탭이 여는 주소가 실재해야 하는 것과 같은 규칙이다.
   */
  canOpenDetail: boolean;
  scheme: ContactColumnScheme;
  rows: ContactsRow[];
  total: number;
  page: number;
  pageSize: number;
  sort: ContactsSortKey;
  dir: ContactsSortDir;
  resultCodeOptions: ContactResultCode[];
}

/**
 * 조사 대상 표 + 행 클릭 라우팅. + 업로드 / + 조사 대상 추가 액션은 page.tsx 헤더에 있음.
 */
export function ContactsPageClient({
  surveyId,
  basePath,
  canOpenDetail,
  scheme,
  rows,
  total,
  page,
  pageSize,
  sort,
  dir,
  resultCodeOptions,
}: ContactsPageClientProps) {
  const router = useRouter();

  return (
    <ContactsTable
      rows={rows}
      total={total}
      page={page}
      pageSize={pageSize}
      scheme={scheme}
      sort={sort}
      dir={dir}
      surveyId={surveyId}
      resultCodeOptions={resultCodeOptions}
      {...(canOpenDetail
        ? { onRowClick: (row) => router.push(operationsPaths(basePath).contact(row.id)) }
        : {})}
    />
  );
}
