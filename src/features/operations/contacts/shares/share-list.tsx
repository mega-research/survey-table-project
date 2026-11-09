import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import type { FieldworkShareLinkRow } from '@/shared/contracts/contacts-io';

import { shareEditHref } from './share-hrefs';

const fmt = (n: number) => n.toLocaleString('ko-KR');

function fmtDate(d: Date): string {
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface Props {
  surveyId: string;
  links: FieldworkShareLinkRow[];
}

/**
 * 외주 담당 범위 목록 — 이 설문의 열린 외주 링크마다 이름표·범위·마지막 적용 (ADR-0035).
 *
 * 나누지 않은 링크는 **설문 전체**를 본다 — 업체가 둘 이상이면 건네기 전에 나눠야 한다는 사실을
 * 그대로 적는다. 나눈 링크는 0명이어도 0명이다(빼앗긴 쪽이 전체로 넓어지지 않는다).
 */
export function ShareList({ surveyId, links }: Props) {
  if (links.length === 0) {
    return (
      <div className="rounded-lg border bg-white px-6 py-10 text-center text-sm text-slate-500">
        열린 외주 링크가 없습니다. 공유 설정의 「외주」에서 업체마다 링크를 발급한 뒤 여기서 나눕니다.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            <th className="px-4 py-2.5 text-left font-medium">외주 링크</th>
            <th className="px-4 py-2.5 text-left font-medium">담당 범위</th>
            <th className="px-4 py-2.5 text-left font-medium">마지막 적용</th>
            <th className="px-4 py-2.5" aria-label="동작" />
          </tr>
        </thead>
        <tbody className="divide-y">
          {links.map((link) => (
            <tr key={link.linkId}>
              <td className="px-4 py-3 font-medium text-slate-900">{link.name}</td>
              <td className="px-4 py-3">
                {link.divided ? (
                  <span className="text-slate-700">나눔 · {fmt(link.count)}명</span>
                ) : (
                  <span className="text-slate-500">설문 전체 (나누지 않음)</span>
                )}
              </td>
              <td className="px-4 py-3 text-slate-500">
                {link.appliedAt ? fmtDate(link.appliedAt) : '—'}
              </td>
              <td className="px-4 py-3 text-right">
                <Link
                  href={shareEditHref(surveyId, link.linkId)}
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  aria-label={`${link.name} 담당 범위 ${link.divided ? '수정' : '나누기'}`}
                >
                  {link.divided ? '수정' : '나누기'}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
