import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { StagedRowsConfig, TableCell, TableColumn, TableRow } from '@/types/survey';

import { DynamicRowSelectorModal } from './dynamic-row-selector-modal';
import { InteractiveTableResponse } from './interactive-table-response';
import { SurveyLocaleProvider } from './survey-locale-context';

/**
 * 표 문항의 시스템 글자 — 다국어 설문의 현재 언어로 행 차례로 열기 버튼·동적 행 고르기 창을 그린다.
 * 저작자가 버튼 이름을 적었으면 그 글자 그대로다(저작자 글자는 번역하지 않는다).
 */

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

const columns: TableColumn[] = [
  { id: 'c1', label: 'Country', width: 200 },
  { id: 'c2', label: 'Share', width: 120 },
];

function inputCell(id: string): TableCell {
  return { id, content: '', type: 'input' };
}

const rows: TableRow[] = [
  { id: 's1', label: '1', cells: [inputCell('s1a'), inputCell('s1b')] },
  { id: 's2', label: '2', cells: [inputCell('s2a'), inputCell('s2b')] },
  { id: 's3', label: '3', cells: [inputCell('s3a'), inputCell('s3b')] },
];

function renderStaged(config: StagedRowsConfig) {
  render(
    <SurveyLocaleProvider locale="zh">
      <InteractiveTableResponse
        questionId="q1"
        columns={columns}
        rows={rows}
        stagedRowsConfig={config}
        value={{ s2a: 'x' }}
        onChange={vi.fn()}
        enableSticky={false}
      />
    </SurveyLocaleProvider>,
  );
}

describe('표 문항 현재 언어', () => {
  it('中文 — 행 차례로 열기의 기본 버튼 이름과 삭제 버튼이 중국어다', () => {
    renderStaged({ enabled: true, rowIds: ['s1', 's2', 's3'], initialVisibleCount: 1 });
    expect(screen.getByRole('button', { name: '添加行' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除最后一行' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '添加或删除行' })).toBeInTheDocument();
  });

  it('저작자가 적은 버튼 이름은 그대로다', () => {
    renderStaged({
      enabled: true,
      rowIds: ['s1', 's2', 's3'],
      initialVisibleCount: 1,
      addLabel: '국가 추가',
    });
    expect(screen.getByRole('button', { name: '국가 추가' })).toBeInTheDocument();
  });

  it('English — 동적 행 고르기 창의 안내·전체 선택·버튼이 영어다', () => {
    render(
      <SurveyLocaleProvider locale="en">
        <DynamicRowSelectorModal
          open
          onOpenChange={vi.fn()}
          dynamicRows={rows}
          selectedRowIds={['s1']}
          onConfirm={vi.fn()}
        />
      </SurveyLocaleProvider>,
    );
    expect(screen.getByRole('dialog', { name: 'Select items' })).toBeInTheDocument();
    expect(screen.getByText('Select the items to show in the table.')).toBeInTheDocument();
    expect(screen.getByText('Select all')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm (1)' })).toBeInTheDocument();
    expect(screen.getByRole('dialog').textContent ?? '').not.toMatch(/[가-힣]/);
  });
});
