import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { MobileDrilldownShell } from '@/components/survey-builder/mobile-drilldown-shell';
import type { ClassifiedLeaf, ClassifiedSection } from '@/utils/classify-table';

const leaf = (rowId: string, label: string): ClassifiedLeaf => ({
  rowId,
  label,
  subGroup: '',
  inputCellIds: [`${rowId}-value`],
  cellByCol: { 1: `${rowId}-value` },
});

const section = (leaves: ClassifiedLeaf[]): ClassifiedSection => ({
  label: leaves.length === 1 ? '항목' : '척도',
  kind: 'matrix',
  reason: '테스트',
  leaves,
  colGroups: [{ label: '점수', cols: [{ col: 1, label: '1점' }] }],
  totalInputs: leaves.length,
});

const singleLeafSections = () => [section([leaf('r1', '첫 항목')])];
const twoLeafMatrix = () => [section([leaf('r1', '첫 항목'), leaf('r2', '둘째 항목')])];

function renderShell({
  sections = twoLeafMatrix(),
  leafNavigation = 'always',
  onReturnToRoot = vi.fn(),
}: {
  sections?: ClassifiedSection[];
  leafNavigation?: 'matrix-only' | 'always';
  onReturnToRoot?: () => void;
} = {}) {
  return render(
    <MobileDrilldownShell
      sections={sections}
      leafNavigation={leafNavigation}
      overallStatus={{
        completed: 0,
        total: sections.flatMap((item) => item.leaves).length,
        unit: '개 항목',
      }}
      getSectionStatus={(item) => ({
        completed: 0,
        total: item.leaves.length,
        unit: '개 항목',
      })}
      getLeafStatus={() => ({ completed: 0, total: 1, unit: '개 항목' })}
      renderLeafDetail={(item) => (
        <div data-testid="leaf-detail">
          <span>{item.label}</span>
          <input type="radio" aria-label="1점" />
        </div>
      )}
      onReturnToRoot={onReturnToRoot}
    />,
  );
}

function enterFirstLeaf() {
  fireEvent.click(screen.getByRole('button', { name: /척도/ }));
  fireEvent.click(screen.getByRole('button', { name: /첫 항목/ }));
}

it('always 모드는 단일 leaf도 루트 카드 클릭 후 상세를 연다', () => {
  renderShell({ sections: singleLeafSections(), leafNavigation: 'always' });
  expect(screen.getByRole('button', { name: /항목/ })).toBeInTheDocument();
  expect(screen.queryByTestId('leaf-detail')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /항목/ }));
  expect(screen.getByTestId('leaf-detail')).toBeInTheDocument();
});

it('입력 후 자동 이동하지 않고 다음 항목 버튼으로만 이동한다', () => {
  renderShell({ sections: twoLeafMatrix(), leafNavigation: 'always' });
  enterFirstLeaf();
  fireEvent.click(screen.getByRole('radio', { name: '1점' }));
  expect(screen.getByTestId('leaf-detail')).toHaveTextContent('첫 항목');
  fireEvent.click(screen.getByRole('button', { name: '다음 항목' }));
  expect(screen.getByTestId('leaf-detail')).toHaveTextContent('둘째 항목');
});

it('목차로 이동할 때 onReturnToRoot를 호출한다', () => {
  const onReturnToRoot = vi.fn();
  renderShell({ onReturnToRoot, sections: twoLeafMatrix() });
  enterFirstLeaf();
  fireEvent.click(screen.getByRole('button', { name: '목차로' }));
  expect(onReturnToRoot).toHaveBeenCalledTimes(1);
});
