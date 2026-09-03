import { describe, expect, it } from 'vitest';

import type { SPSSExportColumn } from '@/lib/analytics/spss-excel-export';
import { generateSavBuffer } from '@/lib/spss/sav-builder';
import { assertValidSpssVarNames, isSpssVarNameError, SpssVarNameError } from '@/lib/spss/variable-name-guard';
import { validateSpssVarName } from '@/lib/spss/variable-validator';
import type { Question } from '@/types/survey';
import { sanitizeSpssVarName } from '@/utils/spss-var-name';

function makeCol(spssVarName: string, questionText = '질문'): SPSSExportColumn {
  return { spssVarName, questionText, optionLabel: '', questionId: 'q1', type: 'single' };
}

describe('assertValidSpssVarNames', () => {
  it('전부 유효하면 통과한다', () => {
    expect(() =>
      assertValidSpssVarNames([makeCol('Q1'), makeCol('I1_r3_c2'), makeCol('Q2_opt4_text')]),
    ).not.toThrow();
  });

  it('한글 변수명은 SpssVarNameError를 던진다', () => {
    expect(() => assertValidSpssVarNames([makeCol('문항1')])).toThrow(SpssVarNameError);
  });

  it('대시 변수명을 거부한다 — sanitize 미스매치로 컬럼 전손되던 케이스', () => {
    try {
      assertValidSpssVarNames([makeCol('Q-1', '성별')]);
      expect.unreachable('던져야 한다');
    } catch (e) {
      const err = e as SpssVarNameError;
      expect(err.issues).toHaveLength(1);
      expect(err.issues[0]!.varName).toBe('Q-1');
      expect(err.issues[0]!.questionText).toBe('성별');
      expect(err.issues[0]!.reason).toContain('허용되지 않는 문자');
    }
  });

  it('대소문자 무시 중복을 거부한다', () => {
    try {
      assertValidSpssVarNames([makeCol('Q1'), makeCol('q1')]);
      expect.unreachable('던져야 한다');
    } catch (e) {
      const err = e as SpssVarNameError;
      expect(err.issues).toHaveLength(1);
      expect(err.issues[0]!.reason).toContain('중복');
    }
  });

  it('에러 메시지는 최대 5건 나열 후 외 N건으로 줄인다', () => {
    const cols = Array.from({ length: 7 }, (_, i) => makeCol(`문${i + 1}`));
    try {
      assertValidSpssVarNames(cols);
      expect.unreachable('던져야 한다');
    } catch (e) {
      const err = e as SpssVarNameError;
      expect(err.issues).toHaveLength(7);
      expect(err.message).toContain('외 2건');
    }
  });
});

describe('가드 불변식 - 검증 통과 = sanitize no-op', () => {
  it('validateSpssVarName을 통과하는 이름은 sanitizeSpssVarName이 바꾸지 않는다', () => {
    const candidates = [
      'Q1', 'Q1_SUB', 'I1_r3_c2', 'Q2_opt4_text', 'a', 'Z9_x_1',
      'Q1__a', 'Q1_', '_Q1', 'Q-1', '문항1', 'q'.padEnd(65, '1'),
    ];
    for (const name of candidates) {
      const { valid } = validateSpssVarName(name);
      if (valid) {
        expect(sanitizeSpssVarName(name), `'${name}' 불변식 위반`).toBe(name);
      }
    }
  });
});

describe('generateSavBuffer 가드 연결', () => {
  it('invalid 변수명이 있으면 .sav 생성 전에 SpssVarNameError를 던진다', async () => {
    const question = {
      id: 'q1',
      type: 'text',
      title: '이름',
      required: false,
      order: 1,
      questionCode: 'Q-1',
      isCustomSpssVarName: true,
    } as unknown as Question;

    await expect(generateSavBuffer([question], [])).rejects.toThrow(SpssVarNameError);
  });
});

describe('isSpssVarNameError - 구조 판별', () => {
  it('자기 모듈 인스턴스를 판별한다', () => {
    try {
      assertValidSpssVarNames([makeCol('Q-1')]);
      expect.unreachable('던져야 한다');
    } catch (e) {
      expect(isSpssVarNameError(e)).toBe(true);
    }
  });

  it('다른 모듈 그래프에서 생성된 동형 에러도 판별한다 - dev HMR instanceof 어긋남 대응', () => {
    const foreign = Object.assign(new Error('SPSS 변수명 오류 1건'), {
      name: 'SpssVarNameError',
      issues: [{ varName: 'Q-1', questionText: '질문', reason: '허용되지 않는 문자' }],
    });
    expect(foreign instanceof SpssVarNameError).toBe(false);
    expect(isSpssVarNameError(foreign)).toBe(true);
  });

  it('일반 에러와 비에러 값은 거부한다', () => {
    expect(isSpssVarNameError(new Error('boom'))).toBe(false);
    expect(isSpssVarNameError(Object.assign(new Error('x'), { name: 'SpssVarNameError' }))).toBe(false);
    expect(isSpssVarNameError(null)).toBe(false);
    expect(isSpssVarNameError('SpssVarNameError')).toBe(false);
  });
});
