import { describe, expect, it } from 'vitest';

import { emptyUploadProblem } from './upload-limits';

describe('emptyUploadProblem — 적재할 행이 하나도 없는 업로드', () => {
  it('행이 있으면 문제가 아니다', () => {
    expect(emptyUploadProblem(1, 0)).toBeNull();
    expect(emptyUploadProblem(3, 12)).toBeNull();
  });

  it('데이터 행이 없는 파일은 거부 사유를 낸다', () => {
    expect(emptyUploadProblem(0, 0)).toContain('적재할 행이 없습니다');
  });

  it('숨겨진 행을 빼서 0행이 됐으면 몇 행이 빠졌는지와 푸는 방법을 알려 준다', () => {
    const message = emptyUploadProblem(0, 1234);
    expect(message).toContain('적재할 행이 없습니다');
    expect(message).toContain('1,234');
    expect(message).toContain('필터');
  });
});
