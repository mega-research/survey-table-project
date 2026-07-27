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
