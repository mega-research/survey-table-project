import { render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getTablePerfLog, useTablePerf } from '@/features/question-renderer/hooks/use-table-perf';

// 이 훅은 rAF 로 재는 바람에 "다음 프레임까지의 대기"를 렌더 비용으로 보고했다.
// 같은 커밋에서 형제 표가 여럿이면 값이 전부 부풀어 "표가 세션 후반에 10배 느려졌다"는
// 착시를 만들었다(2026-08-04). 커밋 직후 동기 시점에 재야 한다.
describe('useTablePerf', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let rafSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame');
  });
  afterEach(() => {
    logSpy.mockRestore();
    rafSpy.mockRestore();
  });

  function Probe({ withContainer = false }: { withContainer?: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    useTablePerf('Probe(1×1)', {
      enabled: true,
      ...(withContainer ? { containerRef: ref } : {}),
    });
    return (
      <div ref={ref}>
        <span data-grid-cell="1" />
      </div>
    );
  }

  it('프레임을 기다리지 않고 커밋 직후에 측정한다', () => {
    render(<Probe />);
    // rAF 를 쓰면 프레임 대기 시간이 렌더 비용으로 섞여 들어간다.
    expect(rafSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('측정값을 로그에 누적한다', () => {
    render(<Probe />);
    const log = getTablePerfLog();
    const last = log[log.length - 1];
    expect(last?.label).toBe('Probe(1×1)');
    expect(typeof last?.renderTime).toBe('number');
  });

  it('containerRef 가 없으면 문서 전체를 훑지 않는다', () => {
    // 측정 자체가 dev 를 느리게 만드는 관측자 효과를 막는다.
    const docSpy = vi.spyOn(document, 'querySelectorAll');
    render(<Probe />);
    expect(docSpy).not.toHaveBeenCalled();
    docSpy.mockRestore();
  });

  it('containerRef 를 주면 그 하위의 grid 셀만 센다', () => {
    render(<Probe withContainer />);
    const last = getTablePerfLog().at(-1);
    expect(last?.domNodes).toBe(1);
  });

  it('enabled=false 면 아무것도 로그하지 않는다', () => {
    function Disabled() {
      useTablePerf('Off', { enabled: false });
      return <div />;
    }
    render(<Disabled />);
    expect(logSpy).not.toHaveBeenCalled();
  });
});
