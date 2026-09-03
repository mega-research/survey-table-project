import { describe, expect, it } from 'vitest';

import type { TableCell } from '@/types/survey';
import {
  restoreCellFromLibrary,
  sanitizeCellForLibrary,
} from '@/utils/cell-library-helpers';

describe('셀 보관함 스타일 왕복', () => {
  it('개별 셀 Bold와 배경색을 저장하고 다른 셀에 복원한다', () => {
    const source: TableCell = {
      id: 'source',
      type: 'text',
      content: '강조 셀',
      textBold: true,
      backgroundColor: '#AABBCC',
    };
    const target: TableCell = {
      id: 'target',
      type: 'text',
      content: '',
    };

    const restored = restoreCellFromLibrary(sanitizeCellForLibrary(source), target);

    expect(restored).toMatchObject({
      id: 'target',
      content: '강조 셀',
      textBold: true,
      backgroundColor: '#AABBCC',
    });
  });
});

describe('sanitizeCellForLibrary — 응답 인용 토글·이름 제거 (설문 전역 식별자)', () => {
  it('answerQuoteEnabled/answerQuoteName 을 제거한다', () => {
    const source: TableCell = {
      id: 'source',
      type: 'radio',
      content: '',
      answerQuoteEnabled: true,
      answerQuoteName: '마케팅유형',
      radioOptions: [{ id: 'o1', label: 'A', value: 'v1' }],
    };

    const sanitized = sanitizeCellForLibrary(source);

    expect(sanitized).not.toHaveProperty('answerQuoteEnabled');
    expect(sanitized).not.toHaveProperty('answerQuoteName');
  });

  it('answerQuoteText(문구)는 이름과 달리 위치 종속이 아니므로 보존한다', () => {
    const source: TableCell = {
      id: 'source',
      type: 'input',
      content: '',
      answerQuoteEnabled: true,
      answerQuoteName: '인력',
      answerQuoteText: '{{입력}}명',
    };

    const sanitized = sanitizeCellForLibrary(source);

    expect(sanitized).not.toHaveProperty('answerQuoteEnabled');
    expect(sanitized).not.toHaveProperty('answerQuoteName');
    expect(sanitized.answerQuoteText).toBe('{{입력}}명');
  });

  it('보관함에서 불러온 셀을 다른 곳에 복원해도 원본의 인용 이름이 옮겨붙지 않는다', () => {
    const source: TableCell = {
      id: 'source',
      type: 'radio',
      content: '',
      answerQuoteEnabled: true,
      answerQuoteName: '원본이름',
      radioOptions: [{ id: 'o1', label: 'A', value: 'v1' }],
    };
    const target: TableCell = { id: 'target', type: 'radio', content: '' };

    const restored = restoreCellFromLibrary(sanitizeCellForLibrary(source), target);

    expect(restored).not.toHaveProperty('answerQuoteEnabled');
    expect(restored).not.toHaveProperty('answerQuoteName');
  });
});
