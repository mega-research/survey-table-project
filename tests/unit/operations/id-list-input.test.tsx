import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ValueWidget } from '@/components/operations/contacts/value-widget';

function renderWidget(source: string, value: string, onChange = vi.fn(), onSubmit = vi.fn()) {
  render(
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <ValueWidget
        source={source}
        value={value}
        onChange={onChange}
        resultCodeOptions={[]}
        inputId="v"
      />
    </form>,
  );
  return { onChange, onSubmit };
}

describe('ValueWidget — 시스템ID/attrs 컬럼의 ID 목록 붙여넣기', () => {
  it('엑셀 열 붙여넣기(개행 구분)는 공백 구분 한 줄로 정규화되어 onChange 로 나간다', () => {
    const { onChange } = renderWidget('attrs.ID', '');
    const box = screen.getByRole('textbox');

    fireEvent.paste(box, { clipboardData: { getData: () => '99\r\n292\n235\n' } });

    expect(onChange).toHaveBeenCalledWith('99 292 235');
  });

  it('붙여넣기는 기존 값 뒤에 이어 붙는다', () => {
    const { onChange } = renderWidget('system.resid', '1 2');
    fireEvent.paste(screen.getByRole('textbox'), { clipboardData: { getData: () => '3\n4' } });
    expect(onChange).toHaveBeenCalledWith('1 2 3 4');
  });

  it('숫자 2개 이상이면 인식 개수 배지, 중복은 제거 수를 같이 보여준다', () => {
    renderWidget('attrs.ID', '99 292 99');
    expect(screen.getByText('ID 2개 인식 · 중복 1개 제거')).toBeInTheDocument();
  });

  it('숫자 아닌 값이 섞이면 경고 — 어떤 값인지 보여준다', () => {
    renderWidget('system.resid', '99 abc 292 미확인');
    expect(screen.getByRole('alert')).toHaveTextContent('숫자가 아닌 값 2개: abc, 미확인');
  });

  it('attrs 컬럼에 앞에 0 이 붙은 번호가 섞이면 경고 — 서버가 조용히 0건으로 접는 값', () => {
    renderWidget('attrs.ID', '0001 0002 15');
    expect(screen.getByRole('alert')).toHaveTextContent(
      '앞에 0이 붙은 번호 2개는 목록 검색이 안 됩니다: 0001, 0002',
    );
  });

  it('2,000개를 넘으면 저장 경로 안내', () => {
    const big = Array.from({ length: 2001 }, (_, i) => String(i + 1)).join(' ');
    renderWidget('system.resid', big);
    expect(screen.getByText(/2,001개 인식/)).toBeInTheDocument();
    expect(screen.getByText(/2,000개 초과/)).toBeInTheDocument();
  });

  it('저장 토큰 값은 저장된 목록 개수로 보여준다', () => {
    renderWidget('attrs.ID', 'list:0f3a4b5c-1111-4222-8333-444455556666:5000');
    expect(
      screen.getByText('저장된 ID 목록 5,000개 — 새로 붙여넣으면 교체됩니다'),
    ).toBeInTheDocument();
  });

  it('Enter 는 검색 제출, Shift+Enter 는 줄바꿈', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderWidget('system.resid', '1 2');
    const box = screen.getByRole('textbox');
    await user.click(box);
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(onSubmit).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('일반 텍스트 컬럼 검색("메가 리서치")에는 배지·경고가 없다', () => {
    renderWidget('attrs.회사명', '메가 리서치');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/인식/)).not.toBeInTheDocument();
  });
});
