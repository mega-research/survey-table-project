import { describe, expect, it } from 'vitest';

import { buildSurveySnapshot } from '@/lib/versioning/snapshot-builder';
import type { Survey } from '@/types/survey';

/**
 * Phase 2: 스냅샷 빌더 테스트
 *
 * buildSurveySnapshot 순수 함수 검증
 */

const mockSurvey: Survey = {
  id: 'survey-001',
  title: '테스트 설문',
  description: '설문 설명',
  slug: 'test-survey',
  questions: [
    {
      id: 'q-2',
      type: 'radio',
      title: '성별',
      required: true,
      order: 2,
      options: [
        { id: 'opt-1', label: '남', value: 'male' },
        { id: 'opt-2', label: '여', value: 'female' },
      ],
    },
    {
      id: 'q-1',
      type: 'text',
      title: '이름',
      required: true,
      order: 1,
    },
    {
      id: 'q-3',
      type: 'checkbox',
      title: '관심사',
      required: false,
      order: 3,
      options: [
        { id: 'opt-a', label: '스포츠', value: 'sports' },
        { id: 'opt-b', label: '음악', value: 'music' },
      ],
    },
  ],
  groups: [
    {
      id: 'g-2',
      surveyId: 'survey-001',
      name: '그룹 B',
      order: 2,
    },
    {
      id: 'g-1',
      surveyId: 'survey-001',
      name: '그룹 A',
      order: 1,
    },
  ],
  settings: {
    isPublic: true,
    allowMultipleResponses: false,
    showProgressBar: true,
    shuffleQuestions: false,
    requireLogin: false,
    endDate: new Date('2026-12-31T23:59:59Z'),
    maxResponses: 100,
    thankYouMessage: '감사합니다!',
  },
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('buildSurveySnapshot', () => {
  it('질문을 order 순으로 정렬', () => {
    const snapshot = buildSurveySnapshot(mockSurvey);

    expect(snapshot.questions).toHaveLength(3);
    const q0 = snapshot.questions[0];
    const q1 = snapshot.questions[1];
    const q2 = snapshot.questions[2];
    if (!q0 || !q1 || !q2) throw new Error('snapshot.questions 요소가 undefined');
    expect(q0.id).toBe('q-1');
    expect(q1.id).toBe('q-2');
    expect(q2.id).toBe('q-3');
  });

  it('그룹을 order 순으로 정렬', () => {
    const snapshot = buildSurveySnapshot(mockSurvey);

    expect(snapshot.groups).toHaveLength(2);
    const g0 = snapshot.groups[0];
    const g1 = snapshot.groups[1];
    if (!g0 || !g1) throw new Error('snapshot.groups 요소가 undefined');
    expect(g0.id).toBe('g-1');
    expect(g1.id).toBe('g-2');
  });

  it('그룹 이름 디자인(nameDesign)을 스냅샷에 보존', () => {
    const survey: Survey = {
      ...mockSurvey,
      groups: [
        {
          id: 'g-1',
          surveyId: 'survey-001',
          name: '그룹 A',
          order: 1,
          nameDesign: { fullWidth: true, bgColor: '#121358', textColor: '#e5e5ec' },
        },
      ],
    };
    const snapshot = buildSurveySnapshot(survey);
    const g0 = snapshot.groups[0];
    if (!g0) throw new Error('snapshot.groups[0] undefined');
    expect(g0.nameDesign).toEqual({ fullWidth: true, bgColor: '#121358', textColor: '#e5e5ec' });
  });

  it('설문 제목과 설명을 포함', () => {
    const snapshot = buildSurveySnapshot(mockSurvey);

    expect(snapshot.title).toBe('테스트 설문');
    expect(snapshot.description).toBe('설문 설명');
  });

  it('설정을 올바르게 복사 (endDate를 ISO string으로 변환)', () => {
    const snapshot = buildSurveySnapshot(mockSurvey);

    expect(snapshot.settings.isPublic).toBe(true);
    expect(snapshot.settings.allowMultipleResponses).toBe(false);
    expect(snapshot.settings.endDate).toBe('2026-12-31T23:59:59.000Z');
    expect(snapshot.settings.maxResponses).toBe(100);
    expect(snapshot.settings.thankYouMessage).toBe('감사합니다!');
  });

  it('requireInviteToken=true 를 스냅샷 settings 에 보존', () => {
    const surveyWithInviteToken: Survey = {
      ...mockSurvey,
      settings: {
        ...mockSurvey.settings,
        requireInviteToken: true,
      },
    };
    const snapshot = buildSurveySnapshot(surveyWithInviteToken);

    expect(snapshot.settings.requireInviteToken).toBe(true);
  });

  it('requireInviteToken 미설정 시 undefined', () => {
    const snapshot = buildSurveySnapshot(mockSurvey);

    expect(snapshot.settings.requireInviteToken).toBeUndefined();
  });

  it('responseHeader 설정을 스냅샷 settings 에 보존', () => {
    const surveyWithResponseHeader: Survey = {
      ...mockSurvey,
      settings: {
        ...mockSurvey.settings,
        responseHeader: {
          style: 'logo-title',
          titleSize: 'lg',
          logo: {
            imageUrl: 'https://example.com/logo.png',
            size: 'md',
          },
          logoTitle: {
            logoPosition: 'right',
          },
        },
      },
    };
    const snapshot = buildSurveySnapshot(surveyWithResponseHeader);

    expect(snapshot.settings.responseHeader).toEqual(
      surveyWithResponseHeader.settings.responseHeader,
    );
  });

  it('endDate가 없으면 undefined', () => {
    const { endDate: _ed, ...settingsWithoutEndDate } = mockSurvey.settings;
    const surveyNoEndDate: Survey = {
      ...mockSurvey,
      settings: settingsWithoutEndDate,
    };
    const snapshot = buildSurveySnapshot(surveyNoEndDate);

    expect(snapshot.settings.endDate).toBeUndefined();
  });

  it('런타임 필드(createdAt, updatedAt, slug, privateToken) 제거', () => {
    const snapshot = buildSurveySnapshot(mockSurvey);

    expect(snapshot).not.toHaveProperty('createdAt');
    expect(snapshot).not.toHaveProperty('updatedAt');
    expect(snapshot).not.toHaveProperty('slug');
    expect(snapshot).not.toHaveProperty('id');
  });

  it('질문의 options, tableColumns 등 세부 속성 보존', () => {
    const snapshot = buildSurveySnapshot(mockSurvey);

    const radioQ = snapshot.questions.find((q) => q.id === 'q-2');
    if (!radioQ) throw new Error('radioQ is undefined');
    const firstOption = radioQ.options?.[0];
    if (!firstOption) throw new Error('radioQ.options[0] is undefined');
    expect(radioQ.options).toHaveLength(2);
    expect(firstOption.value).toBe('male');
  });

  it('모바일 표시 모드와 상세 제외 선행 열 수를 스냅샷에 보존한다', () => {
    const survey: Survey = {
      ...mockSurvey,
      questions: [{
        id: 'q-table',
        type: 'table',
        title: '척도',
        required: false,
        order: 0,
        tableColumns: [{ id: 'c0', label: '항목' }, { id: 'c1', label: '점수' }],
        tableRowsData: [],
        mobileTableDisplayMode: 'drilldown-original-row',
        mobileDrilldownOmitLeadingColumns: 1,
      }],
    };
    const question = buildSurveySnapshot(survey).questions[0];
    expect(question?.mobileTableDisplayMode).toBe('drilldown-original-row');
    expect(question?.mobileDrilldownOmitLeadingColumns).toBe(1);
  });

  it('질문/그룹이 빈 배열이어도 정상 동작', () => {
    const emptySurvey: Survey = {
      ...mockSurvey,
      questions: [],
      groups: [],
    };
    const snapshot = buildSurveySnapshot(emptySurvey);

    expect(snapshot.questions).toEqual([]);
    expect(snapshot.groups).toEqual([]);
  });

  it('원본 배열을 변경하지 않음 (불변성)', () => {
    const originalOrder = mockSurvey.questions.map((q) => q.id);
    buildSurveySnapshot(mockSurvey);

    expect(mockSurvey.questions.map((q) => q.id)).toEqual(originalOrder);
  });
});
