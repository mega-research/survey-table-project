import { afterEach, describe, expect, it } from 'vitest';

import type { VariableDef } from '@/shared/contracts/template-variables';
import { useSurveyUIStore } from '@/features/survey-builder/stores/ui-store';

// survey-store 에서 ui-store 로 옮긴 빌더 UI 필드(editingQuestionId / variableCatalog)의
// 초기값과 세터 동작이 기존 의미론과 동일한지 검증한다.

const initialState = useSurveyUIStore.getState();

afterEach(() => {
  // 다른 테스트로의 상태 누수 방지
  useSurveyUIStore.setState({
    editingQuestionId: initialState.editingQuestionId,
    variableCatalog: initialState.variableCatalog,
  });
});

describe('useSurveyUIStore 빌더 UI 필드', () => {
  it('editingQuestionId 초기값은 null 이다', () => {
    expect(useSurveyUIStore.getState().editingQuestionId).toBeNull();
  });

  it('variableCatalog 초기값은 빈 배열이다', () => {
    expect(useSurveyUIStore.getState().variableCatalog).toEqual([]);
  });

  it('setEditingQuestionId 로 값 설정과 null 초기화가 가능하다', () => {
    useSurveyUIStore.getState().setEditingQuestionId('q1');
    expect(useSurveyUIStore.getState().editingQuestionId).toBe('q1');

    useSurveyUIStore.getState().setEditingQuestionId(null);
    expect(useSurveyUIStore.getState().editingQuestionId).toBeNull();
  });

  it('setVariableCatalog 로 카탈로그를 교체한다', () => {
    const catalog: VariableDef[] = [
      { key: 'attrs_name', label: '이름', category: 'attrs' },
    ];
    useSurveyUIStore.getState().setVariableCatalog(catalog);
    expect(useSurveyUIStore.getState().variableCatalog).toBe(catalog);
  });
});
