/**
 * P0-6 회귀 테스트 — GroupHeader 는 액션 하나만 구독한다.
 *
 * 이전에는 `useSurveyBuilderStore()` 전체 구독이라 스토어의 모든 set 에 리렌더됐다.
 * GroupHeader 는 그룹 수만큼 렌더되므로 무관한 상태 변경까지 전부 타고 들어왔다.
 * 표시값은 props/context 에서만 오므로 액션 셀렉터로 바꿔도 렌더 결과는 같아야 한다.
 */
import { Profiler, type ProfilerOnRenderCallback } from 'react';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GroupHeader } from '@/features/survey-builder/question-list/group-header';
import { ContactAttrsProvider, createPlaceholderAttrs } from '@/features/question-renderer/contact-attrs-context';
import { useSurveyBuilderStore } from '@/features/survey-builder/stores/survey-store';

function seedGroup(name: string) {
  useSurveyBuilderStore.getState().addGroup(name);
  const group = useSurveyBuilderStore.getState().currentSurvey.groups?.[0];
  if (!group) throw new Error('그룹 생성 실패');
  return group;
}

describe('GroupHeader — 스토어 구독 범위', () => {
  beforeEach(() => {
    useSurveyBuilderStore.getState().resetSurvey();
  });
  afterEach(() => {
    cleanup();
  });

  it('그룹과 무관한 스토어 변경에는 리렌더되지 않는다', () => {
    const group = seedGroup('1부');

    let renderCount = 0;
    const onRender: ProfilerOnRenderCallback = () => {
      renderCount += 1;
    };

    render(
      <ContactAttrsProvider attrs={{}} quotes={createPlaceholderAttrs({})}>
        <Profiler id="group-header" onRender={onRender}>
          <GroupHeader group={group} questionCount={0} />
        </Profiler>
      </ContactAttrsProvider>,
    );

    const initial = renderCount;
    act(() => {
      useSurveyBuilderStore.getState().updateSurveyTitle('다른 제목');
    });

    expect(renderCount).toBe(initial);
  });

  it('헤더 클릭이 스토어의 그룹 접힘을 토글한다', () => {
    const group = seedGroup('1부');

    render(
      <ContactAttrsProvider attrs={{}} quotes={createPlaceholderAttrs({})}>
        <GroupHeader group={group} questionCount={0} />
      </ContactAttrsProvider>,
    );

    fireEvent.click(screen.getByRole('heading', { level: 3, name: '1부' }));

    expect(useSurveyBuilderStore.getState().currentSurvey.groups?.[0]?.collapsed).toBe(true);
  });
});
