import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MobileTableDisplaySettings } from '@/features/survey-builder/table-editor/mobile-table-display-settings';
import type { MobileTableDisplayMode } from '@/types/mobile-table-display';

/**
 * 모바일 표시 방식 옆의 척도 슬라이더 안내 — 슬라이더가 켜진 표는 고른 표시 방식보다 슬라이더의 배치가
 * 앞선다는 것과, 행 단위 배치의 설정(앞쪽 열 제외 수 · 반복 헤더 범위)을 표시 방식과 무관하게 보인다
 * (CONTEXT.md 「척도 슬라이더」). 표시 방식 선택 자체는 막지 않는다.
 */

const base = { omitLeadingColumns: 1, columnCount: 8, onChange: vi.fn(), questionType: 'table' as const };
const DRAWN = { enabled: true, hasSliderRow: true };
const note = () => screen.queryByTestId('scale-slider-layout-note');

describe('MobileTableDisplaySettings — 척도 슬라이더가 꺼진 표', () => {
  afterEach(cleanup);

  it('안내가 없고 행 단위 배치 설정은 지금처럼 표시 방식에 따라 보인다', () => {
    const { rerender } = render(<MobileTableDisplaySettings mode="auto" {...base} />);
    expect(note()).toBeNull();
    expect(screen.queryByLabelText('상세에서 제외할 앞쪽 열 수')).toBeNull();
    expect(screen.queryByLabelText('상세에서 반복할 헤더 행')).toBeNull();

    rerender(
      <MobileTableDisplaySettings
        mode="auto"
        {...base}
        scaleSlider={{ enabled: false, hasSliderRow: false }}
      />,
    );
    expect(note()).toBeNull();
    expect(screen.queryByLabelText('상세에서 제외할 앞쪽 열 수')).toBeNull();
  });
});

describe('MobileTableDisplaySettings — 척도 슬라이더가 켜진 표', () => {
  afterEach(cleanup);

  it('「행 단위로 그려진다」는 안내가 보이고 표시 방식은 여전히 고를 수 있다', () => {
    render(<MobileTableDisplaySettings mode="auto" {...base} scaleSlider={DRAWN} />);
    expect(note()).toHaveTextContent('척도 슬라이더가 켜져 있어 웹과 모바일 모두 행 단위로 그려집니다');
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeEnabled();
  });

  it('「행 단위 그룹 카드」를 고른 표는 그 카드 안에서 그려진다고 알린다', () => {
    render(
      <MobileTableDisplaySettings mode="row-group-cards" {...base} hasChoiceGroups scaleSlider={DRAWN} />,
    );
    expect(note()).toHaveTextContent('모바일은 「행 단위 그룹 카드」 안에서');
    expect(note()).toHaveTextContent('웹은 행 단위로 그려집니다');
    // 그 카드는 고른 표시 방식 그대로다 — 「행별 척도」처럼 바뀐다는 말은 하지 않는다
    expect(note()).not.toHaveTextContent('고른 표시 방식 대신');
  });

  it.each<MobileTableDisplayMode>(['auto', 'row-wise-original', 'drilldown-original-row', 'original'])(
    '표시 방식 %s — 모바일도 「행별 척도」처럼 그려져 다른 보기 그룹이 제 보기 모양으로 바뀐다고 알린다',
    (mode) => {
      render(<MobileTableDisplaySettings mode={mode} {...base} scaleSlider={DRAWN} />);
      expect(note()).toHaveTextContent('고른 표시 방식 대신 「행별 척도」처럼 그려져');
      expect(note()).toHaveTextContent('슬라이더가 아닌 보기 그룹은 제 보기 모양');
    },
  );

  it('이미 「행별 척도」인 표에는 그 안내가 없다 — 모바일 화면이 달라지지 않는다', () => {
    render(<MobileTableDisplaySettings mode="row-wise-scale" {...base} scaleSlider={DRAWN} />);
    expect(note()).toHaveTextContent('행 단위로 그려집니다');
    expect(note()).not.toHaveTextContent('고른 표시 방식 대신');
  });

  it('웹의 행 단위 배치가 읽지 않는 표 전용 장치를 알린다', () => {
    render(<MobileTableDisplaySettings mode="auto" {...base} scaleSlider={DRAWN} />);
    for (const device of ['좌측 고정 열', '화면 폭에 맞춰 표 줄이기', '상세 기재 입력칸을 표 아래에', '머리글 입력칸']) {
      expect(note()).toHaveTextContent(device);
    }
    expect(note()).toHaveTextContent('슬라이더가 아닌 보기 그룹은 원본 표 조각으로 보입니다');
  });

  it.each<MobileTableDisplayMode>(['auto', 'row-cards', 'row-group-cards', 'original', 'row-wise-scale'])(
    '표시 방식 %s — 행 단위 배치 설정 입력이 보이고 슬라이더가 그 값을 읽는다고 적혀 있다',
    (mode) => {
      render(
        <MobileTableDisplaySettings
          mode={mode}
          {...base}
          questionType="radio"
          hasChoiceGroups
          scaleSlider={DRAWN}
        />,
      );
      expect(screen.getByLabelText('상세에서 제외할 앞쪽 열 수')).toHaveValue(1);
      expect(screen.getByLabelText('상세에서 반복할 헤더 행')).toBeInTheDocument();
      expect(screen.getByText(/척도 슬라이더의 행 단위 배치.*이 두 값을 읽습니다/)).toBeInTheDocument();
    },
  );

  it('설정은 있는데 그릴 수 있는 행이 없으면 화면이 바뀌지 않는다고 알리고 설정 입력은 늘리지 않는다', () => {
    render(
      <MobileTableDisplaySettings
        mode="auto"
        {...base}
        scaleSlider={{ enabled: true, hasSliderRow: false }}
      />,
    );
    expect(note()).toHaveTextContent('슬라이더로 그릴 수 있는 행이 없어 화면이 바뀌지 않습니다');
    expect(note()).not.toHaveTextContent('행 단위로 그려집니다');
    expect(screen.queryByLabelText('상세에서 제외할 앞쪽 열 수')).toBeNull();
  });

  it('안내는 경고 상자가 아니다 — 막는 일이 아니다', () => {
    render(<MobileTableDisplaySettings mode="auto" {...base} scaleSlider={DRAWN} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('MobileTableDisplaySettings — 「행별 척도」 설명의 보기 모양', () => {
  afterEach(cleanup);

  it('보기 모양 넷을 적는다 — 세로 타일 · 원본 한 줄 · 척도 막대 · 척도 슬라이더', () => {
    render(<MobileTableDisplaySettings mode="auto" {...base} hasChoiceGroups />);
    const option = screen.getByRole('radio', { name: '행별 척도' }).closest('label');
    expect(option).toHaveTextContent('보기 모양(세로 타일 · 원본 한 줄 · 척도 막대 · 척도 슬라이더)');
  });
});
