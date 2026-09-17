import Link from 'next/link';

import type { GuestContactsPage } from '@/shared/contracts/workspace-io';

import { GuestEmptyState } from './guest-empty-state';

interface Props {
  page: GuestContactsPage;
  /** 페이지 링크의 기준 주소 — `?page=` 만 갈아끼운다. */
  basePath: string;
}

/**
 * 게스트의 「조사 대상 (마스킹)」 표 (.pen FLOW 5-2 칩 · 스펙 §5, 역할 모델 v2 티켓 22).
 *
 * **이 표만 새로 짰다.** 현황·진척·쿼터 위젯은 운영 콘솔의 것을 그대로 쓴다 — 게스트가
 * 보는 숫자와 담당자가 보는 숫자는 같아야 하고, 조립은 app 층이 한다(기능 묶음끼리는 서로
 * import 하지 않지만 라우트는 어느 묶음이든 쓸 수 있다).
 *
 * 표 하나만 예외인 이유는 저쪽 표가 **헤더 필터 팝오버**를 달고 있기 때문이다. 그 팝오버는
 * 컨택 값 distinct 를 RPC 로 당기는데(게스트에게 닫힌 표면이다), PII 컬럼으로 좁히는 필터는
 * 마스킹본 위에서도 「이 명단에 이 번호가 있는가」를 확인하는 오라클이 된다. 옵트아웃 prop 을
 * 붙이는 대신 표를 나눈 것은 그 표가 이미 정렬·필터·행 링크로 넓어서다.
 *
 * 그래서 여기는 **정렬도 필터도 없는 읽기 표**다. 행을 눌러도 아무 일이 없다 — 컨택 상세는
 * 원문을 복호화하는 화면이고 게스트에게는 존재하지 않는다.
 *
 * 서버 컴포넌트다. 페이지 이동은 링크라 클라이언트 상태가 필요 없다.
 */
export function GuestContactsTable({ page, basePath }: Props) {
  const totalPages = Math.max(1, Math.ceil(page.total / page.pageSize));

  if (page.total === 0) {
    return <GuestEmptyState title="조사 대상이 없습니다." />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-[12px] border border-[#E5E5EA] bg-white">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr className="border-b border-[#E5E5EA] bg-[#F9FAFB]">
              {page.columns.map((label, index) => (
                <th
                  key={`${label}-${index}`}
                  scope="col"
                  className="px-3 py-2 text-[12px] font-semibold whitespace-nowrap text-[#374151]"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.rows.map((row) => (
              <tr key={row.resid} className="border-b border-[#F0F0F2] last:border-b-0">
                {row.cells.map((cell, index) => (
                  <td
                    key={index}
                    className="px-3 py-2 text-[12.5px] whitespace-nowrap text-[#1C1C1E]"
                  >
                    {cell ?? <span className="text-[#C7C7CC]">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-[12px] text-[#6E6E73]">
        <span>
          전체 {page.total.toLocaleString('ko-KR')}건 · {page.page}/{totalPages} 페이지
        </span>
        <div className="flex gap-1.5">
          <PagerLink basePath={basePath} page={page.page - 1} disabled={page.page <= 1}>
            이전
          </PagerLink>
          <PagerLink
            basePath={basePath}
            page={page.page + 1}
            disabled={page.page >= totalPages}
          >
            다음
          </PagerLink>
        </div>
      </div>
    </div>
  );
}

function PagerLink({
  basePath,
  page,
  disabled,
  children,
}: {
  basePath: string;
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const className =
    'flex h-[28px] items-center rounded-[8px] border border-[#E5E5EA] px-2.5 text-[12px] font-medium';
  if (disabled) {
    return <span className={`${className} text-[#C7C7CC]`}>{children}</span>;
  }
  return (
    <Link href={`${basePath}?page=${page}`} className={`${className} text-[#374151] hover:bg-[#F5F5F7]`}>
      {children}
    </Link>
  );
}
