import { describe, expect, it } from 'vitest';

import type { Question } from '@/types/survey';
import type { StepItem } from '@/utils/group-ordering';

import { groupAttachedItems } from './attached-questions';

/**
 * 앞 문항 설명 밑에 붙이기(`collapseAttachToPrevious`, 2026-11-05 유가공업 「[붙임] 제품 품목 코드표」를 문1 설명 밑으로) —
 * 접어 둔 문항이 페이지에서 바로 앞에 보이는 문항의 설명 밑으로 들어간다.
 */
const item = (id: string, extra: Partial<Question> = {}): StepItem => ({
  question: { id, type: 'table', title: id, required: false, order: 0, ...extra } as Question,
  rootGroupId: null,
  rootGroupName: null,
  subgroupName: null,
});
const attached = (id: string) =>
  item(id, { collapseButtonLabel: '[붙임] 코드표', collapseAttachToPrevious: true });

describe('groupAttachedItems', () => {
  it('붙이기 문항은 바로 앞 문항에 붙고 제자리에서 빠진다', () => {
    const { rendered, attachments } = groupAttachedItems([item('q1'), attached('ref'), item('q2')]);
    expect(rendered.map((i) => i.question.id)).toEqual(['q1', 'q2']);
    expect(attachments.get('q1')?.map((i) => i.question.id)).toEqual(['ref']);
  });

  it('연달아 붙이면 같은 앞 문항에 차례로 붙는다', () => {
    const { rendered, attachments } = groupAttachedItems([
      item('q1'),
      attached('a'),
      attached('b'),
    ]);
    expect(rendered.map((i) => i.question.id)).toEqual(['q1']);
    expect(attachments.get('q1')?.map((i) => i.question.id)).toEqual(['a', 'b']);
  });

  it('페이지 첫 문항이면 붙일 곳이 없어 제자리에 그린다', () => {
    const { rendered, attachments } = groupAttachedItems([attached('ref'), item('q1')]);
    expect(rendered.map((i) => i.question.id)).toEqual(['ref', 'q1']);
    expect(attachments.size).toBe(0);
  });

  it('버튼 글자가 없으면 붙이지 않는다 — 접어 두기를 켠 문항만', () => {
    const { rendered } = groupAttachedItems([
      item('q1'),
      item('x', { collapseAttachToPrevious: true }),
    ]);
    expect(rendered.map((i) => i.question.id)).toEqual(['q1', 'x']);
  });
});
