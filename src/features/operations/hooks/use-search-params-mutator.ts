'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

/**
 * 현재 URL 의 `searchParams` 를 mutate 한 뒤 같은 path 로 client-side push 하는 헬퍼.
 *
 * 운영 현황 콘솔(operations) 의 차트 위젯들이 day/hour 모드, weekOffset, dwellOffset
 * 같은 쿼리 파라미터를 갱신할 때 동일 idiom 을 반복 사용하던 패턴을 추출한 것이다:
 *
 * 1. `useSearchParams()` 의 ReadonlyURLSearchParams 를 가변 `URLSearchParams` 로 복제
 * 2. 호출자가 set/delete 으로 mutate
 * 3. 결과 qs 를 path 와 합쳐 `router.push(..., { scroll: false })`
 *
 * 다른 쿼리 파라미터는 그대로 보존되며, qs 가 비면 `?` 없이 path 만 push 한다.
 *
 * 사용 예:
 *   const pushParams = useSearchParamsMutator();
 *   pushParams((p) => {
 *     p.set('mode', 'day');
 *     p.delete('date');
 *   });
 */
export function useSearchParamsMutator(): (
  mutate: (params: URLSearchParams) => void,
) => void {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams?.toString() ?? '');
      mutate(next);
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname ?? '', { scroll: false });
    },
    [pathname, router, searchParams],
  );
}
