import { describe, expect, it } from 'vitest';

import type { Question } from '@/types/survey';

import { normalizeFormatValues } from './format-normalize';

const textQ = (over: Partial<Question> = {}): Question =>
  ({ id: 'q1', type: 'text', title: '휴대전화', required: false, order: 0, ...over }) as Question;

describe('normalizeFormatValues', () => {
  it('단답형 형식 값을 정규형으로 정돈한다', () => {
    const q = textQ({ inputType: 'mobile' });
    expect(normalizeFormatValues([q], { q1: '01012345678' })).toEqual({ q1: '010-1234-5678' });
  });

  it('형식이 틀린 값은 손대지 않는다 — 차단이 이미 판단했거나 관리자가 통과시킨 값이다', () => {
    const q = textQ({ inputType: 'mobile' });
    expect(normalizeFormatValues([q], { q1: '+81 90 1234 5678' })).toEqual({
      q1: '+81 90 1234 5678',
    });
  });

  it('토큰 프리필로 잠긴 칸은 손대지 않는다 — 화면에 보이는 값과 갈라지면 안 된다', () => {
    const q = textQ({ inputType: 'mobile', defaultValueTemplate: '{{휴대전화}}' });
    expect(normalizeFormatValues([q], { q1: '010 1234 5678' })).toEqual({ q1: '010 1234 5678' });
  });

  it('이월 원본 그대로인 값은 손대지 않는다', () => {
    const q = textQ({ inputType: 'mobile' });
    const payload = { q1: '01012345678' };
    expect(normalizeFormatValues([q], payload, { q1: '01012345678' })).toEqual(payload);
  });

  it('형식이 아닌 문항·빈 값은 그대로 두고 객체 참조도 유지한다', () => {
    const q = textQ({ inputType: 'number' });
    const payload = { q1: '1234' };
    expect(normalizeFormatValues([q], payload)).toBe(payload);
    const q2 = textQ({ inputType: 'mobile' });
    const empty = { q1: '' };
    expect(normalizeFormatValues([q2], empty)).toBe(empty);
  });

  it('표 input 셀을 정돈한다', () => {
    const q = {
      id: 'qt',
      type: 'table',
      title: '표',
      required: false,
      order: 0,
      tableRowsData: [
        {
          id: 'r1',
          cells: [
            { id: 'c1', type: 'input', content: '', inputType: 'phone' },
            { id: 'c2', type: 'input', content: '', inputType: 'email' },
            { id: 'c3', type: 'input', content: '' },
          ],
        },
      ],
    } as unknown as Question;
    expect(
      normalizeFormatValues([q], { qt: { c1: '021234567', c2: ' A@B.CO.KR ', c3: '021234567' } }),
    ).toEqual({ qt: { c1: '02-123-4567', c2: 'a@b.co.kr', c3: '021234567' } });
  });

  it('보기 상세기재 사이드카를 정돈한다', () => {
    const q = {
      id: 'qc',
      type: 'checkbox',
      title: '연락처',
      required: false,
      order: 0,
      options: [
        { id: 'o1', label: '휴대', value: '1', allowTextInput: true, textInputType: 'mobile' },
        { id: 'o2', label: '기타', value: '2', allowTextInput: true },
      ],
    } as unknown as Question;
    expect(
      normalizeFormatValues([q], {
        qc: ['1', '2'],
        __optTexts__: { qc: { o1: '010 1234 5678', o2: '010 1234 5678' } },
      }),
    ).toEqual({
      qc: ['1', '2'],
      __optTexts__: { qc: { o1: '010-1234-5678', o2: '010 1234 5678' } },
    });
  });

  it('보기-소스 표의 input 셀도 사이드카에서 정돈한다', () => {
    const q = {
      id: 'qs',
      type: 'radio',
      title: '보기 표',
      required: false,
      order: 0,
      tableColumns: [{ id: 'col1', label: '선택' }],
      tableRowsData: [
        {
          id: 'r1',
          cells: [
            { id: 'src', type: 'choice_opt', content: '보기' },
            { id: 'tel', type: 'input', content: '', inputType: 'phone' },
          ],
        },
      ],
    } as unknown as Question;
    expect(
      normalizeFormatValues([q], { qs: 'src', __optTexts__: { qs: { tel: '0212345678' } } }),
    ).toEqual({ qs: 'src', __optTexts__: { qs: { tel: '02-1234-5678' } } });
  });
});
