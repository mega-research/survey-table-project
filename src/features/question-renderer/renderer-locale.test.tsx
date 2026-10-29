/**
 * 안내문 확인 · 응답 머리 기본 제목 · 다단계 선택 안내 — 다국어 설문의 현재 언어로 그린다.
 * 저작자가 적은 글자(안내문 본문 · 블록 제목 · 단계 placeholder)는 그대로다.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { SurveyResponseHeaderConfig } from '@/shared/contracts/survey';
import type { SelectLevel } from '@/types/survey';

import { NoticeRenderer } from './notice-renderer';
import { SurveyLocaleProvider } from './survey-locale-context';
import { SurveyResponseHeader } from './survey-response-header';
import { UserDefinedMultiLevelSelect } from './user-defined-multi-level-select';

afterEach(cleanup);

describe('응답 화면 시스템 글자 현재 언어', () => {
  it('中文 — 안내문 확인 문구와 미확인 안내가 중국어다', () => {
    render(
      <SurveyLocaleProvider locale="zh">
        <NoticeRenderer content="<p>说明</p>" requiresAcknowledgment />
      </SurveyLocaleProvider>,
    );
    expect(screen.getByLabelText('我已阅读并理解以上内容。')).toBeInTheDocument();
    expect(screen.getByText(/请确认以上内容并勾选。/)).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/[가-힣]/);
  });

  it('English — 응답 머리 문구 블록의 제목을 비우면 영어 기본 제목이다', () => {
    const header: SurveyResponseHeaderConfig = {
      style: 'composed',
      blocks: [
        {
          id: 'n1',
          type: 'notice',
          pos: 'left',
          size: 'md',
          format: 'box',
          title: '',
          boxBody: 'Body',
          lineBody: '',
        },
      ],
    };
    render(
      <SurveyLocaleProvider locale="en">
        <SurveyResponseHeader title="Survey" device="mobile" responseHeader={header} />
      </SurveyLocaleProvider>,
    );
    expect(
      screen.getByText('Statistics Act, Article 33 (Protection of Confidentiality)'),
    ).toBeInTheDocument();
  });

  it('English — 다단계 선택의 placeholder 를 비우면 「Select 단계 이름」이다', () => {
    const levels: SelectLevel[] = [
      { id: 'l1', label: 'Region', order: 0, options: [{ id: 'o1', label: 'Seoul', value: '1' }] },
    ];
    render(
      <SurveyLocaleProvider locale="en">
        <UserDefinedMultiLevelSelect levels={levels} values={[]} onChange={() => {}} />
      </SurveyLocaleProvider>,
    );
    expect(screen.getByRole('option', { name: 'Select Region' })).toBeInTheDocument();
  });
});
