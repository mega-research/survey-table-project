/**
 * 표 셀의 시스템 글자 — 다국어 설문의 현재 언어로 선택 개수 안내·선택 안내·동영상 오류를 그린다.
 * 다국어가 아닌 설문(공급자 밖)은 지금 한국어 그대로다(기존 셀 테스트가 지킨다).
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CheckboxCell } from '@/features/question-renderer/cells/checkbox-cell';
import { PreviewCell } from '@/features/question-renderer/cells/preview-cell';
import { SelectCell } from '@/features/question-renderer/cells/select-cell';
import { VideoCell } from '@/features/question-renderer/cells/video-cell';
import { SurveyLocaleProvider } from '@/features/question-renderer/survey-locale-context';
import type { TableCell } from '@/types/survey';

afterEach(cleanup);

const checkboxCell = {
  id: 'c1',
  type: 'checkbox',
  content: '',
  minSelections: 2,
  maxSelections: 3,
  checkboxOptions: [
    { id: 'o1', label: 'A', value: '1' },
    { id: 'o2', label: 'B', value: '2' },
    { id: 'o3', label: 'C', value: '3' },
  ],
} as unknown as TableCell;

describe('표 셀 현재 언어', () => {
  it('中文 — 체크박스 칸의 선택 개수·최소 안내가 중국어다', () => {
    render(
      <SurveyLocaleProvider locale="zh">
        <CheckboxCell cell={checkboxCell} cellResponse={['1']} onUpdateValue={vi.fn()} questionId="q1" />
      </SurveyLocaleProvider>,
    );
    expect(screen.getByText('已选 1/3 项')).toBeInTheDocument();
    expect(screen.getByText('至少选择2项')).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/[가-힣]/);
  });

  it('English — 최대에 이르면 영어로 알린다', () => {
    render(
      <SurveyLocaleProvider locale="en">
        <CheckboxCell
          cell={checkboxCell}
          cellResponse={['1', '2', '3']}
          onUpdateValue={vi.fn()}
          questionId="q1"
        />
      </SurveyLocaleProvider>,
    );
    expect(screen.getByText('Maximum reached')).toBeInTheDocument();
  });

  it('中文 — 드롭다운 칸의 빈 선택이 「请选择」다', () => {
    const cell = {
      id: 's1',
      type: 'select',
      content: '',
      selectOptions: [{ id: 'o1', label: 'A', value: '1' }],
    } as unknown as TableCell;
    render(
      <SurveyLocaleProvider locale="zh">
        <SelectCell cell={cell} cellResponse="" onUpdateValue={vi.fn()} questionId="q1" />
      </SurveyLocaleProvider>,
    );
    expect(screen.getByRole('option', { name: '请选择' })).toBeInTheDocument();
  });

  it('English — 동영상 링크 오류와 읽기 전용 입력칸 안내가 영어다', () => {
    const video = { id: 'v1', type: 'video', content: '', videoUrl: 'https://x.test/a' } as TableCell;
    const input = { id: 'i1', type: 'input', content: '', inputMaxLength: 20 } as TableCell;
    render(
      <SurveyLocaleProvider locale="en">
        <VideoCell cell={video} cellResponse={undefined} onUpdateValue={vi.fn()} questionId="q1" />
        <PreviewCell cell={input} />
      </SurveyLocaleProvider>,
    );
    expect(screen.getByText('Invalid video link')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', 'Enter your answer...');
    expect(screen.getByText('Up to 20 characters')).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/[가-힣]/);
  });
});
