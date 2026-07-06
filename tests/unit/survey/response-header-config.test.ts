import { describe, expect, it } from 'vitest';

import type { SurveyResponseHeaderConfig } from '@/db/schema/schema-types';
import {
  DEFAULT_COMPOSED_RESPONSE_HEADER,
  DEFAULT_NOTICE_LINE,
  DEFAULT_RESPONSE_HEADER_CONFIG,
  DEFAULT_STATISTIC_NOTICE,
  applyResponseHeaderPreset,
  coerceBlocksForInlineLayout,
  createHeaderBlock,
  getHeaderBandBorders,
  getLogoAlignClass,
  getLogoSizeClass,
  getNoticeWidthClass,
  getTitleAlignClass,
  getTitleSizeClass,
  normalizeResponseHeaderConfig,
  noticeFormatPatch,
  partitionHeaderBlocks,
  resolveHeaderTitlePx,
  resolveMobileHeaderTitlePx,
  resolveResponseHeaderConfig,
} from '@/lib/survey/response-header-config';
import type { NormalizedHeaderNoticeBlock } from '@/lib/survey/response-header-config';

describe('response-header-config', () => {
  it('통계법 기본 문구는 제품 스펙 문구를 사용한다', () => {
    expect(DEFAULT_STATISTIC_NOTICE).toEqual({
      title: '통계법 제33조(비밀의 보호)',
      body: '통계의 작성 과정에서 알려진 사항으로서 개인이나 법인 또는 단체의 비밀에 속하는 사항은 보호되어야 한다.',
      width: 'md',
    });
  });

  it('undefined 설정은 기본 응답 헤더 설정으로 정규화한다', () => {
    expect(normalizeResponseHeaderConfig(undefined)).toEqual(DEFAULT_RESPONSE_HEADER_CONFIG);
  });

  it('null 설정은 기본 응답 헤더 설정으로 정규화한다', () => {
    expect(normalizeResponseHeaderConfig(null)).toEqual(DEFAULT_RESPONSE_HEADER_CONFIG);
  });

  it('logo-title 설정의 누락된 중첩값을 기본값으로 채운다', () => {
    expect(
      normalizeResponseHeaderConfig({
        style: 'logo-title',
        titleSize: 'lg',
        logo: { imageUrl: 'https://example.com/logo.png' },
      } as never),
    ).toEqual({
      style: 'logo-title',
      titleSize: 'lg',
      titleAlign: 'center',
      logo: {
        imageUrl: 'https://example.com/logo.png',
        altText: '',
        size: 'md',
      },
      logoTitle: {
        logoPosition: 'left',
      },
    });
  });

  it('official-band 설정의 통계 안내문과 폭 기본값을 채운다', () => {
    expect(
      normalizeResponseHeaderConfig({
        style: 'official-band',
        titleSize: 'md',
        logo: {
          imageUrl: 'https://example.com/logo.png',
          size: 'lg',
        },
        officialBand: {
          arrangement: 'logo-left-stat-right',
        },
      } as never),
    ).toEqual({
      style: 'official-band',
      titleSize: 'md',
      titleAlign: 'center',
      logo: {
        imageUrl: 'https://example.com/logo.png',
        altText: '',
        size: 'lg',
      },
      officialBand: {
        arrangement: 'logo-left-stat-right',
        logoAlign: 'top',
        statisticNotice: {
          ...DEFAULT_STATISTIC_NOTICE,
          width: 'md',
        },
      },
    });
  });

  it('로고 크기는 고정 높이로 단계별 차이를 보장한다', () => {
    // 회귀: 과거 max-h-*(최댓값)만 반환해 작은 로고는 sm/md/lg 가 동일하게 보였다.
    expect(getLogoSizeClass('sm')).toBe('h-10 max-w-[180px]');
    expect(getLogoSizeClass('md')).toBe('h-16 max-w-[240px]');
    expect(getLogoSizeClass('lg')).toBe('h-24 max-w-[340px]');
  });

  it('통계법 박스 좁게는 충분히 좁은 폭을 사용한다', () => {
    expect(getNoticeWidthClass('sm')).toBe('md:max-w-[200px]');
    expect(getNoticeWidthClass('md')).toBe('md:max-w-[280px]');
    expect(getNoticeWidthClass('lg')).toBe('md:max-w-[360px]');
  });

  it('제목 크기 헬퍼는 의미 있는 Tailwind 클래스를 반환한다', () => {
    expect(getTitleSizeClass('lg')).toContain('text-3xl');
  });

  it('제목 정렬 클래스를 매핑한다', () => {
    expect(getTitleAlignClass('left')).toBe('text-left');
    expect(getTitleAlignClass('center')).toBe('text-center');
    expect(getTitleAlignClass('right')).toBe('text-right');
  });

  it('로고 세로 정렬 클래스를 매핑한다', () => {
    expect(getLogoAlignClass('top')).toBe('md:items-start');
    expect(getLogoAlignClass('center')).toBe('md:items-center');
    expect(getLogoAlignClass('bottom')).toBe('md:items-end');
  });

  it('정규화는 제목 정렬 기본값을 스타일별로 채운다', () => {
    expect(normalizeResponseHeaderConfig({ style: 'plain', titleSize: 'auto' }).titleAlign).toBe(
      'left',
    );
    expect(
      normalizeResponseHeaderConfig({
        style: 'logo-title',
        titleSize: 'auto',
        logo: { imageUrl: 'https://example.com/logo.png' },
      } as never).titleAlign,
    ).toBe('center');
  });

  it('정규화는 official-band 로고 세로 정렬 기본값을 top 으로 채운다', () => {
    const config = normalizeResponseHeaderConfig({
      style: 'official-band',
      titleSize: 'auto',
      logo: { imageUrl: 'https://example.com/logo.png' },
    } as never);
    expect(config.style === 'official-band' ? config.officialBand.logoAlign : null).toBe('top');
  });
});

