/**
 * 운영 현황 콘솔(operations) 차트 색 토큰.
 *
 * recharts `ChartConfig.color` 에 직접 들어가는 단일 진실원.
 * 프로젝트 전역 globals.css 에 `--chart-*` CSS 변수가 정의되기 전까지
 * 색상 hardcode 분산을 막기 위해 모듈 export 로 통합한다.
 *
 * 변경 시 영향 범위:
 *   - A2 daily-participation-chart   (BLUE_500)
 *   - A5 drop-funnel                 (ROSE_400)
 *   - A6 page-dwell-distribution     (BLUE_500)
 */

/** Tailwind blue-500 근사. A2 / A6 에서 monochromatic blue 톤 막대 색상. */
export const CHART_COLOR_BLUE_500 = 'hsl(217, 91%, 60%)';

/** Tailwind rose-400 근사. A5 drop funnel 의 부정 톤 강조 색상. */
export const CHART_COLOR_ROSE_400 = 'hsl(351, 83%, 70%)';
