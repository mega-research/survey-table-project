import { describe, expect, it } from 'vitest';

import { generateAllCellCodes, generateExportLabel } from '@/utils/table-cell-code-generator';

describe('generateExportLabel', () => {
  it('질문 SPSS 변수명(questionCode)_열라벨_행라벨 형식으로 생성한다', () => {
    expect(generateExportLabel('Q3', '2020년 매출액', '기업 전체')).toBe(
      'Q3_2020년 매출액_기업 전체',
    );
  });

  it('질문 제목이 아니라 questionCode를 쓴다 (길어지지 않게)', () => {
    // 과거: `${questionTitle}_...` → 현재: `${questionCode}_...`
    expect(generateExportLabel('Q9', '구입량', '소나무')).toBe('Q9_구입량_소나무');
  });

  it('필수 요소가 하나라도 없으면 undefined', () => {
    expect(generateExportLabel(undefined, '2020', '기업')).toBeUndefined();
    expect(generateExportLabel('Q3', undefined, '기업')).toBeUndefined();
    expect(generateExportLabel('Q3', '2020', undefined)).toBeUndefined();
  });

  it('테이블 자동생성은 표시 라벨이 비어 있으면 rowCode/columnCode로 exportLabel을 만든다', () => {
    const rows = generateAllCellCodes(
      'Q3',
      '문3',
      [{ id: 'c1', label: '', columnCode: 'sales2020' }],
      [
        {
          id: 'r1',
          label: '',
          rowCode: 'total',
          cells: [{ id: 'cell1', type: 'input', content: '' }],
        },
      ],
    );

    expect(rows[0]!.cells[0]!.exportLabel).toBe('Q3_sales2020_total');
    expect(rows[0]!.cells[0]!.isCustomExportLabel).toBe(false);
  });
});