describe('resolveResponseHeaderConfig (composed)', () => {
  it('null 입력이면 composed 기본값을 반환한다', () => {
    expect(resolveResponseHeaderConfig(null)).toEqual(DEFAULT_COMPOSED_RESPONSE_HEADER);
    expect(DEFAULT_COMPOSED_RESPONSE_HEADER).toMatchObject({
      style: 'composed', layout: 'stacked', mobileStyle: 'gov',
      bandStyle: 'plain', bandBg: '#ffffff', blocks: [], titlePx: null,
    });
  });

  it('composed 입력의 열거값 이상치를 기본값으로 보정한다', () => {
    const result = resolveResponseHeaderConfig({
      style: 'composed', layout: 'diagonal', bandStyle: 'neon', mobileStyle: 'x',
      titleScale: 'xl', titlePx: 999, blocks: [
        { id: '', type: 'notice', pos: 'above', size: 'md', format: 'box', title: 't', boxBody: 'b', lineBody: 'l', fontSize: 100 },
        { id: 'n2', type: 'notice', pos: 'center', size: 'md', format: 'line', title: '', boxBody: '', lineBody: 'l2' },
        { id: 'x1', type: 'alien', pos: 'left', size: 'md' },
      ],
    } as never);
    expect(result.layout).toBe('stacked');
    expect(result.bandStyle).toBe('plain');
    expect(result.mobileStyle).toBe('gov');
    expect(result.titleScale).toBe('md');
    expect(result.titlePx).toBe(72); // 14~72 클램프
    expect(result.blocks).toHaveLength(2); // 미지 type 드롭
    expect(result.blocks[0]).toMatchObject({ id: 'block-0', pos: 'left', fontSize: 28 }); // box인데 above → left, fontSize 9~28 클램프
    expect(result.blocks[1]).toMatchObject({ pos: 'above' }); // line인데 center → above
  });

  it('layout이 inline이면 위치를 보정한다 — center·title-left→left, title-right→right, above/below 유지', () => {
    const result = resolveResponseHeaderConfig({
      style: 'composed', layout: 'inline', blocks: [
        { id: 'a', type: 'logo', pos: 'center', size: 'md', imageUrl: '' },
        { id: 'b', type: 'logo', pos: 'title-left', size: 'md', imageUrl: '' },
        { id: 'c', type: 'mark', pos: 'title-right', size: 'md', imageUrl: '' },
        { id: 'd', type: 'notice', pos: 'above', size: 'md', format: 'line', title: '', boxBody: '', lineBody: 'x' },
      ],
    });
    expect(result.blocks.map((b) => b.pos)).toEqual(['left', 'left', 'right', 'above']);
  });

  it('같은 입력에 대해 결정적이다 (id 생성 없음)', () => {
    const input = { style: 'composed' as const, blocks: [{ id: 'k1', type: 'mark' as const, pos: 'left' as const, size: 'lg' as const, imageUrl: 'https://x/m.png' }] };
    expect(resolveResponseHeaderConfig(input)).toEqual(resolveResponseHeaderConfig(input));
  });

  it('기존 normalizeResponseHeaderConfig는 composed 입력을 그대로 통과시킨다 (읽기 경로 왕복 보존)', () => {
    const stored: SurveyResponseHeaderConfig = { style: 'composed', blocks: [] };
    expect(normalizeResponseHeaderConfig(stored)).toBe(stored); // Task 8 통합 전까지의 안전장치
  });
});

