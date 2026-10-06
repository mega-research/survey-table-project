import { describe, expect, it } from 'vitest';

import {
  describePiiFormatProblems,
  normalizePii,
  piiFormatProblem,
  type PiiFieldType,
} from '@/lib/crypto/pii-fields';

describe('normalizePii', () => {
  it('빈/공백 값은 빈 문자열로 정규화한다', () => {
    expect(normalizePii('name', '')).toBe('');
    expect(normalizePii('name', '   ')).toBe('');
  });

  it('email 은 소문자화하고 최소 형식 검증한다', () => {
    expect(normalizePii('email', '  Foo@Bar.com ')).toBe('foo@bar.com');
    // local 또는 domain 누락 / TLD 없음 → 빈 문자열
    expect(normalizePii('email', '@bar.com')).toBe('');
    expect(normalizePii('email', 'foo@')).toBe('');
    expect(normalizePii('email', 'foo@bar')).toBe('');
  });

  it('전화/사업자번호는 숫자만 남긴다', () => {
    expect(normalizePii('mobile', '010-1234-5678')).toBe('01012345678');
    expect(normalizePii('phone', '(02) 123-4567')).toBe('021234567');
    expect(normalizePii('biz_number', '123-45-67890')).toBe('1234567890');
  });

  it('이름/담당자/주소는 연속 공백을 단일 공백으로 합친다', () => {
    expect(normalizePii('name', '홍   길동')).toBe('홍 길동');
    expect(normalizePii('address', '서울시   강남구\t역삼동')).toBe('서울시 강남구 역삼동');
  });

  it('union 외 fieldType(경계 z.custom 통과분)도 빈 문자열을 반환하지 않고 공백 정규화로 폴백한다', () => {
    // 회귀: default 가 없으면 switch 를 빠져나가 undefined 를 반환하여
    // blindIndex 가 빈 문자열이 되고 PII 가 조용히 누락됐다.
    const unknown = 'Email' as unknown as PiiFieldType; // 대문자 등 union 외 값
    const result = normalizePii(unknown, '  hello   world ');
    expect(result).toBe('hello world');
    expect(result).not.toBe('');
    expect(result).toBeDefined();
  });
});

/**
 * 값이 있는데 정규화하면 비는 값 — 저장할 수 없는 형식이다. 이런 값을 그대로 저장 경로에 넘기면
 * 「빈 값」으로 취급되어 기존 암호화 행이 지워진다(2026-10-06 실사고: `@` 없는 메일을 넣고 저장하니
 * 「저장 완료」가 뜨고 값은 사라짐). 화면과 서버가 이 판정 하나로 저장 전에 막는다.
 */
describe('piiFormatProblem — 값은 있는데 저장할 수 없는 형식', () => {
  it('메일: @ 가 없거나 앞뒤가 비었거나 도메인에 점이 없으면 문제다', () => {
    for (const value of ['dream-elec.co.kr', 'foo@', '@bar.com', 'foo@bar']) {
      expect(piiFormatProblem('email', value)).toMatch(/메일 형식/);
    }
  });

  it('메일: 형식이 맞으면 문제없다', () => {
    expect(piiFormatProblem('email', ' Foo@Bar.co.kr ')).toBeNull();
  });

  it('전화·휴대폰·사업자번호: 숫자가 하나도 없으면 문제다', () => {
    expect(piiFormatProblem('phone', '없음')).toMatch(/숫자/);
    expect(piiFormatProblem('mobile', '-')).toMatch(/숫자/);
    expect(piiFormatProblem('biz_number', '미등록')).toMatch(/숫자/);
    expect(piiFormatProblem('phone', '02-2065-6131')).toBeNull();
  });

  it('빈 값은 문제가 아니다 — 칸을 비우는 것은 지우겠다는 뜻이다', () => {
    expect(piiFormatProblem('email', '')).toBeNull();
    expect(piiFormatProblem('email', '   ')).toBeNull();
    expect(piiFormatProblem('phone', '')).toBeNull();
  });

  it('이름·담당자·주소는 값이 있으면 언제나 저장할 수 있다', () => {
    expect(piiFormatProblem('name', '홍길동')).toBeNull();
    expect(piiFormatProblem('address', '-')).toBeNull();
  });
});

describe('describePiiFormatProblems — 변경분 묶음에서 문제 칸만 문구로', () => {
  const updates = [
    { columnKey: '이메일1', fieldType: 'email' as const, plain: 'dream-elec.co.kr' },
    { columnKey: '이메일2', fieldType: 'email' as const, plain: 'a@b.co.kr' },
    { columnKey: '연락처2', fieldType: 'phone' as const, plain: '없음' },
    { columnKey: '연락처3', fieldType: 'phone' as const, plain: '' },
  ];

  it('문제 있는 칸마다 한 줄 — 칸 이름을 앞에 붙인다', () => {
    const lines = describePiiFormatProblems(updates);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^「이메일1」 .*메일 형식/);
    expect(lines[1]).toMatch(/^「연락처2」 .*숫자/);
  });

  it('칸 이름을 바꿔 붙일 수 있다 (화면은 컬럼 라벨을 쓴다)', () => {
    const lines = describePiiFormatProblems(updates, (key) => `라벨:${key}`);
    expect(lines[0]).toMatch(/^「라벨:이메일1」/);
  });

  it('문제가 없으면 빈 목록', () => {
    expect(describePiiFormatProblems([updates[1]!, updates[3]!])).toEqual([]);
  });
});
