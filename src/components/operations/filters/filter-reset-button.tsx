'use client';

import { useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { Button } from '@/components/ui/button';
import { useSearchParamsMutator } from '@/hooks/use-search-params-mutator';

interface Props {
  /** 초기화 시 제거할 URL 파라미터 이름 목록 — page 계열까지 호출부가 명시한다. */
  clearParams: string[];
  /**
   * 활성(누를 수 있음) 판정 대상 파라미터. 미지정 시 clearParams 전체.
   * page 계열은 필터가 아니므로 여기서 제외해 넘긴다 — 페이지만 이동한 상태에서
   * 초기화가 활성으로 보이면 "필터가 걸려 있다"는 오신호가 된다.
   */
  activeParams?: string[];
  /** URL 정리와 함께 수행할 로컬 state 정리 (예: 필터바의 미검색 입력값). */
  onReset?: () => void;
  /** 버튼 라벨 — 문맥상 "초기화"가 모호한 곳(마법사 선택 해제 옆)만 바꾼다. */
  label?: string;
  className?: string;
  size?: 'sm' | 'default';
}

/**
 * 목록 필터 일괄 초기화 버튼 — 헤더 깔때기(hcol/hm/hv)·필터 빌더(col/q/op)·
 * 페이지 전용 파라미터를 한 번에 URL 에서 제거한다.
 *
 * 어떤 파라미터를 지울지는 화면마다 다르므로 호출부가 명시한다. 필터가 하나도
 * 없으면 비활성 — 눌러도 변화가 없는 버튼을 활성으로 두지 않는다.
 */
export function FilterResetButton({
  clearParams,
  activeParams,
  onReset,
  label = '초기화',
  className,
  size = 'default',
}: Props) {
  const searchParams = useSearchParams();
  const pushParams = useSearchParamsMutator();
  const [, startTransition] = useTransition();

  const watched = activeParams ?? clearParams;
  const active = watched.some((k) => searchParams.has(k));

  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      className={className}
      disabled={!active}
      onClick={() => {
        startTransition(() => {
          pushParams((p) => {
            for (const k of clearParams) p.delete(k);
          });
        });
        onReset?.();
      }}
    >
      {label}
    </Button>
  );
}
