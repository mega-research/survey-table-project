import { describe, expect, it } from 'vitest';

import type { QuestionOption } from '@/types/survey';

import { matchPrefillOption, resolveChoicePrefill } from './choice-prefill';

const opt = (
  value: string,
  label: string,
  extra: Partial<QuestionOption> = {},
): QuestionOption => ({
  id: `o${value}`,
  value,
  label,
  ...extra,
});

const programs = [
  opt('1', '① 예술분야 초기창업 지원사업', { spssNumericCode: 1 }),
  opt('2', '② 예술분야 창업도약 지원사업', { spssNumericCode: 2 }),
  opt('3', '③ 예술분야 성장도약 지원사업', { spssNumericCode: 3 }),
];

describe('matchPrefillOption', () => {
  it('문구에 명단 값이 들어 있는 보기가 하나뿐이면 그 보기', () => {
    expect(matchPrefillOption(programs, '초기창업')?.value).toBe('1');
    expect(matchPrefillOption(programs, ' 창업도약 ')?.value).toBe('2');
    expect(matchPrefillOption(programs, '성장도약')?.value).toBe('3');
  });

  it('보기 값·코드·번호를 뗀 문구가 같으면 그 보기', () => {
    expect(matchPrefillOption(programs, '2')?.value).toBe('2');
    expect(matchPrefillOption(programs, '예술분야 성장도약 지원사업')?.value).toBe('3');
  });

  it('여럿이 맞거나 하나도 안 맞으면 고르지 않는다', () => {
    expect(matchPrefillOption(programs, '지원사업')).toBeNull();
    expect(matchPrefillOption(programs, '기타사업')).toBeNull();
    expect(matchPrefillOption(programs, '   ')).toBeNull();
  });

  it('보기 값이 정확히 같으면 포함 관계보다 앞선다', () => {
    const opts = [opt('A', 'A형'), opt('B', 'A형 아님')];
    expect(matchPrefillOption(opts, 'A')?.value).toBe('A');
  });
});

describe('resolveChoicePrefill', () => {
  const q = { type: 'radio' as const, options: programs, defaultValueTemplate: '{{지원사업}}' };

  it('명단 값으로 보기 값을 낸다', () => {
    expect(resolveChoicePrefill(q, { 지원사업: '창업도약' })).toBe('2');
  });

  it('템플릿·명단 값이 없으면 null', () => {
    expect(
      resolveChoicePrefill({ ...q, defaultValueTemplate: null }, { 지원사업: '창업도약' }),
    ).toBeNull();
    expect(resolveChoicePrefill(q, {})).toBeNull();
    expect(resolveChoicePrefill(q, null)).toBeNull();
  });

  it('단일선택이 아니면 null', () => {
    expect(resolveChoicePrefill({ ...q, type: 'checkbox' }, { 지원사업: '창업도약' })).toBeNull();
  });
});
