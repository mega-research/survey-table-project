import { describe, expect, it } from 'vitest';
import { filterOptionTextsForSubmission } from '@/utils/option-text-migration';

describe('filterOptionTextsForSubmission', () => {
  it('drops text for unselected options', () => {
    const result = filterOptionTextsForSubmission(
      ['o1', 'o2'],
      { o1: '입력1', o2: '입력2', o3: '미선택 상태에서 적힌 값' },
    );
    expect(result).toEqual({ o1: '입력1', o2: '입력2' });
  });

  it('drops empty/whitespace-only text', () => {
    const result = filterOptionTextsForSubmission(['o1'], { o1: '   ' });
    expect(result).toBeUndefined();
  });

  it('handles ranking value shape', () => {
    const result = filterOptionTextsForSubmission(
      [{ rank: 1, optionValue: 'o2' }],
      { o2: '랭킹 텍스트' },
    );
    expect(result).toEqual({ o2: '랭킹 텍스트' });
  });

  it('returns undefined for empty input', () => {
    expect(filterOptionTextsForSubmission(['o1'], undefined)).toBeUndefined();
  });

  // options 배열로 value→id 변환 케이스 (실제 컴포넌트 패턴)
  // 응답 value = option.value("1"), optionTexts key = option.id("opt-abc")
  it('maps option.value to option.id via options array for radio', () => {
    const options = [
      { id: 'opt-abc', value: '1' },
      { id: 'opt-def', value: '2' },
    ];
    const result = filterOptionTextsForSubmission(
      '1',
      { 'opt-abc': '라디오 상세', 'opt-def': '미선택 텍스트' },
      options,
    );
    expect(result).toEqual({ 'opt-abc': '라디오 상세' });
  });

  it('maps option.value to option.id via options array for checkbox', () => {
    const options = [
      { id: 'opt-abc', value: '1' },
      { id: 'opt-def', value: '2' },
      { id: 'opt-ghi', value: '3' },
    ];
    const result = filterOptionTextsForSubmission(
      ['1', '3'],
      { 'opt-abc': '상세1', 'opt-def': '미선택', 'opt-ghi': '상세3' },
      options,
    );
    expect(result).toEqual({ 'opt-abc': '상세1', 'opt-ghi': '상세3' });
  });

  it('returns undefined when all selected texts are whitespace-only with options array', () => {
    const options = [{ id: 'opt-abc', value: '1' }];
    const result = filterOptionTextsForSubmission(
      '1',
      { 'opt-abc': '  ' },
      options,
    );
    expect(result).toBeUndefined();
  });

  it('returns undefined when options array yields no id matches', () => {
    const options = [{ id: 'opt-abc', value: '2' }];
    // value="1" 은 어떤 옵션의 value 와도 일치하지 않음
    const result = filterOptionTextsForSubmission(
      '1',
      { 'opt-abc': '텍스트' },
      options,
    );
    expect(result).toBeUndefined();
  });
});
