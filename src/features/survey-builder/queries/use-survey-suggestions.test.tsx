import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SurveySuggestion } from '@/shared/contracts/survey-builder-io';
import { orpc } from '@/shared/lib/rpc';

import { useSurveySuggestions } from './use-survey-suggestions';

vi.mock('@/shared/lib/rpc', () => ({
  orpc: { surveyBuilder: { read: { suggest: { call: vi.fn() } } } },
}));

const call = vi.mocked(orpc.surveyBuilder.read.suggest.call);

function row(id: string): SurveySuggestion {
  return { id, cardTitle: `설문 ${id}`, ownerName: '김은철', lifecycle: 'running' };
}

/** 부를 때마다 끝나지 않은 요청 하나 — 테스트가 골라서 끝낸다. */
function deferredCalls() {
  const pending: {
    q: string;
    signal: AbortSignal | undefined;
    resolve: (rows: SurveySuggestion[]) => void;
    reject: (err: unknown) => void;
  }[] = [];
  call.mockImplementation(
    ((input: { q: string }, options?: { signal?: AbortSignal }) =>
      new Promise<SurveySuggestion[]>((resolve, reject) => {
        pending.push({ q: input.q, signal: options?.signal, resolve, reject });
      })) as never,
  );
  return pending;
}

function setup(initial: { q: string; enabled?: boolean }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(
    ({ q, enabled = true }: { q: string; enabled?: boolean }) =>
      useSurveySuggestions({ scope: 'team-1', q, enabled }),
    { wrapper, initialProps: initial },
  );
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** 요청을 끝내고 TanStack Query 의 알림(타이머)까지 흘려보낸다. */
async function settle(finish: () => void) {
  await act(async () => {
    finish();
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe('useSurveySuggestions — 자동완성 설문 후보', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    call.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('타이핑이 200ms 멈추면 마지막 검색어로 한 번만 묻는다', async () => {
    const pending = deferredCalls();
    const { rerender } = setup({ q: 'a' });
    await advance(100);
    rerender({ q: 'a사' });
    await advance(100);
    rerender({ q: 'a사 실' });
    await advance(199);
    expect(call).not.toHaveBeenCalled();
    await advance(1);
    expect(call).toHaveBeenCalledTimes(1);
    expect(pending[0]?.q).toBe('a사 실');
  });

  it('후보는 그 검색어의 응답이 왔을 때만 보인다', async () => {
    const pending = deferredCalls();
    const { result } = setup({ q: 'a사' });
    expect(result.current.suggestions).toBeNull();
    await advance(200);
    await settle(() => pending[0]!.resolve([row('s1')]));
    expect(result.current.suggestions).toEqual([row('s1')]);
  });

  it('새 글자가 오면 앞선 요청을 취소하고, 늦게 온 앞 검색어 결과는 버린다', async () => {
    const pending = deferredCalls();
    const { result, rerender } = setup({ q: 'a사' });
    await advance(200);
    expect(pending).toHaveLength(1);

    rerender({ q: 'a사 실' });
    await advance(0);
    expect(pending[0]?.signal?.aborted).toBe(true);
    // 취소된 요청이 뒤늦게 결과를 내도 지금 검색어의 후보로 보이지 않는다.
    await settle(() => pending[0]!.resolve([row('old')]));
    expect(result.current.suggestions).toBeNull();

    await advance(200);
    expect(pending[1]?.q).toBe('a사 실');
    await settle(() => pending[1]!.resolve([row('new')]));
    expect(result.current.suggestions).toEqual([row('new')]);
  });

  it('공백만 다른 검색어는 같은 검색어다 — 다시 묻지 않는다', async () => {
    const pending = deferredCalls();
    const { result, rerender } = setup({ q: 'a사 실' });
    await advance(200);
    await settle(() => pending[0]!.resolve([row('s1')]));
    rerender({ q: ' a사  실 ' });
    await advance(200);
    expect(call).toHaveBeenCalledTimes(1);
    expect(result.current.suggestions).toEqual([row('s1')]);
  });

  it('같은 검색어로 돌아오면 캐시를 쓴다', async () => {
    const pending = deferredCalls();
    const { result, rerender } = setup({ q: 'a' });
    await advance(200);
    await settle(() => pending[0]!.resolve([row('a')]));
    rerender({ q: 'ab' });
    await advance(200);
    await settle(() => pending[1]!.resolve([row('ab')]));
    rerender({ q: 'a' });
    await advance(200);
    expect(call).toHaveBeenCalledTimes(2);
    expect(result.current.suggestions).toEqual([row('a')]);
  });

  it('실패하면 후보가 비고(null) 오류를 던지지 않는다', async () => {
    const pending = deferredCalls();
    const { result } = setup({ q: 'a사' });
    await advance(200);
    await settle(() => pending[0]!.reject(new Error('down')));
    expect(result.current.suggestions).toBeNull();
    expect(result.current.isPending).toBe(false);
  });

  it('꺼져 있거나 빈 검색어면 묻지 않는다', async () => {
    deferredCalls();
    const { rerender } = setup({ q: 'a사', enabled: false });
    await advance(500);
    rerender({ q: '   ', enabled: true });
    await advance(500);
    expect(call).not.toHaveBeenCalled();
  });
});
