'use client';

import { useSearchParamsMutator } from '@/features/operations/hooks/use-search-params-mutator';
import { cn } from '@/lib/utils';

export interface GroupByOption {
  /** 직렬화된 분류 키 — attrs 키는 그대로, 시스템 기준은 `system:<이름>` */
  key: string;
  label: string;
  /** 주소에 groupBy 가 없을 때 꺼진 채로 나오는 칩 (예: 컨택원). */
  defaultOff?: boolean;
}

interface Props {
  options: GroupByOption[];
  /** 현재 활성 분류 키 목록 */
  activeKeys: string[];
}

/**
 * 진척보고 분류 기준 전환 칩 (다중 선택, 좁혀보기용).
 *
 * - 기본 진입은 page RSC 가 지정된 기준 전체를 자동 선택 — 칩은 일부만 보고 싶을 때
 *   끄는 용도. 최소 1개는 유지 (마지막 칩은 꺼지지 않음).
 * - URL `?groupBy=키1,키2` — 순서는 옵션(컬럼 설정) 순서로 정규화.
 * - 기준 변경 시 page 초기화, 필터(col/q)·정렬은 유지.
 */
export function ProgressGroupByTabs({ options, activeKeys }: Props) {
  const pushParams = useSearchParamsMutator();

  const toggle = (key: string) => {
    const next = activeKeys.includes(key)
      ? activeKeys.filter((k) => k !== key)
      : [...activeKeys, key];
    // 옵션(컬럼 설정) 순서로 정규화 — URL 이 클릭 순서에 좌우되지 않게
    const ordered = options.map((o) => o.key).filter((k) => next.includes(k));
    // 최소 1개 유지 — 단 기본으로 켜지는 칩이 하나도 없으면(컨택원 칩만 있는 설문) 마지막 칩을
    // 끄는 것은 기본 화면(업로드 그룹 기준)으로 돌아가는 일이라 주소에서 기준을 지운다.
    if (ordered.length === 0 && options.some((o) => !o.defaultOff)) return;
    pushParams((p) => {
      if (ordered.length === 0) p.delete('groupBy');
      else p.set('groupBy', ordered.join(','));
      p.delete('page');
    });
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs text-slate-500">분류 기준</span>
      {options.map((o) => {
        const isActive = activeKeys.includes(o.key);
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => toggle(o.key)}
            aria-pressed={isActive}
            className={cn(
              'rounded-full px-3 py-1 text-xs',
              isActive
                ? 'bg-blue-500 font-medium text-white'
                : 'border border-slate-200 text-slate-600 hover:bg-slate-50',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