describe('resolveResponseHeaderConfig (v1 마이그레이션)', () => {
  it('plain을 블록 없는 composed로 매핑한다', () => {
    const result = resolveResponseHeaderConfig({ style: 'plain', titleSize: 'lg', titleAlign: 'right' });
    expect(result).toMatchObject({
      style: 'composed', blocks: [], bandStyle: 'plain', bandBg: '#ffffff',
      titleAlign: 'right', titleTextAlign: 'right', titleScale: 'md', mobileStyle: 'gov',
    });
  });

  it('titleSize를 매핑한다 — auto→md, md→sm, lg→md', () => {
    expect(resolveResponseHeaderConfig({ style: 'plain', titleSize: 'auto' }).titleScale).toBe('md');
    expect(resolveResponseHeaderConfig({ style: 'plain', titleSize: 'md' }).titleScale).toBe('sm');
    expect(resolveResponseHeaderConfig({ style: 'plain', titleSize: 'lg' }).titleScale).toBe('md');
  });

  it('logo-title을 title 옆 로고 블록으로 매핑한다', () => {
    const result = resolveResponseHeaderConfig({
      style: 'logo-title', titleSize: 'auto',
      logo: { imageUrl: 'https://x/logo.png', altText: '기관', size: 'lg' },
      logoTitle: { logoPosition: 'right' },
    });
    expect(result.blocks).toEqual([{
      id: 'v1-logo', type: 'logo', pos: 'title-right', size: 'lg',
      imageUrl: 'https://x/logo.png', altText: '기관', frame: 'none',
    }]);
    expect(result.titleAlign).toBe('center');
  });

  it('official-band를 문구+로고 블록 행으로 매핑한다', () => {
    const result = resolveResponseHeaderConfig({
      style: 'official-band', titleSize: 'auto',
      logo: { imageUrl: 'https://x/l.png', size: 'md' },
      officialBand: {
        arrangement: 'logo-left-stat-right', logoAlign: 'bottom',
        statisticNotice: { title: '통계법 제33조', body: '본문', width: 'lg' },
      },
    });
    const notice = result.blocks.find((b) => b.type === 'notice');
    const logo = result.blocks.find((b) => b.type === 'logo');
    expect(notice).toMatchObject({
      id: 'v1-notice', pos: 'right', size: 'lg', format: 'box',
      title: '통계법 제33조', boxBody: '본문', lineBody: DEFAULT_NOTICE_LINE, alignBox: 'left',
    });
    expect(logo).toMatchObject({ id: 'v1-logo', pos: 'left' });
    expect(result.vAlignLogo).toBe('bottom');
  });
});

