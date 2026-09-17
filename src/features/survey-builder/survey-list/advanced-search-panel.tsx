'use client';

import { X } from 'lucide-react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

import type { SurveyListAdvancedFilters, SurveyListDateField } from './survey-list-pipeline';

const DATE_FIELD_OPTIONS: { key: SurveyListDateField; label: string }[] = [
  { key: 'updatedAt', label: '수정일' },
  { key: 'createdAt', label: '생성일' },
  { key: 'endDate', label: '마감일' },
];

const VISIBILITY_OPTIONS: { key: 'team' | 'invite_only' | null; label: string }[] = [
  { key: null, label: '전체' },
  { key: 'team', label: '팀 공개' },
  { key: 'invite_only', label: '초대된 멤버만' },
];

const ALL_OWNERS_VALUE = '__all__';

interface AdvancedSearchPanelProps {
  advanced: SurveyListAdvancedFilters;
  onChange: (patch: Partial<SurveyListAdvancedFilters>) => void;
  onReset: () => void;
  onClose: () => void;
  owners: { id: string; name: string }[];
}

/**
 * 상세 검색 패널 (.pen FLOW 6 상세 검색) — 툴바 우측 버튼 아래 절대 위치.
 * 「미답변 문의 있는 설문만」 체크는 Plan 3 게이트로 미노출(티켓 08).
 * 필터는 입력 즉시 적용된다 — 닫기는 패널만 접는다.
 */
export function AdvancedSearchPanel({
  advanced,
  onChange,
  onReset,
  onClose,
  owners,
}: AdvancedSearchPanelProps) {
  return (
    <div className="absolute right-0 top-full z-20 mt-2 w-[400px] rounded-xl border border-[#E5E5EA] bg-white p-5 shadow-[0_10px_28px_rgba(13,27,76,0.15)]">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-[14px] font-semibold text-[#1C1C1E]">상세 검색</h3>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onReset}
            className="text-[12.5px] font-medium text-[#2E4FCE] hover:underline"
          >
            초기화
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="text-[#9CA3AF] hover:text-[#1C1C1E]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <div>
          <label className="mb-1.5 block text-[12.5px] font-medium text-[#374151]">기간</label>
          <div className="flex items-center gap-1.5">
            <Select
              value={advanced.dateField}
              onValueChange={(v) => onChange({ dateField: v as SurveyListDateField })}
            >
              <SelectTrigger className="h-9 w-[96px] shrink-0 rounded-[9px] border-[#E5E5EA] text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_FIELD_OPTIONS.map((opt) => (
                  <SelectItem key={opt.key} value={opt.key}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input
              type="date"
              value={advanced.dateFrom ?? ''}
              onChange={(e) => onChange({ dateFrom: e.target.value || null })}
              className="h-9 min-w-0 flex-1 rounded-[9px] border border-[#E5E5EA] px-2 text-[13px] text-[#1C1C1E]"
            />
            <span className="text-[#9CA3AF]">~</span>
            <input
              type="date"
              value={advanced.dateTo ?? ''}
              onChange={(e) => onChange({ dateTo: e.target.value || null })}
              className="h-9 min-w-0 flex-1 rounded-[9px] border border-[#E5E5EA] px-2 text-[13px] text-[#1C1C1E]"
            />
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-[12.5px] font-medium text-[#374151]">소유자</label>
          <Select
            value={advanced.ownerUserId ?? ALL_OWNERS_VALUE}
            onValueChange={(v) => onChange({ ownerUserId: v === ALL_OWNERS_VALUE ? null : v })}
          >
            <SelectTrigger className="h-9 w-full rounded-[9px] border-[#E5E5EA] text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_OWNERS_VALUE}>전체</SelectItem>
              {owners.map((owner) => (
                <SelectItem key={owner.id} value={owner.id}>
                  {owner.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="mb-1.5 block text-[12.5px] font-medium text-[#374151]">공개 범위</label>
          <div className="flex gap-[3px] rounded-[9px] bg-[#F5F5F7] p-[3px]">
            {VISIBILITY_OPTIONS.map((opt) => {
              const active = advanced.visibility === opt.key;
              return (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => onChange({ visibility: opt.key })}
                  className={cn(
                    'flex-1 rounded-[7px] py-1.5 text-[12.5px] transition-colors',
                    active
                      ? 'bg-white font-semibold text-[#2743AE] shadow-[0_1px_3px_rgba(0,0,0,0.1)]'
                      : 'text-[#6E6E73]',
                  )}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-[12.5px] font-medium text-[#374151]">응답 수</label>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={0}
              value={advanced.responsesMin ?? ''}
              onChange={(e) =>
                onChange({ responsesMin: e.target.value === '' ? null : Number(e.target.value) })
              }
              placeholder="최소"
              className="h-9 min-w-0 flex-1 rounded-[9px] border border-[#E5E5EA] px-2.5 text-[13px] text-[#1C1C1E]"
            />
            <span className="text-[#9CA3AF]">~</span>
            <input
              type="number"
              min={0}
              value={advanced.responsesMax ?? ''}
              onChange={(e) =>
                onChange({ responsesMax: e.target.value === '' ? null : Number(e.target.value) })
              }
              placeholder="최대"
              className="h-9 min-w-0 flex-1 rounded-[9px] border border-[#E5E5EA] px-2.5 text-[13px] text-[#1C1C1E]"
            />
          </div>
        </div>
      </div>

      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={onClose}
          className="h-9 rounded-[8px] bg-[#2E4FCE] px-4 text-[13px] font-semibold text-white hover:bg-[#2743AE]"
        >
          닫기
        </button>
      </div>
    </div>
  );
}
