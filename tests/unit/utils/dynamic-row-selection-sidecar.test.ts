import { describe, expect, it } from 'vitest';

import {
  DYNAMIC_ROW_SELECTIONS_KEY,
  getDynamicRowSelections,
  updateDynamicRowSelections,
} from '@/utils/dynamic-row-selection-sidecar';

describe('동적 행 선택 루트 사이드카', () => {
  it('문항 응답 shape와 분리해 질문별 선택을 읽고 갱신한다', () => {
    const responses = {
      choice: ['choice-cell'],
      [DYNAMIC_ROW_SELECTIONS_KEY]: {
        choice: ['row-2'],
        other: ['row-9'],
      },
    };

    expect(getDynamicRowSelections(responses, 'choice')).toEqual(['row-2']);
    expect(
      updateDynamicRowSelections(
        responses[DYNAMIC_ROW_SELECTIONS_KEY],
        'choice',
        ['row-1', 'row-1'],
      ),
    ).toEqual({
      choice: ['row-1'],
      other: ['row-9'],
    });
    expect(responses.choice).toEqual(['choice-cell']);
  });
});