describe('제목 px 계산', () => {
  const base = DEFAULT_COMPOSED_RESPONSE_HEADER; // titleScale md = 33
  it('26자 이하는 스케일 원값', () => {
    expect(resolveHeaderTitlePx(base, '가'.repeat(26))).toBe(33);
  });
  it('26자 초과는 0.85배', () => {
    expect(resolveHeaderTitlePx(base, '가'.repeat(27))).toBe(28); // round(33*0.85)
  });
  it('40자 초과는 0.72배', () => {
    expect(resolveHeaderTitlePx(base, '가'.repeat(41))).toBe(24); // round(33*0.72)
  });
  it('titlePx 직접 지정 시 축소 미적용', () => {
    expect(resolveHeaderTitlePx({ ...base, titlePx: 50 }, '가'.repeat(60))).toBe(50);
  });
  it('모바일 px는 0.62배 후 17~26 클램프', () => {
    expect(resolveMobileHeaderTitlePx(33)).toBe(20);
    expect(resolveMobileHeaderTitlePx(72)).toBe(26);
    expect(resolveMobileHeaderTitlePx(14)).toBe(17);
  });
});

describe('getHeaderBandBorders', () => {
  it('4스타일의 괘선을 반환한다', () => {
    expect(getHeaderBandBorders('band')).toEqual({ top: '2px solid #3f3f3f', bottom: '2px solid #3f3f3f', side: 'none' });
    expect(getHeaderBandBorders('boxed')).toEqual({ top: '1.5px solid #333333', bottom: '1.5px solid #333333', side: '1.5px solid #333333' });
    expect(getHeaderBandBorders('rule')).toEqual({ top: 'none', bottom: '2.5px solid #222222', side: 'none' });
    expect(getHeaderBandBorders('plain')).toEqual({ top: 'none', bottom: 'none', side: 'none' });
  });
});

describe('블록 헬퍼', () => {
  it('createHeaderBlock 기본값 — 로고 right/md, 마크 left/md, 문구 left/md box', () => {
    expect(createHeaderBlock('logo')).toMatchObject({ type: 'logo', pos: 'right', size: 'md', imageUrl: '', frame: 'none' });
    expect(createHeaderBlock('mark')).toMatchObject({ type: 'mark', pos: 'left', size: 'md', imageUrl: '' });
    expect(createHeaderBlock('notice')).toMatchObject({
      type: 'notice', pos: 'left', size: 'md', format: 'box', lineBody: DEFAULT_NOTICE_LINE, fontSize: null,
    });
    expect(createHeaderBlock('logo').id).not.toBe(createHeaderBlock('logo').id);
  });

  it('noticeFormatPatch — line 전환 시 above로, box 복귀 시 left로 (목업 규칙)', () => {
    const box = createHeaderBlock('notice') as NormalizedHeaderNoticeBlock;
    expect(noticeFormatPatch(box, 'line')).toEqual({ format: 'line', pos: 'above' });
    expect(noticeFormatPatch({ ...box, format: 'line', pos: 'below' }, 'box')).toEqual({ format: 'box', pos: 'left' });
    expect(noticeFormatPatch({ ...box, format: 'line', pos: 'below' }, 'line')).toEqual({ format: 'line', pos: 'below' }); // 위치 유지
  });

  it('partitionHeaderBlocks — 한줄형만 above/below, 박스형·이미지는 행/제목 그룹', () => {
    const blocks = [
      { ...createHeaderBlock('mark'), pos: 'left' as const },
      { ...createHeaderBlock('logo'), pos: 'title-right' as const },
      { ...(createHeaderBlock('notice') as NormalizedHeaderNoticeBlock), format: 'line' as const, pos: 'above' as const },
      { ...(createHeaderBlock('notice') as NormalizedHeaderNoticeBlock), pos: 'center' as const },
    ];
    const p = partitionHeaderBlocks(blocks);
    expect(p.rowLeft).toHaveLength(1);
    expect(p.titleRight).toHaveLength(1);
    expect(p.above).toHaveLength(1);
    expect(p.rowCenter).toHaveLength(1);
    expect(p.below).toHaveLength(0);
  });
});

