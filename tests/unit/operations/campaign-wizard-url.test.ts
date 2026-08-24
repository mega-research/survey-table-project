import { describe, expect, it } from 'vitest';

import { buildTemplateRedirectQuery } from '@/lib/operations/campaign-wizard-url';

/**
 * 마법사는 templateId 없이 진입하면 첫 템플릿으로 리다이렉트한다. 그때 쿼리를
 * 통째로 버리면 "미응답자 재발송" 동선이 필터·자동선택을 전부 잃는다.
 * 템플릿이 hard-delete 된 캠페인은 mailTemplateId 가 NULL 이라 실제로 이 경로를 탄다.
 */
describe('buildTemplateRedirectQuery', () => {
  it('기존 쿼리를 모두 보존하고 templateId 만 채운다', () => {
    const qs = buildTemplateRedirectQuery(
      {
        templateId: '',
        col: ['attrs.지역', 'system.contact_result'],
        q: ['서울', '1.조사완료'],
        op: ['', 'AND'],
        hcol: 'recipient.group',
        hm: 'in',
        hv: '모바일',
        unresponded: '1',
        autoSelectAll: '1',
      },
      'tpl-1',
    );

    const p = new URLSearchParams(qs);
    expect(p.get('templateId')).toBe('tpl-1');
    expect(p.getAll('col')).toEqual(['attrs.지역', 'system.contact_result']);
    expect(p.getAll('q')).toEqual(['서울', '1.조사완료']);
    expect(p.getAll('op')).toEqual(['', 'AND']);
    expect(p.getAll('hcol')).toEqual(['recipient.group']);
    expect(p.get('unresponded')).toBe('1');
    expect(p.get('autoSelectAll')).toBe('1');
  });

  it('빈 templateId 는 중복으로 남지 않는다', () => {
    const p = new URLSearchParams(buildTemplateRedirectQuery({ templateId: '' }, 'tpl-1'));
    expect(p.getAll('templateId')).toEqual(['tpl-1']);
  });

  it('쿼리가 없으면 templateId 만 담는다', () => {
    expect(buildTemplateRedirectQuery({}, 'tpl-1')).toBe('templateId=tpl-1');
  });
});
