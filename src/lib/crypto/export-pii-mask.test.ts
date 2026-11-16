import { describe, expect, it } from 'vitest';

import type { Question } from '@/types/survey';

import {
  collectPiiAnswerFormats,
  maskContactPiiValues,
  maskExportValue,
  maskPiiAnswers,
} from './export-pii-mask';

describe('maskExportValue', () => {
  it('형식 없는 글자(성명 등)는 마지막 글자 하나만 가린다', () => {
    expect(maskExportValue('홍길동', undefined)).toBe('홍길*');
    expect(maskExportValue('홍길동', 'text')).toBe('홍길*');
    expect(maskExportValue('Kim', undefined)).toBe('Ki*');
    expect(maskExportValue('김', undefined)).toBe('*');
    expect(maskExportValue('  남궁민수 ', undefined)).toBe('남궁민*');
  });

  it('전화·휴대전화·이메일·사업자번호는 조사 대상 목록과 같은 마스킹 힌트를 쓴다', () => {
    expect(maskExportValue('02-345-6789', 'phone')).toBe('02-345...');
    expect(maskExportValue('010-2233-4455', 'mobile')).toBe('010-22...');
    expect(maskExportValue('asdf@naver.com', 'email')).toBe('asd...@nav...');
    expect(maskExportValue('123-45-67890', 'biz_number')).toBe('123-45...');
  });

  it('값이 그 형식이 아니어도 평문으로 새지 않는다 — 마지막 글자 가리기로 내려간다', () => {
    expect(maskExportValue('담당자메일없음', 'email')).toBe('담당자메일없*');
    expect(maskExportValue('1234', 'phone')).toBe('123*');
  });

  it('빈 값은 그대로 둔다', () => {
    expect(maskExportValue('', 'email')).toBe('');
    expect(maskExportValue('   ', undefined)).toBe('   ');
  });
});

const questions = [
  { id: 'q-name', type: 'text', piiEncrypted: true },
  { id: 'q-mail', type: 'text', piiEncrypted: true, inputType: 'email' },
  { id: 'q-plain', type: 'text' },
  {
    id: 'q-table',
    type: 'table',
    tableRowsData: [
      {
        id: 'r1',
        cells: [
          { id: 'c-dept', type: 'input' },
          { id: 'c-tel', type: 'input', inputType: 'phone', piiEncrypted: true },
          { id: 'c-name', type: 'input', piiEncrypted: true },
          // 입력 칸이 아니면 표시가 있어도 대상이 아니다(저장 암호화와 같은 규칙)
          { id: 'c-label', type: 'text', piiEncrypted: true },
        ],
      },
    ],
  },
] as unknown as Question[];

describe('collectPiiAnswerFormats · maskPiiAnswers', () => {
  const formats = collectPiiAnswerFormats(questions);

  it('개인정보 표시가 붙은 문항과 표 입력 칸만 모은다', () => {
    expect([...formats.questions.keys()]).toEqual(['q-name', 'q-mail']);
    expect([...(formats.cells.get('q-table')?.keys() ?? [])]).toEqual(['c-tel', 'c-name']);
  });

  it('표시된 자리만 가리고 나머지 답은 그대로 둔다', () => {
    const responses = {
      'q-name': '홍길동',
      'q-mail': 'asdf@naver.com',
      'q-plain': '경영지원팀 과장',
      'q-table': { 'c-dept': '연구소/책임', 'c-tel': '02-345-6789', 'c-name': '김영희' },
      __optTexts__: { 'q-plain': { o1: '기타 의견' } },
    };
    const masked = maskPiiAnswers(responses, formats);
    expect(masked).toEqual({
      'q-name': '홍길*',
      'q-mail': 'asd...@nav...',
      'q-plain': '경영지원팀 과장',
      'q-table': { 'c-dept': '연구소/책임', 'c-tel': '02-345...', 'c-name': '김영*' },
      __optTexts__: { 'q-plain': { o1: '기타 의견' } },
    });
    // 원본은 바꾸지 않는다
    expect(responses['q-name']).toBe('홍길동');
    expect(responses['q-table']['c-name']).toBe('김영희');
  });

  it('답이 없거나 글자가 아니면 건드리지 않는다', () => {
    expect(maskPiiAnswers({ 'q-table': null, 'q-name': 3 }, formats)).toEqual({
      'q-table': null,
      'q-name': 3,
    });
  });

  it('표시된 자리가 하나도 없으면 원본을 그대로 돌려준다', () => {
    const responses = { 'q-plain': '값' };
    expect(maskPiiAnswers(responses, collectPiiAnswerFormats([]))).toBe(responses);
  });
});

describe('maskPiiAnswers — 저장된 값이 암호문이던 자리', () => {
  const formats = collectPiiAnswerFormats(questions);
  // 접두사만 보면 된다 — 실제 암호문일 필요가 없다.
  const CIPHER = 'v1:aaaa';

  it('지금 구조에 표시가 없어도 암호문으로 저장돼 있던 문항·칸은 가린다', () => {
    const plain = {
      'q-plain': '박민수',
      'q-table': { 'c-dept': '기획팀/대리', 'c-tel': '02-345-6789' },
      'q-gone': '삭제된 문항의 답',
    };
    const stored = {
      'q-plain': CIPHER,
      'q-table': { 'c-dept': CIPHER, 'c-tel': CIPHER },
      'q-gone': '삭제된 문항의 답',
    };
    expect(maskPiiAnswers(plain, formats, stored)).toEqual({
      'q-plain': '박민*',
      // 형식을 아는 칸은 그 규칙, 표시가 꺼진 칸은 마지막 글자 — 한 자리는 한 번만 가린다
      'q-table': { 'c-dept': '기획팀/대*', 'c-tel': '02-345...' },
      'q-gone': '삭제된 문항의 답',
    });
  });

  it('구조에 표시가 하나도 없어도 저장된 암호문 자리만으로 가린다', () => {
    const none = collectPiiAnswerFormats([]);
    expect(maskPiiAnswers({ a: '홍길동', b: '그대로' }, none, { a: CIPHER, b: '그대로' })).toEqual({
      a: '홍길*',
      b: '그대로',
    });
  });

  it('표시된 자리는 평문으로 저장돼 있었어도 가린다 — 표시를 켜기 전 응답·이월 응답', () => {
    expect(
      maskPiiAnswers({ 'q-name': '홍길동' }, formats, { 'q-name': '홍길동' })['q-name'],
    ).toBe('홍길*');
    expect(maskPiiAnswers({ 'q-name': '홍길동' }, formats, null)['q-name']).toBe('홍길*');
  });
});

describe('maskContactPiiValues', () => {
  it('명단의 개인정보 열만 그 종류의 규칙으로 가린다 — 성명은 마지막 글자만', () => {
    const masked = maskContactPiiValues(
      { 'attrs.업체명': '메가유업', 'pii.담당자': '홍길동', 'pii.연락처': '010-2233-4455', 'pii.기타': '비고' },
      new Map([
        ['pii.담당자', 'name'],
        ['pii.연락처', 'mobile'],
        ['pii.기타', undefined],
      ]),
    );
    expect(masked).toEqual({
      'attrs.업체명': '메가유업',
      'pii.담당자': '홍길*',
      'pii.연락처': '010-22...',
      'pii.기타': '비*',
    });
  });
});
