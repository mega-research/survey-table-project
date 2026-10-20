import Link from 'next/link';

import { Card } from '@/components/ui/card';
import { LocalDateTime } from '@/components/ui/local-date-time';
import {
  PAGER_ELLIPSIS_CLASS,
  PAGER_ITEM_CLASS,
  PAGER_ITEM_CURRENT_CLASS,
  PAGER_ITEM_DISABLED_CLASS,
  PAGER_STATUS_CLASS,
} from '@/features/operations/pager-classes';
import { PagerJump } from '@/features/operations/pager-jump';
import { buildPageItems, pageBlockNavTargets } from '@/features/operations/table-primitives';
import { type MailDisplayColumn, mailColumnValue } from '@/lib/contacts/mail-display-columns';
import type { UnsubscribedContactRow } from '@/shared/contracts/mail-io';

import { UnsubscribedRevertButton } from './unsubscribed-revert-button';
import { internalOperationsPaths } from '../operations-paths';

interface Props {
  surveyId: string;
  rows: UnsubscribedContactRow[];
  total: number;
  page: number;
  pageSize: number;
  /** 컬럼 설정에서 "메일 표시" 를 켠 attrs 컬럼 — 시스템ID 다음에 붙는다. */
  mailColumns: MailDisplayColumn[];
  /** 맨 앞 시스템ID 열을 그리는가 — 컬럼 설정의 메일 표시 스위치 */
  showResid: boolean;
}

export function UnsubscribedSegment({
  surveyId,
  rows,
  total,
  page,
  pageSize,
  mailColumns,
  showResid,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  // 이전·다음은 10개 묶음 단위로 넘긴다 (다음 = 다음 묶음 첫 페이지, 이전 = 이전 묶음 마지막 페이지).
  const nav = pageBlockNavTargets(page, totalPages);

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">수신거부자 명단</h2>
          <p className="mt-1 text-sm text-slate-500">
            모든 단체 메일에서 자동으로 제외됩니다. 총 {total.toLocaleString('ko-KR')}명.
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <Card className="border-dashed">
          <div className="px-6 py-10 text-center text-sm text-slate-500">
            아직 수신거부 처리된 조사 대상이 없습니다.
          </div>
        </Card>
      ) : (
        <>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50 text-left text-xs font-medium tracking-wide text-gray-500 uppercase">
                  {showResid ? <th className="px-4 py-3">시스템ID</th> : null}
                  {mailColumns.map((c) => (
                    <th key={`${c.kind}.${c.key}`} className="px-4 py-3">
                      {c.label}
                    </th>
                  ))}
                  <th className="px-4 py-3">이메일</th>
                  <th className="px-4 py-3">그룹</th>
                  <th className="px-4 py-3">경로</th>
                  <th className="px-4 py-3">해지 시각</th>
                  <th className="px-4 py-3 text-center">관리</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const shownAt = r.unsubscribedAt ?? r.resultUnsubscribedAt;
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-gray-100 text-sm last:border-b-0 hover:bg-gray-50/50"
                    >
                      {showResid ? (
                        <td className="px-4 py-3 font-mono text-xs text-slate-600">#{r.resid}</td>
                      ) : null}
                      {mailColumns.map((c) => (
                        <td key={`${c.kind}.${c.key}`} className="px-4 py-3 text-slate-600">
                          {mailColumnValue(c, r.attrs, r.piiMasks, r.assignmentName) || '—'}
                        </td>
                      ))}
                      <td className="px-4 py-3 text-slate-900">{r.emailMasked}</td>
                      <td className="px-4 py-3 text-slate-600">{r.groupValue ?? '—'}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {[
                          r.unsubscribedAt ? '메일 해지' : null,
                          r.resultUnsubscribedAt ? '컨택결과' : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {shownAt ? <LocalDateTime value={shownAt} /> : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {r.unsubscribedAt ? (
                          <UnsubscribedRevertButton
                            surveyId={surveyId}
                            contactId={r.id}
                            emailMasked={r.emailMasked}
                          />
                        ) : (
                          // 컨택결과 단독 수신거부는 메일 해지가 아니라 해제 대상이 없다 —
                          // 컨택 상세의 결과 회차에서 수정한다.
                          <span
                            className="text-xs text-slate-400"
                            title="컨택결과 수신거부는 컨택 상세의 결과 회차에서 수정합니다."
                          >
                            컨택 회차
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          {totalPages > 1 ? (
            <div className="flex items-center justify-end gap-1 text-sm">
              <span className={PAGER_STATUS_CLASS}>
                {page} / {totalPages}
              </span>
              <SegPageLink surveyId={surveyId} page={nav.prev ?? 1} disabled={nav.prev === null}>
                이전
              </SegPageLink>
              {buildPageItems(page, totalPages).map((item, i) =>
                item === 'ellipsis' ? (
                  <span key={`ellipsis-${i}`} className={PAGER_ELLIPSIS_CLASS}>
                    …
                  </span>
                ) : item === page ? (
                  <span
                    key={item}
                    aria-current="page"
                    className={PAGER_ITEM_CURRENT_CLASS}
                  >
                    {item}
                  </span>
                ) : (
                  <SegPageLink key={item} surveyId={surveyId} page={item} disabled={false}>
                    {item}
                  </SegPageLink>
                ),
              )}
              <SegPageLink surveyId={surveyId} page={nav.next ?? totalPages} disabled={nav.next === null}>
                다음
              </SegPageLink>
              <PagerJump
                totalPages={totalPages}
                hrefTemplate={`${internalOperationsPaths(surveyId).mailCampaigns}?unsubPage=__PAGE__#unsubscribed`}
              />
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function SegPageLink({
  surveyId,
  page,
  disabled,
  children,
}: {
  surveyId: string;
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span aria-disabled="true" className={PAGER_ITEM_DISABLED_CLASS}>
        {children}
      </span>
    );
  }
  return (
    <Link
      href={`${internalOperationsPaths(surveyId).mailCampaigns}?unsubPage=${page}#unsubscribed`}
      className={PAGER_ITEM_CLASS}
    >
      {children}
    </Link>
  );
}
