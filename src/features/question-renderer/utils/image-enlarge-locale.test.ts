import { describe, expect, it } from 'vitest';

import { enlargeTriggerLabel } from './image-enlarge';

describe('enlargeTriggerLabel — 크게 보기 버튼 이름의 언어', () => {
  it('언어를 주지 않으면 지금 한국어 그대로다', () => {
    expect(enlargeTriggerLabel('지도')).toBe('지도 크게 보기');
    expect(enlargeTriggerLabel('  ')).toBe('이미지 크게 보기');
  });

  it('현재 언어로 이름을 짓고 대체 텍스트는 그대로 둔다', () => {
    expect(enlargeTriggerLabel('Map', 'en')).toBe('Enlarge Map');
    expect(enlargeTriggerLabel('', 'en')).toBe('Enlarge image');
    expect(enlargeTriggerLabel('地图', 'zh')).toBe('放大查看地图');
    expect(enlargeTriggerLabel('', 'zh')).toBe('放大查看图片');
  });
});
