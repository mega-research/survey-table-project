import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MOBILE_PIECE_FALLBACK_MESSAGES } from '@/features/survey-builder/lib/mobile-piece-diagnostics';
import { MobileTableDisplaySettings } from '@/features/survey-builder/table-editor/mobile-table-display-settings';
import type { MobileTableDisplayMode } from '@/types/mobile-table-display';

/**
 * 조각 좌우 반전 · 조각 한 화면 칸 수 — 모바일 표시 방식 설정 안의 두 입력 칸.
 * 원본 행 상세 설정(앞쪽 열 제외 수 · 반복 헤더 범위)이 보이는 표시 방식에서 같이 보인다.
 */

function renderSettings(
  mode: MobileTableDisplayMode,
  piece: {
    reverse?: boolean;
    perView?: number | null;
    /** 쓰기 경로를 넘기지 않는 호출자 */
    withoutPieceChange?: boolean;
    issues?: Parameters<typeof MobileTableDisplaySettings>[0]['pieceIssues'];
  } = {},
) {
  const onChange = vi.fn();
  const onPieceChange =
    vi.fn<(patch: { reverseColumns?: boolean; columnsPerView?: number | null }) => void>();
  render(
    <MobileTableDisplaySettings
      mode={mode}
      omitLeadingColumns={1}
      columnCount={13}
      onChange={onChange}
      pieceReverseColumns={piece.reverse}
      pieceColumnsPerView={piece.perView}
      pieceIssues={piece.issues}
      {...(piece.withoutPieceChange ? {} : { onPieceChange })}
    />,
  );
  return { onChange, onPieceChange };
}

describe('모바일 표시 방식 설정 — 조각 좌우 반전 · 한 화면 칸 수', () => {
  it.each(['row-wise-original', 'drilldown-original-row', 'row-wise-scale'] as const)(
    '%s 에서 두 칸이 보인다',
    (mode) => {
      renderSettings(mode);
      expect(screen.getByRole('switch', { name: '좌우 반전' })).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: '한 화면에 보일 칸 수' })).toBeInTheDocument();
    },
  );

  it.each(['auto', 'original', 'item-cards', 'axis-cards'] as const)(
    '%s 에서는 보이지 않는다 — 원본 표 조각을 그리지 않는 방식이다',
    (mode) => {
      renderSettings(mode);
      expect(screen.queryByRole('switch', { name: '좌우 반전' })).toBeNull();
      expect(screen.queryByRole('combobox', { name: '한 화면에 보일 칸 수' })).toBeNull();
    },
  );

  it('쓰기 경로를 넘기지 않은 호출자에게는 보이지 않는다', () => {
    renderSettings('row-wise-original', { withoutPieceChange: true });
    expect(screen.queryByRole('switch', { name: '좌우 반전' })).toBeNull();
  });

  it('스위치를 켜고 끄면 반전 값만 적는다 — 표시 방식 묶음은 다시 쓰지 않는다', () => {
    const { onChange, onPieceChange } = renderSettings('row-wise-original');
    const toggle = screen.getByRole('switch', { name: '좌우 반전' });
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);
    expect(onPieceChange).toHaveBeenLastCalledWith({ reverseColumns: true });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('켜진 값은 켜진 채로 보이고 끄면 false 를 적는다', () => {
    const { onPieceChange } = renderSettings('row-wise-original', { reverse: true, perView: 6 });
    const toggle = screen.getByRole('switch', { name: '좌우 반전' });
    expect(toggle).toBeChecked();
    expect(screen.getByRole('combobox', { name: '한 화면에 보일 칸 수' })).toHaveTextContent('6칸');

    fireEvent.click(toggle);
    expect(onPieceChange).toHaveBeenLastCalledWith({ reverseColumns: false });
  });

  it('칸 수가 비어 있거나 범위 밖이면 「비움」으로 보인다', () => {
    renderSettings('row-wise-original', { perView: 9 });
    expect(screen.getByRole('combobox', { name: '한 화면에 보일 칸 수' })).toHaveTextContent('비움');
  });

  it('도움말이 입력 칸에 이어져 있다', () => {
    renderSettings('row-wise-original');
    expect(screen.getByRole('switch', { name: '좌우 반전' })).toHaveAccessibleDescription(
      /평균에서 제외/,
    );
    expect(
      screen.getByRole('combobox', { name: '한 화면에 보일 칸 수' }),
    ).toHaveAccessibleDescription(/화면 폭을 이 수로 나눠/);
  });

  it('적용되지 않는 행을 사유와 함께 알린다', () => {
    renderSettings('row-wise-original', {
      reverse: true,
      issues: [
        {
          reason: 'merged-across-pinned',
          message: MOBILE_PIECE_FALLBACK_MESSAGES['merged-across-pinned'],
          rowLabels: ['회원가입 절차'],
        },
      ],
    });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('좌우 반전을 적용하지 못합니다');
    expect(alert).toHaveTextContent('회원가입 절차');
  });

  it('알릴 것이 없으면 경고 상자를 그리지 않는다', () => {
    renderSettings('row-wise-original', { reverse: true, issues: [] });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
