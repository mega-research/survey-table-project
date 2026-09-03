import { describe, expect, it } from 'vitest';

import { nextUniqueOptionNumber } from '@/utils/option-code-generator';

/**
 * 옵션 value 발번 유틸 회귀 테스트.
 *
 * 배경: 선택 응답은 option.value 로 키잉된다. 기존 발번이 length+1 기반이라
 * 중간 옵션을 삭제한 뒤 추가하면 기존 value 와 충돌 — 같은 셀의 두 라디오가
 * 같은 선택키를 공유해 A 를 누르면 B 가 켜지는 오작동이 난다 (Cb3 제주/세종 사례).
 */
describe('nextUniqueOptionNumber', () => {
  it('삭제 이력이 없으면 length+1 을 그대로 쓴다', () => {
    const opts = [{ value: 'option-1' }, { value: 'option-2' }];
    expect(nextUniqueOptionNumber(opts, 'option-')).toBe(3);
  });

  it('중간 삭제 후에는 충돌을 건너뛰고 다음 번호를 발번한다', () => {
    // option-2 삭제됨 → length+1=3 인데 option-3 이 이미 존재
    const opts = [{ value: 'option-1' }, { value: 'option-3' }];
    expect(nextUniqueOptionNumber(opts, 'option-')).toBe(4);
  });

  it('연쇄 충돌도 모두 건너뛴다', () => {
    const opts = [{ value: 'option-2' }, { value: 'option-3' }, { value: 'option-4' }];
    expect(nextUniqueOptionNumber(opts, 'option-')).toBe(5);
  });

  it('빈 목록은 1 을 반환한다', () => {
    expect(nextUniqueOptionNumber([], 'option-')).toBe(1);
  });

  it('한글 prefix (질문 레벨 옵션) 도 동일하게 동작한다', () => {
    const opts = [{ value: '옵션1' }, { value: '옵션3' }];
    expect(nextUniqueOptionNumber(opts, '옵션')).toBe(4);
  });

  it('빈 prefix (숫자 문자열 value) 도 동일하게 동작한다', () => {
    const opts = [{ value: '1' }, { value: '3' }];
    expect(nextUniqueOptionNumber(opts, '')).toBe(4);
  });

  it('다른 형식의 value 는 충돌로 치지 않는다', () => {
    const opts = [{ value: 'option-3' }, { value: '기타' }];
    expect(nextUniqueOptionNumber(opts, '')).toBe(3);
  });

  it('value 가 없는 옵션이 섞여 있어도 동작한다', () => {
    const opts = [{ value: 'option-1' }, {}];
    expect(nextUniqueOptionNumber(opts as { value?: string }[], 'option-')).toBe(3);
  });
});
