import { useState } from 'react';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ContactAttrsProvider } from '@/features/question-renderer/contact-attrs-context';
import type { SurveyLookup, TableCell } from '@/types/survey';

import { GatingTableCellsProvider } from './gating-table-cells-context';
import { InputCell } from './input-cell';

/**
 * 표 입력 칸 「목록에서 찾기」 — 글자를 치면 참조표 후보가 뜨고, 고르면 이 칸과 같은 표의
 * 지정 칸이 함께 채워진다. 목록에 없는 값도 그대로 적힌다.
 */

const companies: SurveyLookup = {
  id: 'lut-1',
  name: '조사명부',
  columns: ['PID', '기업명', '법인등록번호', '사업자등록번호'],
  rows: [
    { PID: '915', 기업명: '삼성전자', 법인등록번호: '130111-0006246', 사업자등록번호: '1248100998' },
    { PID: '8', 기업명: '삼성에스디에스', 법인등록번호: '110111-0398135', 사업자등록번호: '1238100998' },
    { PID: '194', 기업명: '다우기술', 법인등록번호: '110111-0414758', 사업자등록번호: '2208102810' },
  ],
};

const nameCell: TableCell = {
  id: 'name',
  type: 'input',
  content: '',
  lookupSearch: {
    lookupId: 'lut-1',
    labelColumn: '기업명',
    fills: [
      { column: '법인등록번호', cellId: 'corp' },
      { column: '사업자등록번호', cellId: 'biz' },
    ],
  },
};
const corpCell: TableCell = { id: 'corp', type: 'input', content: '', inputType: 'corp_number' };
const bizCell: TableCell = { id: 'biz', type: 'input', content: '', inputType: 'biz_number' };
const cells = [nameCell, corpCell, bizCell];

function Harness({ lookups = [companies] }: { lookups?: SurveyLookup[] }) {
  const [value, setValue] = useState<Record<string, unknown>>({});
  const set = (id: string) => (v: unknown) => setValue((prev) => ({ ...prev, [id]: v }));
  return (
    <ContactAttrsProvider attrs={{}} lookups={lookups}>
      <GatingTableCellsProvider value={cells}>
        {cells.map((cell) => (
          <InputCell
            key={cell.id}
            cell={cell}
            cellResponse={value[cell.id]}
            onUpdateValue={set(cell.id)}
            onPatchValues={(patch) => setValue((prev) => ({ ...prev, ...patch }))}
            questionId="q1"
            inputIdScope="t"
          />
        ))}
      </GatingTableCellsProvider>
    </ContactAttrsProvider>
  );
}

function inputs() {
  const name = screen.getByRole('combobox');
  const [corp, biz] = screen.getAllByRole('textbox');
  return { name, corp: corp!, biz: biz! };
}

describe('목록에서 찾기', () => {
  it('글자를 치면 후보가 뜨고, 누르면 이 칸과 번호 칸이 형식대로 채워진다', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const { name, corp, biz } = inputs();

    await user.type(name, '삼성');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      '삼성전자',
      '삼성에스디에스',
    ]);

    await user.click(screen.getByRole('option', { name: '삼성전자' }));
    expect(name).toHaveValue('삼성전자');
    expect(corp).toHaveValue('130111-0006246');
    expect(biz).toHaveValue('124-81-00998');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('화살표와 Enter 로 고른다', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const { name, biz } = inputs();

    await user.type(name, '삼성');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(name).toHaveValue('삼성에스디에스');
    expect(biz).toHaveValue('123-81-00998');
  });

  it('목록에 없는 값은 그대로 적히고 번호 칸은 건드리지 않는다', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const { name, corp } = inputs();

    await user.type(name, '메가리서치');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await user.tab();
    expect(name).toHaveValue('메가리서치');
    expect(corp).toHaveValue('');
  });

  it('Escape 와 포커스 이탈은 목록을 닫는다', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const { name } = inputs();

    await user.type(name, '다우');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    await user.type(name, '기');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.tab();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('참조표가 없으면 평범한 입력칸이다', async () => {
    const user = userEvent.setup();
    render(<Harness lookups={[]} />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    await user.type(screen.getAllByRole('textbox')[0]!, '삼성');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
