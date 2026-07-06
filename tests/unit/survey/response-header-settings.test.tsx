import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ResponseHeaderSettings } from '@/components/survey-builder/response-header-settings';
import { DEFAULT_COMPOSED_RESPONSE_HEADER } from '@/lib/survey/response-header-config';
import type { SurveySettings } from '@/types/survey';
import type { SurveyResponseHeaderConfig } from '@/db/schema/schema-types';

vi.mock('@/components/survey-builder/cell-image-editor', () => ({
  CellImageEditor: ({ imageUrl }: { imageUrl: string }) => <div data-testid="image-editor">{imageUrl}</div>,
}));

const baseSettings = (responseHeader?: SurveyResponseHeaderConfig): SurveySettings => ({
  isPublic: true, allowMultipleResponses: false, showProgressBar: true,
  shuffleQuestions: false, requireLogin: false, thankYouMessage: '',
  // exactOptionalPropertyTypes: 키를 아예 생략해야 optional 계약을 지킨다 (undefined 명시 대입 금지)
  ...(responseHeader !== undefined ? { responseHeader } : {}),
});

function setup(responseHeader?: SurveyResponseHeaderConfig) {
  const onChange = vi.fn();
  const onTitleChange = vi.fn();
  render(
    <ResponseHeaderSettings title="설문 제목" onTitleChange={onTitleChange} settings={baseSettings(responseHeader)} onChange={onChange} />,
  );
  return { onChange, onTitleChange };
}

// 버튼 클릭·텍스트 입력 모두 fireEvent 사용 — onChange 가 vi.fn()(비제어 mock)이라 컴포넌트가
// 부모 상태로 재렌더되지 않는다. userEvent.type 은 키 입력마다 이벤트를 나눠 보내므로 매 입력마다
// 최신 값을 반영해 재렌더되는 제어 컴포넌트를 전제하는데, 이 목업 환경에서는 미갱신 값으로 이벤트가
// 나가 전체 값 단언이 불가능하다. fireEvent.change/click 은 단일 이벤트로 최종 값을 그대로 전달하므로
// 이 테스트 목적에 부합한다 (shadcn Button 은 플레인 button 이라 fireEvent.click 으로 충분).
describe('ResponseHeaderSettings (composed)', () => {
  it('국가통계형 프리셋 적용 시 composed 구성(블록 4개)을 방출한다', () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: '프리셋 국가통계형' }));
    const config = onChange.mock.calls[0]![0];
    expect(config.style).toBe('composed');
    expect(config.blocks.map((b: { type: string }) => b.type)).toEqual(['mark', 'notice', 'logo', 'logo']);
    expect(config.bandStyle).toBe('band');
  });

  it('+ 로고 클릭 시 로고 블록이 추가된다', () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: '+ 로고' }));
    const config = onChange.mock.calls[0]![0];
    expect(config.blocks).toHaveLength(1);
    expect(config.blocks[0]).toMatchObject({ type: 'logo', pos: 'right', size: 'md', imageUrl: '' });
  });

  it('블록 삭제 버튼이 해당 블록을 제거한다', () => {
    const { onChange } = setup({
      ...DEFAULT_COMPOSED_RESPONSE_HEADER,
      blocks: [{ id: 'l1', type: 'logo', pos: 'right', size: 'md', imageUrl: '', altText: '', frame: 'none' }],
    });
    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    expect(onChange.mock.calls[0]![0].blocks).toHaveLength(0);
  });

  it('문구 블록을 한줄형으로 전환하면 pos가 above로 보정된다', () => {
    const { onChange } = setup({
      ...DEFAULT_COMPOSED_RESPONSE_HEADER,
      blocks: [{ id: 'n1', type: 'notice', pos: 'left', size: 'md', format: 'box', title: 't', boxBody: 'b', lineBody: 'l', alignBox: 'left', alignLine: 'center', fontSize: null }],
    });
    fireEvent.click(screen.getByRole('button', { name: '한줄형' }));
    expect(onChange.mock.calls[0]![0].blocks[0]).toMatchObject({ format: 'line', pos: 'above' });
  });

  it('제목 옆 배치로 전환하면 블록 위치가 보정된다', () => {
    const { onChange } = setup({
      ...DEFAULT_COMPOSED_RESPONSE_HEADER,
      blocks: [{ id: 'l1', type: 'logo', pos: 'title-right', size: 'md', imageUrl: '', altText: '', frame: 'none' }],
    });
    fireEvent.click(screen.getByRole('button', { name: '제목 옆 배치' }));
    const config = onChange.mock.calls[0]![0];
    expect(config.layout).toBe('inline');
    expect(config.blocks[0].pos).toBe('right');
  });

  it('제목 입력은 onTitleChange를 호출한다 (설문 제목 단일 소스)', () => {
    const { onTitleChange, onChange } = setup();
    fireEvent.change(screen.getByLabelText('제목'), { target: { value: '새 제목' } });
    expect(onTitleChange).toHaveBeenCalledWith('새 제목');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('부제목 입력은 config.subtitle을 갱신한다', () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByLabelText('부제목'), { target: { value: '(본 조사)' } });
    expect(onChange.mock.calls[0]![0].subtitle).toBe('(본 조사)');
  });

  it('밴드 스타일과 배경 스와치를 변경한다', () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole('button', { name: '테두리 박스' }));
    expect(onChange.mock.calls[0]![0].bandStyle).toBe('boxed');
    fireEvent.click(screen.getByRole('button', { name: '밴드 배경 #cfe0ad' }));
    expect(onChange.mock.calls[1]![0].bandBg).toBe('#cfe0ad');
  });
});
