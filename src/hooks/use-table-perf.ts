/**
 * 테이블 렌더링 성능 측정 훅 (개발 전용)
 * Before/After 비교를 위한 정량 지표 수집
 */
import { useCallback, useEffect, useRef } from 'react';

interface PerfMetrics {
  label: string;
  renderTime: number;
  domNodes: number;
  timestamp: number;
}

const MAX_PERF_LOG_SIZE = 200;
const perfLog: PerfMetrics[] = [];

/**
 * 컴포넌트 렌더링 시간 측정
 * React Profiler onRender와 유사하지만 DOM 커밋 후 시점까지 포함
 */
export function useTablePerf(label: string, enabled = process.env.NODE_ENV === 'development') {
  const renderStart = useRef(performance.now());

  // 매 렌더마다 시작 시간 갱신
  renderStart.current = performance.now();

  useEffect(() => {
    if (!enabled) return;

    const start = renderStart.current;

    // rAF: 브라우저가 실제 페인트 직전에 호출 → DOM 커밋 완료 시점
    const rafId = requestAnimationFrame(() => {
      const duration = performance.now() - start;
      const domNodes = document.querySelectorAll('[data-grid-cell]').length;

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
        `[TablePerf] ${label}: ${metrics.renderTime}ms | DOM nodes: ${metrics.domNodes}`,
      );
    });

    return () => cancelAnimationFrame(rafId);
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
      const lastDomNodes = metrics[metrics.length - 1]?.domNodes ?? 0;
      return {
        label,
        '평균 렌더(ms)': Math.round(avgRender * 10) / 10,
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
