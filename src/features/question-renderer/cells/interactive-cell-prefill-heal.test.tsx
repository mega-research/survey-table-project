import { act, cleanup, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { InteractiveCell } from '@/features/question-renderer/cells/interactive-cell';
import { ContactAttrsProvider } from '@/features/question-renderer/contact-attrs-context';
import type { TableCell } from '@/types/survey';

/**
 * 「고칠 수 있게」 명단 값이 응답에서 빠졌을 때 다시 까는가 — 실제 셀 컨테이너(useCellResponse)를 거쳐서.
 *
 * 2026-11-05 유가공업 SQ1: 업체명·소재지가 화면엔 보이는데 「필수 응답이 비어있습니다」. 셀 컨테이너는 쓰는
 * 즉시 로컬 사본을 바꾸므로, 부모가 쓰기를 잃어도 칸은 값을 보이고 「응답에 없으면 다시 깐다」 확인이 그 사본을
 * 봐서 돌지 않았다(eb188e0a 의 테스트는 InputCell 에 값을 직접 넣어 이 경로를 건너뛰었다). 확인은 저장된 값으로 한다.
 */
afterEach(cleanup);

const cell = {
  id: 'name',
  type: 'input',
  content: '',
  defaultValueTemplate: '{{업체명}}',
  prefillEditable: true,
} as unknown as TableCell;

function Host({ dropFirst, log }: { dropFirst: boolean; log: Record<string, unknown>[] }) {
  const [value, setValue] = useState<Record<string, unknown>>({});
  const [dropped, setDropped] = useState(false);
  const [, force] = useState(0);
  return (
    <ContactAttrsProvider attrs={{ 업체명: '(유)대원푸드' }}>
      <button type="button" onClick={() => force((n) => n + 1)}>
        rerender
      </button>
      <InteractiveCell
        cell={cell}
        questionId="sq1"
        value={value}
        onChange={(next) => {
          log.push(next);
          // 같은 순간 다른 갱신이 묶음을 덮은 것처럼 첫 쓰기를 잃는다
          if (dropFirst && !dropped) {
            setDropped(true);
            return;
          }
          setValue(next);
        }}
      />
      <output data-testid="stored">{String(value['name'] ?? '')}</output>
    </ContactAttrsProvider>
  );
}

describe('고칠 수 있는 명단 값 — 셀 컨테이너를 거친 재깔기', () => {
  it('쓰기가 반영되면 한 번만 쓴다', () => {
    const log: Record<string, unknown>[] = [];
    const { getByTestId } = render(<Host dropFirst={false} log={log} />);
    expect(getByTestId('stored').textContent).toBe('(유)대원푸드');
    expect(log).toHaveLength(1);
  });

  it('첫 쓰기를 잃으면 저장된 값이 비어 있음을 보고 다시 깐다 — 화면 값만 보고 멈추지 않는다', () => {
    const log: Record<string, unknown>[] = [];
    const { getByTestId, getByText, container } = render(<Host dropFirst log={log} />);
    act(() => {
      getByText('rerender').click();
    });
    expect(container.querySelector('input')?.value).toBe('(유)대원푸드');
    expect(getByTestId('stored').textContent).toBe('(유)대원푸드');
  });
});
