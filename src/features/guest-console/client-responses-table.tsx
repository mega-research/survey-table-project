import Link from 'next/link';

import { mapStatusPill } from '@/lib/operations/profiles-format';
import { cn } from '@/lib/utils';
import type { ClientResponseCell, ClientResponsesPage } from '@/shared/contracts/workspace-io';

import { GuestEmptyState } from './guest-empty-state';

interface Props {
  page: ClientResponsesPage;
  /** 이 화면 자신의 주소 — 좁히기·페이지 링크가 여기에 `?status=`·`?page=` 를 붙인다. */
  basePath: string;
}

/** 좁히기 칩 — 내부 응답 내역의 상태 필터에서 휴지통만 뺀 것이다. */
const STATUS_CHIPS = ['completed', 'in_progress', 'drop', 'screened_out', 'quotaful_out', 'bad'];

const TONE_CLASS: Record<Extract<ClientResponseCell, { kind: 'status' }>['tone'], string> = {
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  gray: 'bg-slate-50 text-slate-600 border-slate-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  red: 'bg-rose-50 text-rose-700 border-rose-200',
};

/**
 * 클라이언트 링크의 응답 내역 표 (`.scratch/client-link-response-list` 티켓 03).
 *
 * 조사 대상 표(`GuestContactsTable`)와 같은 이유로 운영 콘솔의 표를 쓰지 않는다 — 저쪽은 헤더
 * 필터 팝오버가 RPC 를 당기고(이 트리에는 RPC 표면이 없다) 행 메뉴가 수정·삭제 화면으로 간다.
 * 여기는 **정렬도 값 검색도 없는 읽기 표**이고, 링크는 상태 좁히기와 페이지 이동뿐이다. 도착하는
 * 행에는 표시 값만 있다(서버 투영 `listClientResponses`) — 응답 id 가 없으니 행이 갈 곳도 없다.
 *
 * 상태 칸은 내부 표의 알약과 같은 얼굴이다(색 + 진행 위치). 운영 콘솔의 `StatusPill` 을 쓰지
 * 못하는 것은 기능 묶음끼리 import 하지 않기 때문이고, 색 표는 그쪽과 같은 값이다.
 *
 * 서버 컴포넌트다 — 이동이 전부 링크라 클라이언트 상태가 필요 없다.
 */
export function ClientResponsesTable({ page, basePath }: Props) {
  const totalPages = Math.max(1, Math.ceil(page.total / page.pageSize));
  const href = (params: { status?: string; page?: number }) => {
    const query = new URLSearchParams();
    if (params.status && params.status !== 'all') query.set('status', params.status);
    if (params.page !== undefined) query.set('page', String(params.page));
    const qs = query.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="상태로 좁히기" className="flex flex-wrap gap-1.5">
        {['all', ...STATUS_CHIPS].map((status) => {
          const active = page.status === status;
          return (
            <Link
              key={status}
              href={href({ status })}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex h-[28px] items-center rounded-full border px-3 text-[12px] font-medium',
                active
                  ? 'border-[#2E4FCE] bg-[#EEF2FF] text-[#2743AE]'
                  : 'border-[#E5E5EA] bg-white text-[#6E6E73] hover:text-[#1C1C1E]',
              )}
            >
              {status === 'all' ? '전체' : mapStatusPill({ status }).label}
            </Link>
          );
        })}
      </nav>

      {page.total === 0 ? (
        <GuestEmptyState title="응답이 없습니다." />
      ) : (
        <>
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
                  <tr key={row.idx} className="border-b border-[#F0F0F2] last:border-b-0">
                    {row.cells.map((cell, index) => (
                      <td
                        key={index}
                        className="px-3 py-2 text-[12.5px] whitespace-nowrap text-[#1C1C1E]"
                      >
                        <Cell cell={cell} />
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
              <PagerLink
                href={href({ status: page.status, page: page.page - 1 })}
                disabled={page.page <= 1}
              >
                이전
              </PagerLink>
              <PagerLink
                href={href({ status: page.status, page: page.page + 1 })}
                disabled={page.page >= totalPages}
              >
                다음
              </PagerLink>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Cell({ cell }: { cell: ClientResponseCell }) {
  if (cell.kind === 'status') {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
          TONE_CLASS[cell.tone],
        )}
      >
        <span>{cell.label}</span>
        {cell.sub && <span className="font-normal opacity-80">· {cell.sub}</span>}
      </span>
    );
  }
  return cell.text ?? <span className="text-[#C7C7CC]">—</span>;
}

function PagerLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const className =
    'flex h-[28px] items-center rounded-[8px] border border-[#E5E5EA] px-2.5 text-[12px] font-medium';
  if (disabled) {
    return <span className={`${className} text-[#C7C7CC]`}>{children}</span>;
  }
  return (
    <Link href={href} className={`${className} text-[#374151] hover:bg-[#F5F5F7]`}>
      {children}
    </Link>
  );
}
