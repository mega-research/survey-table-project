import { describe, it, expect } from 'vitest';

import { resolvePastedGating } from '@/components/survey-builder/utils/drag-copy-utils';
import type { CellEnableCondition } from '@/types/survey';

const condition: CellEnableCondition = {
  kind: 'option',
  controllerCellId: 'src-ctrl',
  values: ['1'],
};

describe('resolvePastedGating — 붙여넣기/복제 시 게이팅 참조 재해석', () => {
  it('영역 내 컨트롤러는 리매핑된 id 로 치환된다', () => {
    const out = resolvePastedGating(condition, 'target-ctrl', new Set(['x']));
    expect(out).toEqual({ kind: 'option', controllerCellId: 'target-ctrl', values: ['1'] });
  });

  it('영역 밖이지만 대상 행에 있으면(같은 행 이동) 유지된다', () => {
    const out = resolvePastedGating(condition, undefined, new Set(['src-ctrl', 'x']));
    expect(out).toBe(condition);
  });

  it('다른 행의 컨트롤러는 제거된다 (undefined)', () => {
    const out = resolvePastedGating(condition, undefined, new Set(['x', 'y']));
    expect(out).toBeUndefined();
  });

  it('numeric 조건도 op/value 를 보존한 채 리매핑된다', () => {
    const numeric: CellEnableCondition = {
      kind: 'numeric',
      controllerCellId: 'src-ctrl',
      op: '>=',
      value: 3,
    };
    const out = resolvePastedGating(numeric, 'new-ctrl', new Set());
    expect(out).toEqual({ kind: 'numeric', controllerCellId: 'new-ctrl', op: '>=', value: 3 });
  });
});
