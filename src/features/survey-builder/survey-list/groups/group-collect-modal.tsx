'use client';

import { useMemo, useState } from 'react';

import { Loader2, Search } from 'lucide-react';

import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { formatLocalDate } from '@/lib/date-formatters';
import { getErrorMessage } from '@/lib/get-error-message';
import { cn } from '@/lib/utils';
import type { SurveyGroupListItem } from '@/shared/contracts/workspace-io';

import { useCollectSurveysIntoGroup, useUngroupedSurveys } from '../../queries/use-survey-groups';

interface GroupCollectModalProps {
  teamId: string;
  group: SurveyGroupListItem;
  onClose: () => void;
}

/**
 * 「설문 담기」 패널 (.pen FLOW 2-2) — 미분류 설문 일괄 추가.
 *
 * 후보를 미분류로 좁힌 것이 이 화면의 정의다. 다른 그룹의 설문까지 나오면 목록이 길어지고,
 * 체크 한 번으로 남의 그룹에서 빼오는 암묵 이동이 생긴다. 그룹 간 이동은 카드 케밥의 단건
 * 동선(FLOW 2-4)만 쓴다.
 *
 * `canMove` 는 서버 판정 그대로다 — 선택 비활성은 화면 배려일 뿐이고, 서버가 담기 요청에서
 * 설문마다 다시 묻는다.
 */
export function GroupCollectModal({ teamId, group, onClose }: GroupCollectModalProps) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useUngroupedSurveys(teamId, query.trim(), true);
  const collect = useCollectSurveysIntoGroup();

  const candidates = useMemo(() => data ?? [], [data]);
  // 검색으로 후보가 바뀌어도 이미 고른 것은 유지한다. 담기 대상은 지금 보이는 목록이
  // 아니라 사용자가 고른 집합이다.
  const selectedIds = useMemo(() => [...selected], [selected]);

  function toggle(surveyId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(surveyId)) next.delete(surveyId);
      else next.add(surveyId);
      return next;
    });
  }

  async function handleSubmit() {
    if (selectedIds.length === 0) return;
    setError(null);
    try {
      await collect.mutateAsync({ groupId: group.id, surveyIds: selectedIds });
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, '설문을 담지 못했습니다.'));
    }
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-[520px] gap-0 rounded-2xl p-[22px]">
        <DialogTitle className="text-[17px] font-semibold text-[#1C1C1E]">
          「{group.name}」에 설문 담기
        </DialogTitle>
        <p className="mt-[3px] text-[12.5px] text-[#6E6E73]">
          미분류 설문만 표시됩니다. 체크한 설문이 이 그룹으로 이동합니다.
        </p>

        <div className="mt-3.5 flex items-center gap-2 rounded-[9px] border border-[#E5E5EA] px-3 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-[#9CA3AF]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="미분류 설문 검색"
            maxLength={100}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[#1C1C1E] outline-none placeholder:text-[#9CA3AF]"
          />
        </div>

        <div className="mt-3 flex max-h-[320px] flex-col gap-2 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-[#9CA3AF]" />
            </div>
          ) : candidates.length === 0 ? (
            <p className="py-10 text-center text-[12.5px] text-[#9CA3AF]">
              {query.trim() ? '검색 결과가 없습니다.' : '담을 수 있는 미분류 설문이 없습니다.'}
            </p>
          ) : (
            candidates.map((item) => {
              const checked = selected.has(item.id);
              return (
                <label
                  key={item.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-2.5 rounded-[10px] border border-[#E5E5EA] px-3 py-2.5',
                    !item.canMove && 'cursor-not-allowed opacity-55',
                  )}
                >
                  <Checkbox
                    checked={checked}
                    disabled={!item.canMove}
                    onCheckedChange={() => toggle(item.id)}
                  />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-[#1C1C1E]">
                    {item.title}
                  </span>
                  <span className="shrink-0 text-[11.5px] text-[#9CA3AF]">
                    {item.canMove ? `수정일: ${formatLocalDate(item.updatedAt)}` : '편집 권한 없음'}
                  </span>
                </label>
              );
            })
          )}
        </div>

        {error && <p className="mt-2.5 text-[12.5px] text-red-600">{error}</p>}

        <div className="mt-3.5 flex items-center justify-between gap-2">
          <span className="text-[12.5px] font-medium text-[#374151]">
            {selectedIds.length}개 선택
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex h-[34px] items-center rounded-[9px] border border-[#E5E5EA] bg-white px-4 text-[13px] font-medium text-[#374151] hover:bg-[#F5F5F7]"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={selectedIds.length === 0 || collect.isPending}
              className="flex h-[34px] items-center gap-1.5 rounded-[9px] bg-[#2E4FCE] px-4 text-[13px] font-semibold text-white hover:bg-[#2743AE] disabled:cursor-not-allowed disabled:bg-[#E5E7EB] disabled:text-[#9CA3AF]"
            >
              {collect.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {selectedIds.length}개 담기
            </button>
          </div>
        </div>

        <p className="mt-3 text-[11.5px] leading-relaxed text-[#9CA3AF]">
          미분류 설문만 담을 수 있습니다. 다른 그룹에 있는 설문은 설문 카드의 그룹 이동으로 단건
          이동하세요. 편집 권한이 없는 설문은 선택할 수 없습니다.
        </p>
      </DialogContent>
    </Dialog>
  );
}
