import { describe, expect, it } from 'vitest';

import { computeColumnPageTarget } from '@/components/question-renderer/table-scroll-controls';

// "다음 두 열 중앙 정렬" 페이징:
// ▶ = 우측에서 잘려 보이던 열 + 그다음 열을 뷰 가운데에 배치
//    [전혀|별로|보..] → [..로|보통|약간|매..] (양옆 대칭 걸침)
// ◀ = 대칭: 좌측 잘린 열 + 그 이전 열을 가운데에 배치

describe('computeColumnPageTarget', () => {
  // 5열 × 120px, 뷰포트 332px — 두 열(240px) 중앙 정렬 시 양옆 여백 46px
  const stops = [0, 120, 240, 360, 480, 600];
  const vw = 332;

  it('▶: 잘린 열 + 다음 열을 뷰 가운데에 놓는다', () => {
    // 시작 [0,332]: 보통(240~360) 잘림 → [보통,약간](240~480) 중앙 → 240-46=194
    expect(computeColumnPageTarget(0, 1, stops, vw)).toBe(194);
  });

  it('▶: 끝에 가까우면 최대 스크롤로 클램프된다', () => {
    // [194,526]: 매우(480~600) 잘림 → [매우](480~600) 중앙 374 → max 268
    expect(computeColumnPageTarget(194, 1, stops, vw)).toBe(268);
    // 우측 끝이 정확히 경계(360)면 다음 숨은 열부터 → [약간,매우] 중앙 314 → max 268
    expect(computeColumnPageTarget(28, 1, stops, vw)).toBe(268);
  });

  it('◀: 좌측 잘린 열 + 이전 열을 뷰 가운데에 놓는다', () => {
    // [268,600]: 보통(240~360) 좌측 잘림 → [별로,보통](120~360) 중앙 → 120-46=74
    expect(computeColumnPageTarget(268, -1, stops, vw)).toBe(74);
    // [74,406]: 전혀(0~120) 좌측 잘림 → [전혀](0~120) 중앙 음수 → 0 클램프
    expect(computeColumnPageTarget(74, -1, stops, vw)).toBe(0);
  });

  it('◀: 좌측이 경계에 정렬된 상태면 그 앞 두 열 기준으로 후퇴한다', () => {
    // [240,572]: 좌측 정렬 → [전혀,별로](0~240) 중앙 음수 → 0 클램프
    expect(computeColumnPageTarget(240, -1, stops, vw)).toBe(0);
    expect(computeColumnPageTarget(0, -1, stops, vw)).toBe(0);
  });

  it('두 열 합이 뷰포트보다 넓으면 경계 정렬/뷰포트 폭 이동으로 폴백한다', () => {
    const wide = [0, 800, 1600];
    // ▶: 페어(0~1600)가 뷰포트(300)보다 넓음 → 좌측 정렬 0 = 제자리 → +뷰포트 폭
    expect(computeColumnPageTarget(0, 1, wide, 300)).toBe(300);
    // ◀: 우측 정렬 500 = 제자리 → -뷰포트 폭
    expect(computeColumnPageTarget(500, -1, wide, 300)).toBe(200);
  });
});
