'use client';

import { Clock, FileText, Loader2, RotateCcw } from 'lucide-react';

import { formatLocalDate } from '@/lib/date-formatters';
import type { SurveyListItem } from '@/shared/contracts/survey-builder-io';

interface DeletedSurveyCardProps {
  survey: SurveyListItem;
  onRestore: (surveyId: string) => void;
  isRestoring: boolean;
}

/**
 * 휴지통 카드 (역할 모델 v2 티켓 17).
 *
 * `SurveyCard` 의 모드가 아니라 **별개의 카드**다. 삭제된 설문에서 할 수 있는 일은 복구
 * 하나뿐이라 케밥·수정·현황·분석·공유가 전부 사라지는데, 그것을 한 컴포넌트 안에서
 * 분기하면 카드가 서로 무관한 두 이유로 바뀌는 파일이 된다. 열 수 없는 화면으로 가는
 * 링크를 비활성으로 그려두지도 않는다 — 여기서는 그 화면들이 아예 없다.
 *
 * 응답 수를 보여주는 이유는 그것이 복구 판단의 근거이기 때문이다. 삭제는 응답을 지우지
 * 않으므로(soft delete) "응답 1,200건이 딸린 설문" 과 "빈 설문" 은 다른 무게를 갖는다.
 */
export function DeletedSurveyCard({ survey, onRestore, isRestoring }: DeletedSurveyCardProps) {
  return (
    <div className="flex w-full flex-col gap-[9px] rounded-[14px] border border-[#E5E5EA] bg-[#FAFAFA] p-[18px]">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[#F1F1F3]">
          <FileText className="h-[21px] w-[21px] text-[#9CA3AF]" />
        </span>
        <h3 className="min-w-0 truncate text-[14.5px] font-semibold text-[#6E6E73]">
          {survey.title}
        </h3>
      </div>

      <p className="truncate text-[12.5px] text-[#6E6E73]">
        전체 응답 {survey.responseCount.toLocaleString('ko-KR')}건 · 완료{' '}
        {survey.completedResponseCount.toLocaleString('ko-KR')}건
      </p>

      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 truncate text-[11.5px] text-[#9CA3AF]">
          <Clock className="h-3 w-3 shrink-0" />
          삭제일: {survey.deletedAt ? formatLocalDate(survey.deletedAt) : '—'}
        </span>
        <span className="shrink-0 truncate text-[11.5px] text-[#9CA3AF]">
          {/* 소유 팀은 복구 뒤 이 설문이 어디로 돌아가는지를 말한다 — 해산된 팀이면 비어 있고,
              그 경우 복구된 설문은 배치 대기로 남아 재배치 센터가 받는다(티켓 14). */}
          {survey.teamName ?? '배치 대기'}
          {survey.ownerName ? ` · ${survey.ownerName}` : ''}
        </span>
      </div>

      <div className="border-t border-[#F0F0F2] pt-3">
        <button
          type="button"
          disabled={isRestoring}
          onClick={() => onRestore(survey.id)}
          className="flex h-8 w-full items-center justify-center gap-1.5 rounded-[9px] border border-[#E5E5EA] bg-white text-[12px] font-medium text-[#374151] transition-colors hover:bg-[#F5F5F7] disabled:cursor-not-allowed disabled:text-[#C7C7CC]"
        >
          {isRestoring ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RotateCcw className="h-3 w-3" />
          )}
          복구
        </button>
      </div>
    </div>
  );
}
