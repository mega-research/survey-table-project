import { describe, expect, it } from 'vitest';

import { isTokenPrefilled, resolveTokenPrefill } from './token-prefill';

describe('resolveTokenPrefill — 잠금은 명단에서 값이 왔을 때만', () => {
  it('명단 값이 있으면 그 값으로 잠근다', () => {
    expect(resolveTokenPrefill('{{기업명}}', { 기업명: '메가리서치' })).toBe('메가리서치');
    expect(isTokenPrefilled('{{기업명}}', { 기업명: '메가리서치' })).toBe(true);
  });

  it('명단 값이 없거나 비면 잠그지 않는다 — 응답자가 직접 적는다', () => {
    expect(resolveTokenPrefill('{{기업명}}', {})).toBeNull();
    expect(resolveTokenPrefill('{{기업명}}', { 기업명: '' })).toBeNull();
    expect(resolveTokenPrefill('{{기업명}}', { 기업명: undefined })).toBeNull();
    // 초대 링크 없이 들어온 응답자는 명단 값이 아예 없다
    expect(resolveTokenPrefill('{{기업명}}', null)).toBeNull();
    expect(isTokenPrefilled('{{기업명}}', {})).toBe(false);
  });

  it('치환 결과가 공백뿐이면 빈 것으로 본다', () => {
    expect(resolveTokenPrefill('{{성}} {{이름}}', {})).toBeNull();
    expect(resolveTokenPrefill('{{기업명}}', { 기업명: '   ' })).toBeNull();
  });

  it('토큰 일부만 비어도 남은 글자가 있으면 잠근다', () => {
    expect(resolveTokenPrefill('{{성}} {{이름}}', { 이름: '길동' })).toBe(' 길동');
  });

  it('템플릿이 없으면 프리필이 아니다', () => {
    expect(resolveTokenPrefill(undefined, { 기업명: '메가리서치' })).toBeNull();
    expect(resolveTokenPrefill(null, { 기업명: '메가리서치' })).toBeNull();
    expect(resolveTokenPrefill('   ', { 기업명: '메가리서치' })).toBeNull();
  });

  it('토큰 없는 고정 글자 템플릿은 종전대로 그 글자로 잠근다', () => {
    expect(resolveTokenPrefill('해당 없음', {})).toBe('해당 없음');
  });
});
