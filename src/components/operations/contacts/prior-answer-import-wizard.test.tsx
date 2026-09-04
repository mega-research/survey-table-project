import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PriorAnswerImportWizard } from '@/components/operations/contacts/prior-answer-import-wizard';
import type { SuggestPriorAnswerMappingResult } from '@/features/contacts/domain/prior-answers';

const { suggestMutateAsync } = vi.hoisted(() => ({ suggestMutateAsync: vi.fn() }));

vi.mock('@/hooks/queries', () => ({
  useSuggestPriorAnswerMapping: () => ({ mutateAsync: suggestMutateAsync, isPending: false }),
  useImportPriorAnswers: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSavePriorAnswerImportConfig: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

type PreviewBlock = SuggestPriorAnswerMappingResult['blocks'][number];

function block(overrides: Partial<PreviewBlock> & { code: string }): PreviewBlock {
  return {
    label: '',
    part: '',
    columnIndexes: [0],
    detailLabels: [''],
    questionId: null,
    matchedBy: null,
    verdict: 'unmapped',
    conflictQuestionId: null,
    verdictReason: null,
    fromSavedConfig: false,
    slotLabels: ['미배정'],
    unmatchedSlots: 1,
    ...overrides,
  };
}

function question(id: string, questionCode: string, title: string) {
  return {
    id,
    questionCode,
    title,
    type: 'radio',
    options: [
      { value: '1', label: '① 예' },
      { value: '2', label: '② 아니오' },
    ],
  };
}

/** 2025 실데이터 드라이런의 세 판정 — 제목 동률로 멈춘 unmapped, 코드 없는 값 후보, 코드 충돌 값 후보. */
const preview: SuggestPriorAnswerMappingResult = {
  sheetNames: ['응답자만'],
  looksLikeRawFormat: false,
  headerRows: [
    ['AQ1-A.', 'IQ1.', 'AQ1-1.'],
    ['', '(창업의향)', '(진학계획)'],
  ],
  rows: [['있음', '있음', '학사']],
  totalRows: 1,
  blocks: [
    block({
      code: 'AQ1-A.',
      verdictReason: '값이 맞는 문항 4개: SQ0, SQ1, AQ0, HQ1 — 제목으로 못 가름',
    }),
    block({
      code: 'IQ1.',
      label: '창업의향',
      detailLabels: ['(창업의향)'],
      columnIndexes: [1],
      questionId: 'q-hq1',
      matchedBy: 'value',
      verdict: 'label-candidate',
      verdictReason:
        '제안 문항 보기와 맞는 값 12건 / 표본 12건 (100%) — 값이 맞는 문항 여럿 중 제목이 가장 비슷한 것',
      slotLabels: ['단일 값'],
      unmatchedSlots: 0,
    }),
    block({
      code: 'AQ1-1.',
      label: '진학계획',
      detailLabels: ['(진학계획)'],
      columnIndexes: [2],
      questionId: 'q-aq1-2',
      matchedBy: 'value',
      verdict: 'label-candidate',
      conflictQuestionId: 'q-aq1-1',
      verdictReason:
        '표본 12건 중 보기와 맞는 값 0건 (AQ1-1. 귀하의 졸업 후 진로 계획은 어떻게 되십니까?) — 제안 문항 보기와 맞는 값 12건 / 표본 12건 (100%)',
      slotLabels: ['단일 값'],
      unmatchedSlots: 0,
    }),
  ],
  savedValueAliases: {},
  questions: [
    question('q-hq1', 'HQ1', 'HQ1. 귀하는 향후 창업하실 의향이 있으신가요?'),
    question('q-aq1-1', 'AQ1_1', 'AQ1-1. 귀하의 졸업 후 진로 계획은 어떻게 되십니까?'),
    question('q-aq1-2', 'AQ1_2', 'AQ1-2. 귀하의 진학 예정은 어떻게 되십니까?'),
  ],
};

/** 파일을 고르면 제안을 받아 매핑 표가 열린다 — 파일 검증은 확장자와 크기만 본다. */
async function openMappingTable() {
  suggestMutateAsync.mockResolvedValue(preview);
  const { container } = render(
    <PriorAnswerImportWizard
      surveyId="s1"
      existingPriorAnswerCount={0}
      isTestScope={false}
      matchFields={[{ key: 'UID', label: 'UID' }]}
    />,
  );
  const input = container.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('파일 입력이 없다');
  fireEvent.change(input, { target: { files: [new File(['x'], 'raw.xlsx')] } });
  await screen.findByText(/문항 블록 잇기/);
}

function rowOf(code: string): HTMLElement {
  const row = screen.getByText(code, { selector: 'td' }).closest('tr');
  if (!row) throw new Error(`${code} 행이 없다`);
  return row;
}

describe('PriorAnswerImportWizard — 매핑 표의 판정 사유', () => {
  beforeEach(() => {
    suggestMutateAsync.mockReset();
  });

  it('후보 여럿·제목 동률로 멈춘 unmapped 블록의 사유(후보 목록)가 배지 없이도 보인다', async () => {
    // 2025 #21 AQ1-A. — 배지는 unmapped 에 없고, 사유는 배지 아래에만 그리던 것이라 담당자가 목록을 못 봤다.
    await openMappingTable();
    const row = rowOf('AQ1-A.');
    expect(
      within(row).getByText('값이 맞는 문항 4개: SQ0, SQ1, AQ0, HQ1 — 제목으로 못 가름'),
    ).toBeInTheDocument();
  });

  it('코드가 가리킨 문항이 없는 값 후보는 그런 문항이 있다고 말하지 않는다', async () => {
    // 2025 IQ1. → HQ1 — 2026 에 IQ1 코드가 없어 conflictQuestionId 도 없다.
    await openMappingTable();
    const row = rowOf('IQ1.');
    expect(within(row).getByText(/값이 이 문항의 보기와 맞습니다/)).toBeInTheDocument();
    expect(row).not.toHaveTextContent('코드가 가리킨 문항');
    expect(row).toHaveTextContent('제목이 가장 비슷한 것');
  });

  it('코드가 가리킨 문항과 충돌하는 값 후보는 그 문항을 함께 보여준다', async () => {
    await openMappingTable();
    const row = rowOf('AQ1-1.');
    expect(within(row).getByText(/코드가 가리킨 문항과 다르니 확인 필요/)).toBeInTheDocument();
    expect(row).toHaveTextContent(
      '코드가 가리킨 문항: AQ1-1. 귀하의 졸업 후 진로 계획은 어떻게 되십니까?',
    );
    expect(row).toHaveTextContent('표본 12건 중 보기와 맞는 값 0건');
  });
});
