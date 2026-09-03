import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GroupManager } from '@/components/survey-builder/group-manager';
import { useSurveyBuilderStore } from '@/stores/survey-store';
import type { QuestionGroup } from '@/types/survey';

/**
 * 그룹 관리 패널은 그룹 트리를 깊이에 상관없이 전부 나열해야 한다 — 2단계에서 멈추면
 * 하위 그룹의 하위 그룹은 편집·삭제·재배치할 방법이 없다.
 */

vi.mock('@/shared/lib/rpc', () => ({
  client: { surveyBuilder: { groups: { create: vi.fn(), update: vi.fn(), delete: vi.fn() } } },
}));

const groups: QuestionGroup[] = [
  { id: 'g1', surveyId: 's1', name: '최상위 그룹', order: 0 },
  { id: 'g2', surveyId: 's1', name: '하위 그룹', order: 0, parentGroupId: 'g1' },
  { id: 'g3', surveyId: 's1', name: '손자 그룹', order: 0, parentGroupId: 'g2' },
];

describe('GroupManager — 3단계 그룹 나열', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
    useSurveyBuilderStore.getState().setSurvey({
      id: 's1',
      title: 't',
      description: '',
      slug: '',
      privateToken: 'tok',
      groups,
      questions: [],
      lookups: [],
      settings: useSurveyBuilderStore.getState().currentSurvey.settings,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });
  afterEach(() => cleanup());

  it('펼친 상태에서 하위 그룹의 하위 그룹까지 나열된다', async () => {
    render(<GroupManager />);
    expect(await screen.findByText('하위 그룹')).toBeInTheDocument();
    expect(screen.getByText('손자 그룹')).toBeInTheDocument();
  });
});
