import { describe, expect, it } from 'vitest';

import type { QuestionOption, TableCell } from '@/types/survey';

import {
  changeContentType,
  changeGatingCondition,
  editCellCode,
  editExportLabel,
  resetCellCode,
  resetExportLabel,
  toggleMerge,
  toggleNumberMode,
} from './cell-form-transitions';
import { type CellFormState, cellToFormState } from './serialize-cell';

function formOf(cell: Partial<TableCell> = {}): CellFormState {
  return cellToFormState({ id: 'c1', type: 'text', content: '', ...cell });
}

const DEFAULT_RANKING_OPTIONS: QuestionOption[] = [
  { id: 'o1', label: '옵션 1', value: 'opt1', spssNumericCode: 1 },
  { id: 'o2', label: '옵션 2', value: 'opt2', spssNumericCode: 2 },
];
const NO_AUTO = { autoCellCode: undefined, autoExportLabel: undefined };

describe('changeContentType — 셀 유형 전환', () => {
  it('입력형으로 바꾸면 비어 있는 SPSS 타입·측정 수준을 추론하고, 있는 값은 둔다', () => {
    const next = changeContentType(formOf(), 'radio', NO_AUTO);
    expect(next.contentType).toBe('radio');
    expect(next.spssVarType).toBe('Numeric');
    expect(next.spssMeasure).toBeDefined();

    const kept = changeContentType(formOf({ spssVarType: 'String' }), 'radio', NO_AUTO);
    expect(kept.spssVarType).toBe('String');
  });

  it('입력형이 아닌 유형으로 바꾸면 SPSS 타입·측정 수준을 비운다', () => {
    const next = changeContentType(
      formOf({ type: 'input', spssVarType: 'String', spssMeasure: 'Nominal' }),
      'text',
      NO_AUTO,
    );
    expect(next.spssVarType).toBeUndefined();
    expect(next.spssMeasure).toBeUndefined();
  });

  it('순위형에 처음 들어가면 기본 보기와 순위 설정을 넣고, 이미 있으면 두지 않는다', () => {
    const fresh = changeContentType(formOf(), 'ranking', {
      ...NO_AUTO,
      defaultRankingOptions: DEFAULT_RANKING_OPTIONS,
    });
    expect(fresh.rankingOptions).toEqual(DEFAULT_RANKING_OPTIONS);
    expect(fresh.rankingConfig).toEqual({ positions: 3 });

    const existing = formOf({
      type: 'ranking',
      rankingOptions: [{ id: 'x', label: '가', value: '1' }],
      rankingConfig: { positions: 5 },
    });
    const back = changeContentType({ ...existing, contentType: 'text' }, 'ranking', {
      ...NO_AUTO,
      defaultRankingOptions: DEFAULT_RANKING_OPTIONS,
    });
    expect(back.rankingOptions).toEqual(existing.rankingOptions);
    expect(back.rankingConfig).toEqual({ positions: 5 });
  });

  it('셀 코드·엑셀 라벨이 비어 있고 수동 값이 아니면 자동값으로 채운다', () => {
    const auto = { autoCellCode: 'Q1_r1_c1', autoExportLabel: 'Q1_열_행' };
    const filled = changeContentType(formOf(), 'input', auto);
    expect(filled.cellCode).toBe('Q1_r1_c1');
    expect(filled.exportLabel).toBe('Q1_열_행');

    const custom = changeContentType(
      { ...formOf(), isCustomCellCode: true, isCustomExportLabel: true },
      'input',
      auto,
    );
    expect(custom.cellCode).toBe('');
    expect(custom.exportLabel).toBe('');

    const written = changeContentType(
      formOf({ cellCode: 'MY', exportLabel: '내 라벨' }),
      'input',
      auto,
    );
    expect(written.cellCode).toBe('MY');
    expect(written.exportLabel).toBe('내 라벨');
  });
});

