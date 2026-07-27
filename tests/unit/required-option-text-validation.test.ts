import { describe, expect, it } from 'vitest';

import {
  collectRequiredOptionTextIssues,
  collectVisibleTableCells,
} from '@/lib/survey/required-option-text-validation';
import type { Question, TableCell } from '@/types/survey';

function makeQuestion(overrides: Partial<Question>): Question {
  return {
    id: 'q1',
    type: 'radio',
    title: '질문',
    required: false,
    order: 0,
    ...overrides,
  } as Question;
}

describe('collectRequiredOptionTextIssues', () => {
  it('필수 radio 질문에서 선택한 상세기입 옵션이 공백이면 질문 누락이다', () => {
    const question = makeQuestion({
      type: 'radio',
      required: true,
      options: [{ id: 'other', value: 'other-value', label: '기타', allowTextInput: true }],
    });

    expect(
      collectRequiredOptionTextIssues(question, 'other-value', { other: '   ' }),
    ).toEqual({ questionMissing: true, cellIds: [] });
  });

  it('선택 사항 질문은 상세기입이 공백이어도 누락이 아니다', () => {
    const question = makeQuestion({
      type: 'radio',
      required: false,
      options: [{ id: 'other', value: 'other-value', label: '기타', allowTextInput: true }],
    });

    expect(
      collectRequiredOptionTextIssues(question, 'other-value', { other: '' }),
    ).toEqual({ questionMissing: false, cellIds: [] });
  });

  it('필수 checkbox 질문은 선택된 상세기입 옵션마다 값이 필요하다', () => {
    const question = makeQuestion({
      type: 'checkbox',
      required: true,
      options: [
        { id: 'a', value: 'a', label: 'A', allowTextInput: true },
        { id: 'b', value: 'b', label: 'B', allowTextInput: true },
      ],
    });

    expect(
      collectRequiredOptionTextIssues(question, ['a', 'b'], { a: '작성', b: '\n\t' }),
    ).toMatchObject({ questionMissing: true });
  });

  it('비선택 옵션의 공백과 유효한 상세기입은 누락으로 처리하지 않는다', () => {
    const question = makeQuestion({
      type: 'select',
      required: true,
      options: [
        { id: 'selected', value: 'selected-value', label: '선택', allowTextInput: true },
        { id: 'unselected', value: 'unselected-value', label: '미선택', allowTextInput: true },
      ],
    });

    expect(
      collectRequiredOptionTextIssues(question, 'selected-value', {
        selected: '상세 내용',
        unselected: ' ',
      }),
    ).toEqual({ questionMissing: false, cellIds: [] });
  });

  it('질문 ranking은 선택한 상세기입 옵션의 optionText를 검사한다', () => {
    const question = makeQuestion({
      type: 'ranking',
      required: true,
      options: [{ id: 'rank-other', value: 'rank-value', label: '기타', allowTextInput: true }],
    });

    expect(
      collectRequiredOptionTextIssues(question, [
        { rank: 1, optionValue: 'rank-value', optionText: '  ' },
      ], undefined),
    ).toEqual({ questionMissing: true, cellIds: [] });
  });

  it('필수 테이블은 선택된 상세기입이 비어 있는 radio checkbox select와 ranking 셀을 질문 누락으로 처리한다', () => {
    const question = makeQuestion({
      type: 'table',
      required: true,
      tableRowsData: [{
        id: 'row',
        label: '행',
        cells: [
          { id: 'radio', type: 'radio', content: '', radioOptions: [{ id: 'radio-opt', value: 'radio-value', label: 'R', allowTextInput: true }] },
          { id: 'checkbox', type: 'checkbox', content: '', checkboxOptions: [{ id: 'checkbox-opt', value: 'checkbox-value', label: 'C', allowTextInput: true }] },
          { id: 'select', type: 'select', content: '', selectOptions: [{ id: 'select-opt', value: 'select-value', label: 'S', allowTextInput: true }] },
          { id: 'ranking', type: 'ranking', content: '', rankingOptions: [{ id: 'ranking-opt', value: 'ranking-value', label: 'K', allowTextInput: true }] },
        ],
      }],
    });

    expect(collectRequiredOptionTextIssues(
      question,
      {
        radio: 'radio-value',
        checkbox: ['checkbox-value'],
        select: 'select-value',
        ranking: [{ rank: 1, optionValue: 'ranking-value', optionText: '' }],
      },
      { 'radio-opt': '', 'checkbox-opt': '', 'select-opt': '' },
    )).toEqual({ questionMissing: true, cellIds: [] });
  });

  it('필수 상세기입 테이블 셀은 자신의 선택된 옵션이 비어 있으면 cellIds에 담는다', () => {
    const question = makeQuestion({
      type: 'table',
      tableRowsData: [{
        id: 'row',
        label: '행',
        cells: [{
          id: 'required-cell',
          type: 'radio',
          content: '',
          required: true,
          radioOptions: [{ id: 'cell-opt', value: 'cell-value', label: '기타', allowTextInput: true }],
        }],
      }],
    });

    expect(
      collectRequiredOptionTextIssues(question, { 'required-cell': 'cell-value' }, { 'cell-opt': ' ' }),
    ).toEqual({ questionMissing: false, cellIds: ['required-cell'] });
  });

  it('테이블 소스 choice_opt와 ranking_opt의 선택된 상세기입을 검사한다', () => {
    const choiceQuestion = makeQuestion({
      type: 'radio',
      required: true,
      tableRowsData: [{
        id: 'row', label: '행', cells: [{ id: 'choice-source', type: 'choice_opt', content: '기타', allowTextInput: true }],
      }],
    });
    const rankingQuestion = makeQuestion({
      type: 'ranking',
      required: true,
      rankingConfig: { optionsSource: 'table', positions: 1 },
      tableRowsData: [{
        id: 'row', label: '행', cells: [{ id: 'ranking-source', type: 'ranking_opt', content: '기타', allowTextInput: true }],
      }],
    });

    expect(
      collectRequiredOptionTextIssues(choiceQuestion, 'choice-source', { 'choice-source': '' }),
    ).toEqual({ questionMissing: true, cellIds: [] });
    expect(
      collectRequiredOptionTextIssues(rankingQuestion, [
        { rank: 1, optionValue: 'ranking-source', optionText: ' ' },
      ], undefined),
    ).toEqual({ questionMissing: true, cellIds: [] });
  });

  it('숨겨진 테이블 셀은 context와 isHidden 모두 상세기입 검증에서 제외한다', () => {
    const hiddenCell: TableCell = {
      id: 'hidden', type: 'radio', content: '', required: true, isHidden: true,
      radioOptions: [{ id: 'hidden-opt', value: 'hidden-value', label: '기타', allowTextInput: true }],
    };
    const visibleCell: TableCell = {
      id: 'visible', type: 'radio', content: '', required: true,
      radioOptions: [{ id: 'visible-opt', value: 'visible-value', label: '기타', allowTextInput: true }],
    };
    const question = makeQuestion({
      type: 'table',
      tableRowsData: [{ id: 'row', label: '행', cells: [hiddenCell, visibleCell] }],
    });

    expect(collectVisibleTableCells(question, { hidden: 'hidden-value', visible: 'visible-value' }, {
      visibleCellIds: new Set(['visible']),
    }).map((cell) => cell.id)).toEqual(['visible']);
    expect(collectRequiredOptionTextIssues(
      question,
      { hidden: 'hidden-value', visible: 'visible-value' },
      { 'hidden-opt': '', 'visible-opt': '작성' },
      { visibleCellIds: new Set(['visible']) },
    )).toEqual({ questionMissing: false, cellIds: [] });
  });
});
