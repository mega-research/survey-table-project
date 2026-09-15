import { describe, expect, it } from 'vitest';

import { resolveChoiceGroupSectionLabel } from './choice-group-section-label';

describe('resolveChoiceGroupSectionLabel', () => {
  it('그룹 라벨이 행 제목으로 시작하면 구분 기호 뒤의 축 이름만 남긴다', () => {
    expect(
      resolveChoiceGroupSectionLabel(
        '1) (추진 중) 시스템반도체 얼라이언스 운영 - 인지여부',
        '1) (추진 중) 시스템반도체 얼라이언스 운영\n팹리스 수요-공급기업 간 협력',
      ),
    ).toBe('인지여부');
    expect(resolveChoiceGroupSectionLabel('2) 시험 지원 -  필요성', '2) 시험 지원')).toBe('필요성');
    expect(resolveChoiceGroupSectionLabel('항목: 참여 의향', '항목')).toBe('참여 의향');
  });

  it('접두가 아니면 그룹 라벨 그대로다', () => {
    expect(resolveChoiceGroupSectionLabel('2025년 12월 기준', '① 취업')).toBe('2025년 12월 기준');
  });

  it('접두를 떼고 남는 것이 없으면 그룹 라벨 그대로다', () => {
    expect(resolveChoiceGroupSectionLabel('1) 운영', '1) 운영')).toBe('1) 운영');
  });

  it('그룹 라벨이 비면 fallback', () => {
    expect(resolveChoiceGroupSectionLabel('', '행', '열 제목')).toBe('열 제목');
    expect(resolveChoiceGroupSectionLabel(undefined, undefined)).toBe('');
  });
});