describe('changeGatingCondition — 게이팅 조건', () => {
  const cond = { kind: 'filled', controllerCellId: 'c0' } as const;

  it('처음 켤 때 필수 체크가 있으면 「활성일 때 필수」로 옮긴다', () => {
    const next = changeGatingCondition({ ...formOf({ type: 'input' }), cellRequired: true }, cond);
    expect(next.gatingCondition).toEqual(cond);
    expect(next.gatingRequiredWhenEnabled).toBe(true);
  });

  it('필수가 아니었거나 이미 조건이 있었으면 「활성일 때 필수」를 건드리지 않는다', () => {
    expect(changeGatingCondition(formOf({ type: 'input' }), cond).gatingRequiredWhenEnabled).toBe(
      false,
    );
    const gated = {
      ...formOf({ type: 'input', enabledWhen: cond }),
      cellRequired: true,
      gatingRequiredWhenEnabled: false,
    };
    expect(changeGatingCondition(gated, cond).gatingRequiredWhenEnabled).toBe(false);
  });

  it('조건을 지우면 조건만 비운다', () => {
    const gated = formOf({ type: 'input', enabledWhen: cond, requiredWhenEnabled: true });
    const next = changeGatingCondition(gated, undefined);
    expect(next.gatingCondition).toBeUndefined();
    expect(next.gatingRequiredWhenEnabled).toBe(true);
  });
});

describe('toggleNumberMode — 숫자만 입력', () => {
  it('이번 편집에서 처음 켜면 초기값도 켠다', () => {
    const next = toggleNumberMode(formOf({ type: 'input', inputType: 'text' }), true);
    expect(next.inputType).toBe('number');
    expect(next.emptyDefaultEnabled).toBe(true);
  });

  it('초기값을 끈 뒤 숫자 모드를 껐다 켜도 초기값을 다시 켜지 않는다', () => {
    const once = toggleNumberMode(formOf({ type: 'input' }), true);
    const userOff = { ...once, emptyDefaultEnabled: false };
    const off = toggleNumberMode(userOff, false);
    expect(off.inputType).toBe('text');
    expect(toggleNumberMode(off, true).emptyDefaultEnabled).toBe(false);
  });

  it('셀을 다시 읽으면(새 편집) 처음 켜기가 다시 적용된다', () => {
    const fresh = formOf({ type: 'input' });
    expect(fresh.emptyDefaultAutoApplied).toBe(false);
  });
});

describe('셀 코드·엑셀 라벨 직접 입력', () => {
  it('자동값과 다르게 쓰면 수동, 같거나 비우면 자동으로 본다', () => {
    const base = formOf();
    expect(editCellCode(base, 'MY', 'AUTO')).toMatchObject({
      cellCode: 'MY',
      isCustomCellCode: true,
    });
    expect(editCellCode(base, 'AUTO', 'AUTO').isCustomCellCode).toBe(false);
    expect(editCellCode(base, '', 'AUTO').isCustomCellCode).toBe(false);
    expect(editExportLabel(base, '내 라벨', 'AUTO')).toMatchObject({
      exportLabel: '내 라벨',
      isCustomExportLabel: true,
    });
  });

  it('되돌리기는 자동값과 자동 표시로 돌아간다', () => {
    const custom = { ...formOf(), cellCode: 'MY', isCustomCellCode: true };
    expect(resetCellCode(custom, 'AUTO')).toMatchObject({
      cellCode: 'AUTO',
      isCustomCellCode: false,
    });
    expect(resetCellCode(custom, undefined).cellCode).toBe('');
    const label = { ...formOf(), exportLabel: 'L', isCustomExportLabel: true };
    expect(resetExportLabel(label, 'AUTO')).toMatchObject({
      exportLabel: 'AUTO',
      isCustomExportLabel: false,
    });
  });
});

describe('toggleMerge — 셀 병합', () => {
  it('끄면 행·열 병합 수를 1로 되돌린다', () => {
    const merged = formOf({ rowspan: 2, colspan: 3 });
    expect(toggleMerge(merged, false)).toMatchObject({
      isMergeEnabled: false,
      rowspan: 1,
      colspan: 1,
    });
  });

  it('켤 때 비어 있는 병합 수만 1로 채운다', () => {
    const blank = { ...formOf(), rowspan: '' as const, colspan: 4 };
    expect(toggleMerge(blank, true)).toMatchObject({
      isMergeEnabled: true,
      rowspan: 1,
      colspan: 4,
    });
  });
});
