import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { QuotaEditor } from '@/components/operations/quota/quota-editor';
import type { QuotaConfig, QuotaDimension } from '@/db/schema/schema-types';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

// vi.mock 은 파일 최상단으로 호이스팅되므로 팩토리가 참조하는 값은 vi.hoisted 로 만든다.
const { saveMock } = vi.hoisted(() => ({
  saveMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/shared/lib/rpc', () => ({
  client: { quota: { save: saveMock } },
}));

const cat = (id: string, label: string) => ({ id, label, values: [id] });

// 등록 순서: 성별(2) → 연령대(3) → 지역(4) → 피벗은 행=지역, 상단=연령대, 하위=성별
const genderDim: QuotaDimension = {
  id: 'dim-g',
  questionId: 'q-g',
  label: '성별',
  kind: 'choice',
  categories: [cat('m', '남'), cat('f', '여')],
};
const ageDim: QuotaDimension = {
  id: 'dim-a',
  questionId: 'q-a',
  label: '연령대',
  kind: 'choice',
  categories: [cat('a20', '20대'), cat('a30', '30대'), cat('a40', '40대')],
};
const regionDim: QuotaDimension = {
  id: 'dim-r',
  questionId: 'q-r',
  label: '지역',
  kind: 'choice',
  categories: [cat('r1', '안동시'), cat('r2', '영주시'), cat('r3', '상주시'), cat('r4', '문경시')],
};

function configOf(dimensions: QuotaDimension[], cells: QuotaConfig['cells'] = []): QuotaConfig {
  return { enabled: false, dimensions, cells, closedMessage: null };
}

function renderEditor(config: QuotaConfig) {
  return render(<QuotaEditor surveyId="s1" initialConfig={config} questions={[]} />);
}

beforeEach(() => {
  saveMock.mockClear();
});

describe('QuotaEditor 3조건 피벗 테이블', () => {
  it('중첩 2단 헤더를 렌더한다 — 상단 그룹은 하위 수만큼 colSpan, 하위 라벨은 그룹마다 반복', () => {
    renderEditor(configOf([genderDim, ageDim, regionDim]));

    const outer = screen.getByRole('columnheader', { name: '20대' });
    expect(outer).toHaveAttribute('colspan', '2');
    // 하위(성별) 라벨이 상단 그룹(연령대 3개)마다 반복
    expect(screen.getAllByRole('columnheader', { name: '남' })).toHaveLength(3);
    // 행 축 라벨 + 계 헤더
    expect(screen.getByRole('columnheader', { name: '지역' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '계' })).toBeInTheDocument();
    // 플랫 리스트(× 구분 라벨)는 더 이상 없다
    expect(screen.queryByText(/남 × /)).not.toBeInTheDocument();
  });

  it('계 행/열은 설정된 목표만 합산하고 전체 미설정 스코프는 — 로 표시한다', () => {
    renderEditor(
      configOf(
        [genderDim, ageDim, regionDim],
        [
          { categoryIds: ['m', 'a20', 'r1'], target: 13 },
          { categoryIds: ['f', 'a20', 'r1'], target: 11 },
          { categoryIds: ['m', 'a30', 'r2'], target: 8 },
        ],
      ),
    );

    const r1Row = screen.getByRole('row', { name: /안동시/ });
    expect(within(r1Row).getByText('24')).toBeInTheDocument();
    const totalRow = screen.getByRole('row', { name: /^계/ });
    expect(within(totalRow).getByText('32')).toBeInTheDocument();
    // 문경시(r4) 행은 전부 미설정 → —
    const r4Row = screen.getByRole('row', { name: /문경시/ });
    expect(within(r4Row).getByText('—')).toBeInTheDocument();
  });

  it('셀 입력은 표시 위치와 무관하게 조건 등록 순서의 categoryIds 로 저장된다', async () => {
    const user = userEvent.setup();
    renderEditor(configOf([genderDim, ageDim, regionDim]));

    // 행=상주시(r3), 열=20대×남 셀에 7 입력
    await user.type(screen.getByRole('spinbutton', { name: '상주시 · 20대 · 남 목표' }), '7');
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        surveyId: 's1',
        config: expect.objectContaining({
          cells: [{ categoryIds: ['m', 'a20', 'r3'], target: 7 }],
        }),
      }),
    );
  });

  it('조건 4개부터는 기존 조합 플랫 리스트를 유지한다', () => {
    const extraDim: QuotaDimension = {
      id: 'dim-x',
      questionId: 'q-x',
      label: '직업',
      kind: 'choice',
      categories: [cat('j1', '사무직'), cat('j2', '생산직')],
    };
    renderEditor(configOf([genderDim, ageDim, regionDim, extraDim]));

    expect(screen.getByText('남 × 20대 × 안동시 × 사무직')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: '계' })).not.toBeInTheDocument();
  });
});
