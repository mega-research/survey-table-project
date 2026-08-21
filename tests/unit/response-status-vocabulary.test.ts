import { describe, expect, it } from 'vitest';

import { ResumeStatusSchema } from '@/server/survey-response/domain/lifecycle';
import {
  concludedResponseStatusValues,
  isConcludedResponseStatus,
  isOpenResponseStatus,
  isResponseStatus,
  openResponseStatusValues,
  responseStatusValues,
} from '@/shared/contracts/survey-response';

// survey_responses.status 는 text 컬럼이라 DB 제약이 없다. 값 집합과 열림/종결 구분이
// 여러 파일의 리터럴로 흩어져 있던 것을 contracts 한 곳으로 모았으므로, 집합의 모양과
// 파생(z.enum)이 어긋나지 않는지 여기서 박제한다.
describe('responseStatusValues — survey_responses.status 어휘', () => {
  it('스키마 주석과 같은 6개 값을 같은 순서로 갖는다', () => {
    expect(responseStatusValues).toEqual([
      'in_progress',
      'completed',
      'screened_out',
      'quotaful_out',
      'bad',
      'drop',
    ]);
  });

  it('열림·종결은 서로 겹치지 않고 합치면 전체 어휘가 된다', () => {
    const open = new Set<string>(openResponseStatusValues);
    const concluded = new Set<string>(concludedResponseStatusValues);
    for (const s of open) expect(concluded.has(s)).toBe(false);
    expect(new Set([...open, ...concluded])).toEqual(new Set(responseStatusValues));
  });

  it('열림 상태는 in_progress 와 drop 이다 — drop 은 종결이 아니다', () => {
    expect(openResponseStatusValues).toEqual(['in_progress', 'drop']);
  });

  it('종결 상태는 completed·screened_out·quotaful_out·bad 다', () => {
    expect(concludedResponseStatusValues).toEqual([
      'completed',
      'screened_out',
      'quotaful_out',
      'bad',
    ]);
  });
});

describe('열림/종결 술어', () => {
  it('isOpenResponseStatus 는 열림 값에만 true', () => {
    for (const s of responseStatusValues) {
      expect(isOpenResponseStatus(s)).toBe(s === 'in_progress' || s === 'drop');
    }
  });

  it('isConcludedResponseStatus 는 종결 값에만 true', () => {
    for (const s of responseStatusValues) {
      expect(isConcludedResponseStatus(s)).toBe(!isOpenResponseStatus(s));
    }
  });

  it('알 수 없는 값은 열림도 종결도 아니다 — 화이트리스트', () => {
    for (const s of ['', 'weird_status', 'IN_PROGRESS', 'deleted', 'all']) {
      expect(isResponseStatus(s)).toBe(false);
      expect(isOpenResponseStatus(s)).toBe(false);
      expect(isConcludedResponseStatus(s)).toBe(false);
    }
  });
});

describe('파생 — domain ResumeStatusSchema', () => {
  it('z.enum 옵션이 어휘와 같다', () => {
    expect(ResumeStatusSchema.options).toEqual([...responseStatusValues]);
  });

  it('어휘 밖 값은 거부한다', () => {
    expect(ResumeStatusSchema.safeParse('weird_status').success).toBe(false);
    expect(ResumeStatusSchema.safeParse('drop').success).toBe(true);
  });
});
