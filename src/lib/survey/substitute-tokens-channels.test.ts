import { describe, expect, it } from 'vitest';
import { substituteTokens } from '@/lib/survey/substitute-tokens';
import { renderMailPreview } from '@/lib/mail/render-preview';

describe('substituteTokens 채널 분리', () => {
  it('삼중괄호는 quotes 에서, 이중괄호는 attrs 에서 가져온다', () => {
    const out = substituteTokens(
      '{{회사명}}은 {{{마케팅유형}}}을 수행 중입니다',
      { 회사명: '메가리서치' },
      { 마케팅유형: '디지털마케팅 전략' },
    );
    expect(out).toBe('메가리서치은 디지털마케팅 전략을 수행 중입니다');
  });

  it('같은 이름이 양쪽에 있어도 채널이 섞이지 않는다', () => {
    const out = substituteTokens(
      '{{이름}} / {{{이름}}}',
      { 이름: '컨택값' },
      { 이름: '인용값' },
    );
    expect(out).toBe('컨택값 / 인용값');
  });

  it('미해결 인용 토큰은 빈 문자열이 된다', () => {
    expect(substituteTokens('앞 {{{없음}}} 뒤', {}, {})).toBe('앞  뒤');
  });

  it('quotes 인자를 생략하면 기존 2-인자 호출과 동일하게 동작한다', () => {
    expect(substituteTokens('{{회사명}} 귀중', { 회사명: '메가리서치' }))
      .toBe('메가리서치 귀중');
  });

  it('키 좌우 공백을 trim 한다', () => {
    expect(substituteTokens('{{{ 이름 }}}', {}, { 이름: 'X' })).toBe('X');
  });

  // 회귀 테스트 — 이 테스트가 깨지면 PII 유출이다. 절대 skip 금지.
  it('인용값 안의 이중괄호는 컨택 attrs 로 재치환되지 않는다', () => {
    const out = substituteTokens(
      '{{{입력인용}}}',
      { 비밀이름: '홍길동' },
      { 입력인용: '{{비밀이름}}' },
    );
    expect(out).toBe('{{비밀이름}}');
    expect(out).not.toContain('홍길동');
  });

  it('컨택값 안의 삼중괄호도 인용으로 재치환되지 않는다', () => {
    const out = substituteTokens(
      '{{주입}}',
      { 주입: '{{{마케팅유형}}}' },
      { 마케팅유형: '디지털마케팅 전략' },
    );
    expect(out).toBe('{{{마케팅유형}}}');
  });
});

describe('메일 미리보기 치환기', () => {
  it('삼중괄호를 훼손하지 않고 그대로 통과시킨다', () => {
    // 인용 채널은 메일에 없다 — 발송 시점엔 응답이 없으므로 원문 유지가 맞다
    const out = renderMailPreview({
      subject: '',
      bodyHtml: '{{{마케팅유형}}}',
      fromName: '',
      sample: { attrs: {}, inviteUrl: null, email: null },
    });
    expect(out.bodyHtml).toContain('{{{마케팅유형}}}');
  });
});
