import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ReactNode } from 'react';

import { InteractiveCell } from '@/features/question-renderer/cells/interactive-cell';
import { ResponseSourcesProvider } from '@/features/question-renderer/response-sources';
import { previewResponseSources } from '@/features/survey-builder/stores/preview-response-sources';
import { useTestResponseStore } from '@/features/survey-builder/stores/test-response-store';
import type { CellEnableCondition, TableCell } from '@/types/survey';

/** 빌더 미리보기 배선 — 테스트 응답 스토어를 질문 응답 원본으로 주입한다. */
const withPreview = (node: ReactNode) => (
  <ResponseSourcesProvider sources={previewResponseSources}>{node}</ResponseSourcesProvider>
);

/**
 * 조건 묶음 게이팅의 응답 화면 배선 — 셀이 컨트롤러 **여러 개**를 구독해 그중 어느 것이
 * 바뀌어도 다시 판정해야 한다. 단일 컨트롤러 시절에는 키 하나만 구독했으므로, 묶음에서
 * 두 번째 컨트롤러 변경을 놓치면 셀이 열리지 않는다.
 */
const now: TableCell = { id: 'now', type: 'input', content: '', inputType: 'number' };
const want: TableCell = { id: 'want', type: 'input', content: '', inputType: 'number' };
const eitherAtLeastOne = (op: 'OR' | 'NOT'): CellEnableCondition => ({
  kind: 'group',
  op,
  terms: [
    { kind: 'numeric', controllerCellId: 'now', op: '>=', value: 1 },
    { kind: 'numeric', controllerCellId: 'want', op: '>=', value: 1 },
  ],
});
const name: TableCell = {
  id: 'name',
  type: 'input',
  content: '',
  enabledWhen: eitherAtLeastOne('OR'),
};
const rowCells = [now, want, name];

const renderName = () =>
  render(withPreview(<InteractiveCell cell={name} questionId="q1" rowCells={rowCells} />));
const setResponse = (value: Record<string, string>) =>
  act(() => {
    useTestResponseStore.setState({ testResponses: { q1: value } });
  });

describe('조건 묶음 게이팅 — 응답 화면 배선', () => {
  beforeEach(() => {
    useTestResponseStore.setState({ testResponses: {} });
  });
  afterEach(cleanup);

  it('OR — 처음에는 숨고, 두 번째 컨트롤러만 충족해도 나타난다', () => {
    const { container } = renderName();
    expect(container.querySelector('input')).toBeNull();

    setResponse({ want: '2' });
    expect(container.querySelector('input')).not.toBeNull();
  });

  it('OR — 첫 번째 컨트롤러만 충족해도 나타나고, 둘 다 미충족으로 돌아가면 다시 숨는다', () => {
    const { container } = renderName();
    setResponse({ now: '1' });
    expect(container.querySelector('input')).not.toBeNull();

    setResponse({ now: '0', want: '0' });
    expect(container.querySelector('input')).toBeNull();
  });

  it('NOT — 아무것도 답하지 않은 처음 상태에서 보이고, 조건 하나가 충족되면 숨는다', () => {
    const notCell: TableCell = { ...name, id: 'not-cell', enabledWhen: eitherAtLeastOne('NOT') };
    const { container } = render(
      withPreview(<InteractiveCell cell={notCell} questionId="q1" rowCells={[now, want, notCell]} />),
    );
    expect(container.querySelector('input')).not.toBeNull();

    setResponse({ now: '3' });
    expect(container.querySelector('input')).toBeNull();
  });

  it('비활성으로 바뀌면 남아 있던 값을 지운다', () => {
    useTestResponseStore.setState({ testResponses: { q1: { now: '1', name: 'X100' } } });
    renderName();
    setResponse({ now: '0', name: 'X100' });
    const response = useTestResponseStore.getState().testResponses['q1'] as Record<string, unknown>;
    expect(response['name']).toBeUndefined();
  });

  it('비활성 컨트롤러의 잔존값은 없는 것으로 본다 — 상류가 닫히면 하류가 곧바로 다시 판정된다', () => {
    // x 가 비면 a·b 비활성. c 는 "a 에 값이 있거나 b 에 값이 없으면" 활성 — 어느 쪽이든 활성이고
    // 그 사이 중간 상태에서도 답이 지워지면 안 된다.
    const x: TableCell = { id: 'x', type: 'input', content: '' };
    const a: TableCell = { id: 'a', type: 'input', content: '', enabledWhen: { kind: 'filled', controllerCellId: 'x' } };
    const b: TableCell = { id: 'b', type: 'input', content: '', enabledWhen: { kind: 'filled', controllerCellId: 'x' } };
    const c: TableCell = {
      id: 'c',
      type: 'input',
      content: '',
      enabledWhen: {
        kind: 'group',
        op: 'OR',
        terms: [
          { kind: 'filled', controllerCellId: 'a' },
          { kind: 'group', op: 'NOT', terms: [{ kind: 'filled', controllerCellId: 'b' }] },
        ],
      },
    };
    const cells = [x, a, b, c];
    useTestResponseStore.setState({
      testResponses: { q1: { x: '1', a: '값', b: '값', c: '지켜야 할 답' } },
    });
    const { container } = render(
      withPreview(
        <>
          {cells.map((cell) => (
            <InteractiveCell key={cell.id} cell={cell} questionId="q1" rowCells={cells} />
          ))}
        </>,
      ),
    );
    expect(container.querySelectorAll('input')).toHaveLength(4);

    setResponse({ x: '', a: '값', b: '값', c: '지켜야 할 답' });
    const response = useTestResponseStore.getState().testResponses['q1'] as Record<string, unknown>;
    expect(response['c']).toBe('지켜야 할 답');
    expect(response['a'] ?? '').toBe('');
    expect(response['b'] ?? '').toBe('');
  });
});
