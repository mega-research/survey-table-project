import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DynamicTableEditor } from '@/features/survey-builder/table-editor/dynamic-table-editor';
import type { ChoiceGroup, Question, TableCell, TableColumn, TableRow } from '@/types/survey';

/**
 * 표 에디터가 모바일 표시 방식 설정에 넘기는 슬라이더 안내 재료 — 편집 중인 표 구조와 스토어의 보기 그룹,
 * 그리고 문항 편집 폼의 슬라이더 방향(저장 전 값)으로 응답 화면과 같은 판정을 돌린다.
 */

const store = vi.hoisted(() => ({ question: null as unknown }));

vi.mock('@/features/survey-builder/stores/survey-store', () => ({
  useSurveyBuilderStore: <T,>(
    selector: (state: {
      currentSurvey: { questions: unknown[] };
      silentUpdateQuestion: () => void;
    }) => T,
  ) => selector({ currentSurvey: { questions: [store.question] }, silentUpdateQuestion: () => {} }),
}));

vi.mock('@/features/survey-builder/stores/ui-store', () => ({
  useSurveyUIStore: <T,>(selector: (state: { editingQuestionId: string | null }) => T) =>
    selector({ editingQuestionId: 'q1' }),
}));

const columns: TableColumn[] = Array.from({ length: 6 }, (_, n) => ({
  id: `col${n}`,
  label: n === 0 ? '항목' : `${n}`,
  width: 100,
}));

const scaleRow = (groupId: string | undefined, extra: Partial<TableCell> = {}): TableRow => ({
  id: 'r1',
  label: '회의실 지원',
  cells: [
    { id: 'r1-item', type: 'text', content: '회의실 지원' },
    ...['①', '②', '③', '④', '⑤'].map(
      (content, n): TableCell => ({
        id: `r1-c${n}`,
        type: 'choice_opt',
        content,
        ...(groupId ? { choiceGroupId: groupId } : {}),
        ...extra,
      }),
    ),
  ],
});

const sliderGroup: ChoiceGroup = {
  id: 'g1',
  groupKey: 'rad1',
  type: 'radio',
  label: '만족도',
  scaleSlider: 'positive-right',
};

function renderEditor(
  question: Partial<Question>,
  rows: TableRow[],
  props: Partial<Parameters<typeof DynamicTableEditor>[0]> = {},
) {
  store.question = { id: 'q1', title: 'Q', required: false, order: 1, ...question };
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <DynamicTableEditor columns={columns} rows={rows} onTableChange={() => {}} {...props} />
    </QueryClientProvider>,
  );
}

const note = () => screen.queryByTestId('scale-slider-layout-note');

describe('DynamicTableEditor — 모바일 표시 방식 옆 척도 슬라이더 안내', () => {
  afterEach(cleanup);

  it('슬라이더 그룹이 그려지는 표 문항은 안내와 행 단위 배치 설정이 보인다', () => {
    renderEditor({ type: 'table', choiceGroups: [sliderGroup] }, [scaleRow('g1')]);
    expect(note()).toHaveTextContent('행 단위로 그려집니다');
    expect(screen.getByLabelText('상세에서 제외할 앞쪽 열 수')).toBeInTheDocument();
  });

  it('슬라이더 설정이 없는 표는 지금 화면 그대로다', () => {
    const { scaleSlider: _direction, ...tiles } = sliderGroup;
    renderEditor({ type: 'table', choiceGroups: [tiles] }, [scaleRow('g1')]);
    expect(note()).toBeNull();
    expect(screen.queryByLabelText('상세에서 제외할 앞쪽 열 수')).toBeNull();
  });

  it('모든 행이 폴백인 표는 화면이 바뀌지 않는다고 알린다', () => {
    renderEditor({ type: 'table', choiceGroups: [sliderGroup] }, [
      scaleRow('g1', { allowTextInput: true }),
    ]);
    expect(note()).toHaveTextContent('화면이 바뀌지 않습니다');
  });

  it('그룹 없는 보기 소스 표는 문항 편집 폼의 슬라이더 방향으로 판정한다 — 저장 전 값이다', () => {
    const { unmount } = renderEditor({ type: 'radio', choiceGroups: [] }, [scaleRow(undefined)]);
    expect(note()).toBeNull();
    unmount();

    renderEditor({ type: 'radio', choiceGroups: [] }, [scaleRow(undefined)], {
      questionScaleSlider: 'positive-left',
    });
    expect(note()).toHaveTextContent('행 단위로 그려집니다');
  });

  it('스토어에 남은 문항의 방향은 읽지 않는다 — 폼에서 끈 값이 먼저다', () => {
    renderEditor({ type: 'radio', choiceGroups: [], scaleSlider: 'positive-right' }, [
      scaleRow(undefined),
    ], { questionScaleSlider: null });
    expect(note()).toBeNull();
  });

  it('라디오 그룹이 있는 보기 소스 표는 문항 설정의 방향을 읽지 않는다', () => {
    const { scaleSlider: _direction, ...tiles } = sliderGroup;
    renderEditor({ type: 'radio', choiceGroups: [tiles] }, [scaleRow('g1')], {
      questionScaleSlider: 'positive-right',
    });
    expect(note()).toBeNull();
  });
});
