import { render } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  ChartContainer,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';

// ChartTooltipContent 의 default 분기에서 값 0 이 falsy-zero 로 숨겨지지 않는지 회귀 검증.
// formatter 미지정(default 분기)일 때 item.value === 0 도 '0' 으로 렌더돼야 한다.
// (recharts ResponsiveContainer 가 jsdom 에서 ResizeObserver 를 요구하므로 stub.)

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === 'undefined') {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
      ResizeObserverStub;
  }
});

const config: ChartConfig = {
  count: { label: '응답 수', color: '#3b82f6' },
};

function renderTooltip(value: number) {
  // ChartContainer 가 ChartContext 를 제공한다. ChartTooltipContent 를 active
  // payload 와 함께 직접 렌더하면 formatter 미지정 → default 분기(falsy-zero
  // 위치) 코드가 실행된다.
  return render(
    <ChartContainer config={config}>
      <ChartTooltipContent
        active
        payload={[
          {
            dataKey: 'count',
            name: 'count',
            value,
            color: '#3b82f6',
            payload: { count: value, fill: '#3b82f6' },
          } as never,
        ]}
      />
    </ChartContainer>,
  );
}

describe('ChartTooltipContent 0 값 렌더', () => {
  it('값이 0 이어도 숫자 0 을 표시한다 (falsy-zero 숨김 방지)', () => {
    const { container } = renderTooltip(0);
    const valueSpan = container.querySelector('span.tabular-nums');
    expect(valueSpan).not.toBeNull();
    expect(valueSpan?.textContent).toBe('0');
  });

  it('양수 값도 그대로 표시한다', () => {
    const { container } = renderTooltip(1234);
    const valueSpan = container.querySelector('span.tabular-nums');
    expect(valueSpan).not.toBeNull();
    expect(valueSpan?.textContent).toBe('1,234');
  });
});
