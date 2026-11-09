import { ChevronDown } from 'lucide-react';

import { LocalDateTime } from '@/components/ui/local-date-time';
import { LINK_CONTACT_EDITOR_LABEL } from '@/shared/contracts/contacts';
import type { ResponseEditLogRow } from '@/shared/contracts/contacts-io';
import type { ResponseEditChange } from '@/shared/contracts/survey-response';

/** 바뀐 질문 요약 — 앞 3개 code/title + "외 N개". */
function summarizeChanges(changes: ResponseEditChange[], count: number): string {
  const labels = changes.slice(0, 3).map((c) => c.code ?? c.title);
  const head = labels.join(', ');
  if (count <= 3) return head ? `${head} 수정` : '응답 수정';
  return `${head} 외 ${count - 3}개 수정`;
}

interface Props {
  rows: ResponseEditLogRow[];
  /** 매칭된 응답이 있는지 (없으면 "매칭된 응답 없음" 안내). */
  hasResponse: boolean;
}

/**
 * 「응답 수정 / 편집 현황」 — 응답 편집 audit 이력, 기본 접힘 collapsible. 초기화 마커는 응답이
 * 삭제된 뒤에도 남는다. 대상 정보(명단 값·회차·컨택원) 변경은 「대상 정보 수정 현황」 카드가 보인다.
 */
export function ContactEditHistoryCard({ rows, hasResponse }: Props) {
  return (
    <details open={hasResponse || rows.length > 0} className="group rounded-lg border bg-white">
      <summary className="flex cursor-pointer items-center justify-between px-5 py-3 text-sm">
        <span className="flex items-center gap-1.5 font-medium text-slate-700">
          응답 수정 / 편집 현황 ({rows.length}건)
          <ChevronDown className="size-4 text-slate-400 transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="border-t px-5 py-3">
        {rows.length === 0 ? (
          <p className="text-sm text-slate-400">
            {hasResponse ? '수정 이력이 없습니다.' : '매칭된 응답이 없습니다.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.id} className="border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                <div className="text-sm text-slate-700">
                  {/* 링크가 고친 행 — 내부 콘솔은 서버가 「외주 · 이름표」를 채워 보내고, 외주 콘솔은
                      이메일을 걷어 보내 「외주」 하나로 읽힌다(fieldwork-multi-company 티켓 02). */}
                  {r.byFieldworkLink
                    ? (r.editorEmail ?? LINK_CONTACT_EDITOR_LABEL)
                    : (r.editorEmail ?? '관리자')}
                </div>
                <div className="text-xs text-slate-500">
                  <LocalDateTime value={r.createdAt} /> ·{' '}
                  {r.action === 'reset' ? (
                    <span className="font-medium text-red-600">
                      응답 내역 초기화 (복구 불가 삭제)
                    </span>
                  ) : r.action === 'reedit_allow' ? (
                    <span className="font-medium text-blue-600">
                      재응답 허용 (완료 응답을 진행중으로 전환)
                    </span>
                  ) : (
                    summarizeChanges(r.changedQuestions, r.changedCount)
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
