import { describe, expect, it } from 'vitest';

import type { RowRepeatConfig, TableRow } from '@/types/survey';

import { expandRepeatRows, remapRowRepeatIds } from './row-repeat';

/**
 * 질문 복제 — 행 id 가 전부 새로 발번되므로 반복 설정과 행의 원본 표식도 함께 옮겨야
 * 한다. 그러지 않으면 복제본의 설정이 원본 질문의 행을 가리켜 범위를 고칠 수도, 템플릿
 * 변경을 뒤 벌에 전파할 수도 없다.
 */
const config: RowRepeatConfig = { enabled: true, templateRowIds: ['tpl'], maxRepeats: 2 };

function expandedRows(): TableRow[] {
  let n = 0;
  return expandRepeatRows(
    [
      { id: 'head', label: '머리', cells: [{ id: 'h1', type: 'input', content: '' }] },
      { id: 'tpl', label: '성과', cells: [{ id: 't1', type: 'input', content: '' }] },
    ] as TableRow[],
    config,
    () => `gen${++n}`,
  );
}

/** 복제가 만드는 것과 같은 모양의 대응표 — 원본 행 id → 새 행 id */
function duplicate(rows: TableRow[]) {
  const rowIdMap = new Map<string, string>();
  const copied = rows.map((row, index) => {
    const newId = `dup${index + 1}`;
    rowIdMap.set(row.id, newId);
    return { ...row, id: newId };
  });
  return { copied, rowIdMap };
}

describe('remapRowRepeatIds', () => {
  it('설정의 템플릿 행 id 를 새 id 로 옮긴다', () => {
    const { copied, rowIdMap } = duplicate(expandedRows());
    const result = remapRowRepeatIds(copied, config, rowIdMap);
    expect(result.config).toEqual({ ...config, templateRowIds: [rowIdMap.get('tpl')] });
  });

  it('행의 원본 표식(repeatSourceRowId)도 새 id 를 가리킨다', () => {
    const { copied, rowIdMap } = duplicate(expandedRows());
    const result = remapRowRepeatIds(copied, config, rowIdMap);
    const sources = result.rows.filter((r) => r.repeatIndex).map((r) => r.repeatSourceRowId);
    expect(new Set(sources)).toEqual(new Set([rowIdMap.get('tpl')]));
  });

  it('옮긴 뒤에도 구조가 온전해 다시 펼치면 기존 벌을 재사용한다', () => {
    const { copied, rowIdMap } = duplicate(expandedRows());
    const result = remapRowRepeatIds(copied, config, rowIdMap);
    let n = 0;
    const again = expandRepeatRows(result.rows, result.config, () => `late${++n}`);
    expect(again.map((r) => r.id)).toEqual(result.rows.map((r) => r.id));
  });

  it('반복 설정이 없으면 행도 설정도 그대로 둔다', () => {
    const { copied, rowIdMap } = duplicate(expandedRows());
    const result = remapRowRepeatIds(copied, undefined, rowIdMap);
    expect(result.rows).toBe(copied);
    expect(result.config).toBeNull();
  });

  it('대응표에 없는 id 는 건드리지 않는다', () => {
    const { copied } = duplicate(expandedRows());
    const result = remapRowRepeatIds(copied, config, new Map());
    expect(result.config).toEqual(config);
  });
});
