/**
 * 테이블 렌더링 성능 측정 훅 (개발 전용)
 * Before/After 비교를 위한 정량 지표 수집
 */
import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

interface PerfMetrics {
  label: string;
  /** 렌더 시작부터 DOM 커밋까지(ms). 페인트 대기는 포함하지 않는다. */
  renderTime: number;
  /** containerRef 를 준 경우에만 측정. 없으면 null. */
  domNodes: number | null;
  timestamp: number;
}

export interface TablePerfOptions {
  /**
   * 측정 대상 컨테이너. 주면 그 하위의 grid 셀 수를 함께 기록한다.
   * 문서 전체를 훑지 않는 이유는 측정 자체가 dev 를 느리게 만들기 때문이다.
   */
  containerRef?: RefObject<HTMLElement | null>;
  enabled?: boolean;
}

const MAX_PERF_LOG_SIZE = 200;
const perfLog: PerfMetrics[] = [];

/**
 * 컴포넌트의 렌더 + DOM 커밋 소요 시간 측정 (개발 전용).
 *
 * useLayoutEffect 는 이 컴포넌트의 DOM 커밋 직후·페인트 전에 동기 실행된다.
 * 예전에는 rAF 로 쟀는데, 그러면 "다음 프레임이 올 때까지의 대기"가 값에 섞인다.
 * 한 커밋에서 형제 표가 여럿이면 각자 시작 시각은 다른데 rAF 는 같은 프레임에 한꺼번에
 * 발화하므로 먼저 렌더된 것일수록 값이 커지고, 메인 스레드가 붐빌수록 전부 부풀었다.
 * 실제로 이 때문에 "표가 세션 후반에 10배 느려졌다" 는 오진이 나왔다(2026-08-04).
 */
export function useTablePerf(label: string, options: TablePerfOptions = {}): void {
  const { containerRef, enabled = process.env.NODE_ENV === 'development' } = options;

  // 렌더 시작 시각은 렌더 중에 읽을 수밖에 없다. 측정 전용이라 렌더 결과에 영향을 주지 않는다.
  // eslint-disable-next-line react-hooks/purity
  const renderStart = performance.now();

  useLayoutEffect(() => {
    if (!enabled) return;

    const duration = performance.now() - renderStart;
    const domNodes = containerRef?.current
      ? containerRef.current.querySelectorAll('[data-grid-cell]').length
      : null;

    const metrics: PerfMetrics = {
      label,
      renderTime: Math.round(duration * 10) / 10,
      domNodes,
      timestamp: Date.now(),
    };

    if (perfLog.length >= MAX_PERF_LOG_SIZE) {
      perfLog.splice(0, perfLog.length - MAX_PERF_LOG_SIZE + 1);
    }
    perfLog.push(metrics);

    console.log(
      `[TablePerf] ${label}: ${metrics.renderTime}ms (렌더+커밋)`
        + (domNodes === null ? '' : ` | DOM nodes: ${domNodes}`),
    );
  });
}

/**
 * 스크롤 FPS 측정
 */
export function useScrollFps(
  scrollRef: React.RefObject<HTMLElement | null>,
  enabled = process.env.NODE_ENV === 'development',
) {
  const frameTimestamps = useRef<number[]>([]);
  const rafId = useRef<number>(0);
  const isScrolling = useRef(false);

  const measureFrame = useCallback(
    // 명명 함수 표현식: rAF 재귀 자기참조가 외부 const 선언(TDZ)에 묶이지 않도록 한다
    function measureFrame() {
      frameTimestamps.current.push(performance.now());
      if (isScrolling.current) {
        rafId.current = requestAnimationFrame(measureFrame);
      }
    },
    [],
  );

  useEffect(() => {
    if (!enabled) return;
    const el = scrollRef.current;
    if (!el) return;

    const onScrollStart = () => {
      if (!isScrolling.current) {
        isScrolling.current = true;
        frameTimestamps.current = [];
        rafId.current = requestAnimationFrame(measureFrame);
      }
    };

    let scrollTimeout: ReturnType<typeof setTimeout>;
    const onScroll = () => {
      onScrollStart();
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        isScrolling.current = false;
        cancelAnimationFrame(rafId.current);

        const timestamps = frameTimestamps.current;
        if (timestamps.length > 1) {
          const durations: number[] = [];
          for (let i = 1; i < timestamps.length; i++) {
            durations.push(timestamps[i]! - timestamps[i - 1]!);
          }
          const avgFrameTime = durations.reduce((a, b) => a + b, 0) / durations.length;
          const fps = Math.round(1000 / avgFrameTime);
          const minFps = Math.round(1000 / Math.max(...durations));
          console.log(
            `[ScrollFPS] avg: ${fps}fps | min: ${minFps}fps | frames: ${timestamps.length}`,
          );
        }
      }, 150);
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(rafId.current);
      clearTimeout(scrollTimeout);
    };
  }, [enabled, scrollRef, measureFrame]);
}

/**
 * 수집된 모든 메트릭 반환 (콘솔에서 호출용)
 */
export function getTablePerfLog() {
  return [...perfLog];
}

/**
 * Before/After 비교 테이블 출력 (콘솔에서 호출용)
 */
export function printPerfComparison() {
  const grouped = new Map<string, PerfMetrics[]>();
  for (const m of perfLog) {
    const arr = grouped.get(m.label) ?? [];
    arr.push(m);
    grouped.set(m.label, arr);
  }

  console.table(
    Array.from(grouped.entries()).map(([label, metrics]) => {
      const avgRender = metrics.reduce((s, m) => s + m.renderTime, 0) / metrics.length;
      const lastDomNodes = metrics[metrics.length - 1]?.domNodes ?? '—';
      return {
        label,
        '평균 렌더+커밋(ms)': Math.round(avgRender * 10) / 10,
        'DOM 노드': lastDomNodes,
        '측정 횟수': metrics.length,
      };
    }),
  );
}

// 개발 콘솔에서 접근 가능하도록 전역 등록
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  // 개발용 전역 훅 — window 에 디버그 함수 두 개만 노출한다
  const devWindow = window as Window & {
    __tablePerfLog?: typeof getTablePerfLog;
    __tablePerfCompare?: typeof printPerfComparison;
  };
  devWindow.__tablePerfLog = getTablePerfLog;
  devWindow.__tablePerfCompare = printPerfComparison;
}
