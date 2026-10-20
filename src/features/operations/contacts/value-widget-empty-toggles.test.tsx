import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { ValueWidget } from '@/features/operations/contacts/value-widget';
import {
  decodeMultiClauseValue,
  FILTER_NONE_VALUE,
  FILTER_NOT_NONE_VALUE,
} from '@/lib/operations/filter-shared';

function Harness({ source, initial = '' }: { source: string; initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <output data-testid="value">{JSON.stringify(decodeMultiClauseValue(value) ?? value)}</output>
      <ValueWidget
        source={source}
        value={value}
        onChange={setValue}
        resultCodeOptions={[]}
        emptyToggles
      />
    </>
  );
}

describe('ValueWidget — 빈 값 토글 (컨택원 수정 화면)', () => {
  it('명단 열: 「— 제외하고 보기」는 값 있는 대상 전부, 다시 누르면 풀린다', async () => {
    const user = userEvent.setup();
    render(<Harness source="attrs.ID" />);
    await user.click(screen.getByRole('checkbox', { name: '— 제외하고 보기' }));
    expect(screen.getByTestId('value')).toHaveTextContent(JSON.stringify([FILTER_NOT_NONE_VALUE]));
    expect(screen.getByRole('textbox')).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: '— 제외하고 보기' }));
    expect(screen.getByTestId('value')).toHaveTextContent('""');
    expect(screen.getByRole('textbox')).toBeEnabled();
  });

  it('두 토글은 서로를 끈다 — 「— 인 것만 보기」로 바꾸면 빈 값만', async () => {
    const user = userEvent.setup();
    render(<Harness source="pii.대표자" />);
    await user.click(screen.getByRole('checkbox', { name: '— 제외하고 보기' }));
    await user.click(screen.getByRole('checkbox', { name: '— 인 것만 보기' }));
    expect(screen.getByTestId('value')).toHaveTextContent(JSON.stringify([FILTER_NONE_VALUE]));
    expect(screen.getByRole('checkbox', { name: '— 제외하고 보기' })).not.toBeChecked();
  });

  it('토글이 켜진 채 다시 열면 체크가 남아 있다', () => {
    render(<Harness source="attrs.ID" initial={`\u001f${FILTER_NOT_NONE_VALUE}\u001f`} />);
    expect(screen.getByRole('checkbox', { name: '— 제외하고 보기' })).toBeChecked();
  });

  it('시스템ID·고정 선택지 열에는 토글이 없다', () => {
    render(<Harness source="system.resid" />);
    expect(screen.queryByRole('checkbox', { name: '— 제외하고 보기' })).toBeNull();
  });
});