describe('applyResponseHeaderPreset', () => {
  it('gov 프리셋 — stacked·band 밴드·#f0f0f0, 마크 lg + 문구 + 로고 2', () => {
    const result = applyResponseHeaderPreset('gov', DEFAULT_COMPOSED_RESPONSE_HEADER);
    expect(result).toMatchObject({
      mobileStyle: 'gov', layout: 'stacked', bandStyle: 'band', bandBg: '#f0f0f0',
      titleAlign: 'center', titleScale: 'md', titlePx: null,
      vAlignLogo: 'center', vAlignNotice: 'center',
    });
    expect(result.blocks.map((b) => [b.type, b.pos, b.size])).toEqual([
      ['mark', 'left', 'lg'], ['notice', 'left', 'md'], ['logo', 'right', 'md'], ['logo', 'right', 'md'],
    ]);
  });

  it('band 프리셋 — inline·#cfe0ad·마크 1개 / title 프리셋 — plain 밴드·좌측 제목·문구 title-right', () => {
    const band = applyResponseHeaderPreset('band', DEFAULT_COMPOSED_RESPONSE_HEADER);
    expect(band).toMatchObject({ mobileStyle: 'band', layout: 'inline', bandBg: '#cfe0ad' });
    expect(band.blocks.map((b) => [b.type, b.pos])).toEqual([['mark', 'left']]);
    const title = applyResponseHeaderPreset('title', DEFAULT_COMPOSED_RESPONSE_HEADER);
    expect(title).toMatchObject({ mobileStyle: 'title', layout: 'stacked', bandStyle: 'plain', titleAlign: 'left', titleScale: 'lg' });
    expect(title.blocks.map((b) => [b.type, b.pos])).toEqual([['notice', 'title-right'], ['mark', 'title-right']]);
  });

  it('업로드 이미지·문구 내용을 같은 타입 슬롯에 순서대로 승계하고 subtitle 등은 유지한다', () => {
    const current = {
      ...DEFAULT_COMPOSED_RESPONSE_HEADER,
      subtitle: '(본 조사)', titleTextAlign: 'right' as const, titleVAlign: 'bottom' as const,
      blocks: [
        { ...createHeaderBlock('mark'), imageUrl: 'https://x/mark.png', altText: '마크' },
        { ...createHeaderBlock('logo'), imageUrl: 'https://x/a.png', altText: 'A' },
        { ...(createHeaderBlock('notice') as NormalizedHeaderNoticeBlock), title: '커스텀 제목', boxBody: '커스텀 본문' },
      ],
    };
    const result = applyResponseHeaderPreset('gov', current);
    const [mark, notice, logo1, logo2] = result.blocks;
    expect(mark).toMatchObject({ type: 'mark', imageUrl: 'https://x/mark.png', altText: '마크' });
    expect(notice).toMatchObject({ type: 'notice', title: '커스텀 제목', boxBody: '커스텀 본문' });
    expect(logo1).toMatchObject({ type: 'logo', imageUrl: 'https://x/a.png' });
    expect(logo2).toMatchObject({ type: 'logo', imageUrl: '' }); // 남는 슬롯은 빈 값
    expect(result.subtitle).toBe('(본 조사)');
    expect(result.titleTextAlign).toBe('right');
    expect(result.titleVAlign).toBe('bottom');
  });

  it('coerceBlocksForInlineLayout — center·title-left→left, title-right→right, above/below 유지', () => {
    const blocks = [
      { ...createHeaderBlock('logo'), pos: 'center' as const },
      { ...createHeaderBlock('logo'), pos: 'title-left' as const },
      { ...createHeaderBlock('mark'), pos: 'title-right' as const },
      { ...(createHeaderBlock('notice') as NormalizedHeaderNoticeBlock), format: 'line' as const, pos: 'below' as const },
    ];
    expect(coerceBlocksForInlineLayout(blocks).map((b) => b.pos)).toEqual(['left', 'left', 'right', 'below']);
  });
});
