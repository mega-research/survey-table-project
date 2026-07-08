import type { CSSProperties, ReactNode } from 'react';

import {
  getHeaderBandBorders, HEADER_LOGO_HEIGHTS, HEADER_MARK_HEIGHTS,
  HEADER_NOTICE_BOX_WIDTHS, normalizeResponseHeaderConfig, partitionHeaderBlocks,
  resolveHeaderTitlePx, resolveMobileHeaderTitlePx, resolveNoticeFontPx,
} from '@/lib/survey/response-header-config';
import type {
  NormalizedHeaderImageBlock, NormalizedHeaderNoticeBlock,
  NormalizedResponseHeaderBlock, NormalizedResponseHeaderConfig,
} from '@/lib/survey/response-header-config';
import { cn, isEmptyHtml } from '@/lib/utils';
import type { SurveyResponseHeaderConfig } from '@/db/schema/schema-types';

interface SurveyResponseHeaderProps {
  title: string;
  description?: string | null | undefined;
  responseHeader?: SurveyResponseHeaderConfig | null | undefined;
  sideMeta?: ReactNode;
  /** 로고/문구 밴드 노출 여부. 인트로(첫 스텝)에서만 true (기존 계약 유지) */
  showBranding?: boolean;
  /** auto = 응답 페이지(브레이크포인트 토글), desktop/mobile = 모달 미리보기 강제 */
  device?: 'auto' | 'desktop' | 'mobile';
}

const V_ALIGN_SELF = { top: 'flex-start', center: 'center', bottom: 'flex-end' } as const;

export function SurveyResponseHeader({
  title, description, responseHeader, sideMeta, showBranding = true, device = 'auto',
}: SurveyResponseHeaderProps) {
  const config = normalizeResponseHeaderConfig(responseHeader);

  // 비-첫페이지: 로고·문구 블록만 제거하고 제목 밴드는 1페이지와 동일한 스타일로 유지한다.
  if (!showBranding) {
    const titleOnly = { ...config, blocks: [] };
    const desktopCompact = <ComposedHeaderDesktop config={titleOnly} title={title} />;
    const mobileCompact = <ComposedHeaderMobile config={titleOnly} title={title} />;
    if (device === 'desktop') return desktopCompact;
    if (device === 'mobile') return mobileCompact;
    return (
      <>
        <div className="hidden md:block">{desktopCompact}</div>
        <div className="md:hidden">{mobileCompact}</div>
      </>
    );
  }

  const desktop = <ComposedHeaderDesktop config={config} title={title} />;
  const mobile = <ComposedHeaderMobile config={config} title={title} />;

  return (
    <div className="space-y-4">
      {device === 'auto' ? (
        <>
          <div className="hidden md:block">{desktop}</div>
          <div className="md:hidden">{mobile}</div>
        </>
      ) : device === 'desktop' ? desktop : mobile}
      {!isEmptyHtml(description) && (
        <p className={cn('text-base text-gray-600 md:text-sm', config.titleTextAlign === 'center' && 'mx-auto max-w-3xl text-center', config.titleTextAlign === 'right' && 'text-right')}>
          {description}
        </p>
      )}
      {sideMeta && <div className="hidden text-right text-sm text-gray-500 md:block">{sideMeta}</div>}
    </div>
  );
}

function ComposedHeaderMobile({ config, title }: { config: NormalizedResponseHeaderConfig; title: string }) {
  const parts = partitionHeaderBlocks(config.blocks);
  const images = config.blocks.filter((b): b is NormalizedHeaderImageBlock => b.type === 'mark' || b.type === 'logo');
  const boxNotices = config.blocks.filter((b): b is NormalizedHeaderNoticeBlock => b.type === 'notice' && b.format === 'box');
  const titlePx = resolveMobileHeaderTitlePx(config, title);
  const band = getHeaderBandBorders(config.bandStyle);

  const above = parts.above.length > 0 && (
    <div className="mb-2.5 flex flex-col items-center gap-1 text-center">
      {parts.above.map((b) => <NoticeLine key={b.id} block={b} mobile />)}
    </div>
  );
  const below = parts.below.length > 0 && (
    <div className="mt-2.5 flex flex-col items-center gap-1 text-center">
      {parts.below.map((b) => <NoticeLine key={b.id} block={b} mobile />)}
    </div>
  );
  const cards = boxNotices.map((b) => <MobileNoticeCard key={b.id} block={b} />);

  if (config.mobileStyle === 'band') {
    const cellImgs = images.filter((b) => b.pos === 'left');
    const topImgs = images.filter((b) => b.pos !== 'left');
    const isRight = (p: string) => p === 'right' || p === 'title-right';
    const scale = (b: NormalizedHeaderImageBlock) =>
      b.type === 'mark'
        ? Math.max(40, Math.round(HEADER_MARK_HEIGHTS[b.size] * 0.6))
        : Math.max(20, Math.round(HEADER_LOGO_HEIGHTS[b.size] * 0.7));
    return (
      <div data-testid="header-mobile-band">
        {topImgs.length > 0 && (
          <div className="mb-3.5 flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2.5">{topImgs.filter((b) => !isRight(b.pos)).map((b) => <HeaderImageBlock key={b.id} block={b} heightPx={scale(b)} mobile />)}</div>
            <div className="flex flex-wrap items-center justify-end gap-2.5">{topImgs.filter((b) => isRight(b.pos)).map((b) => <HeaderImageBlock key={b.id} block={b} heightPx={scale(b)} mobile />)}</div>
          </div>
        )}
        {above}
        <div className="flex items-stretch bg-white" style={{ border: '1.5px solid #4a4a4c' }}>
          {cellImgs.map((b) => (
            <div key={b.id} className="flex items-center justify-center" style={{ borderRight: '1.5px solid #4a4a4c', padding: '10px 12px' }}>
              <HeaderImageBlock block={b} heightPx={scale(b)} mobile />
            </div>
          ))}
          <div className="flex min-w-0 flex-1 flex-col justify-center px-3 py-3.5" style={{ backgroundColor: config.bandBg, textAlign: config.titleTextAlign }}>
            <h1 className="break-keep font-extrabold leading-[1.3] text-[#141414] [text-wrap:pretty]" style={{ fontSize: titlePx, letterSpacing: '-0.4px' }}>{title}</h1>
            {config.subtitle.trim() !== '' && (
              <div className="mt-[3px] font-bold text-[#2a2a2c]" style={{ fontSize: Math.round(titlePx * 0.76) }}>{config.subtitle}</div>
            )}
          </div>
        </div>
        {below}
        {boxNotices.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5">
            {boxNotices.map((b) => (
              <div key={b.id} className="whitespace-pre-line text-xs font-semibold leading-[1.55] text-[#3d3d3f]" style={{ textAlign: b.alignLine }}>{b.lineBody}</div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (config.mobileStyle === 'title') {
    const marks = images.filter((b) => b.type === 'mark');
    const logos = images.filter((b) => b.type === 'logo');
    return (
      <div data-testid="header-mobile-title">
        {above}
        <div className="flex items-center justify-between gap-3">
          <h1 className="min-w-0 flex-1 break-keep text-xl font-extrabold leading-[1.3] text-[#141414]" style={{ letterSpacing: '-0.5px' }}>{title}</h1>
          {marks.map((b) => <HeaderImageBlock key={b.id} block={b} heightPx={48} mobile />)}
        </div>
        {logos.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            {logos.map((b) => <HeaderImageBlock key={b.id} block={b} heightPx={26} mobile />)}
          </div>
        )}
        {cards.length > 0 && <div className="mt-3 flex flex-col gap-2">{cards}</div>}
        {below}
        <div className="mt-3.5 border-b-2 border-[#141414]" />
      </div>
    );
  }

  // gov (기본)
  const marks = images.filter((b) => b.type === 'mark');
  const logos = images.filter((b) => b.type === 'logo');
  return (
    <div data-testid="header-mobile-gov">
      {above}
      {(marks.length > 0 || logos.length > 0) && (
        <div data-testid="header-mobile-lockup" className="flex flex-wrap items-center justify-center gap-3.5 pb-3">
          {marks.map((b) => <HeaderImageBlock key={b.id} block={b} heightPx={44} mobile />)}
          {marks.length > 0 && logos.length > 0 && <div className="h-7 w-px bg-[#d7dae0]" />}
          {logos.map((b) => <HeaderImageBlock key={b.id} block={b} heightPx={50} mobile />)}
        </div>
      )}
      <div className="px-4" style={{ backgroundColor: config.bandBg, borderTop: band.top, borderBottom: band.bottom, borderLeft: band.side, borderRight: band.side, textAlign: config.titleTextAlign }}>
        <h1 className="break-keep font-extrabold leading-[1.35] text-[#141414] [text-wrap:balance]" style={{ fontSize: titlePx, letterSpacing: '-0.4px' }}>{title}</h1>
      </div>
      {cards.length > 0 && <div className="mt-3 flex flex-col gap-2">{cards}</div>}
      {below}
    </div>
  );
}

function MobileNoticeCard({ block }: { block: NormalizedHeaderNoticeBlock }) {
  return (
    <details data-testid="header-notice-card" className="group rounded-lg border border-[#d7dae0]">
      <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-2.5 px-3.5 py-3 [&::-webkit-details-marker]:hidden">
        <div className="break-keep text-sm font-bold leading-[1.4] text-gray-700">
          {block.title.trim() || '통계법 제33조(비밀의 보호)'}
        </div>
        <div className="h-2 w-2 flex-none -translate-y-0.5 rotate-45 border-b-2 border-r-2 border-gray-500 transition-transform group-open:translate-y-0 group-open:rotate-[135deg]" />
      </summary>
      <div className="whitespace-pre-line px-3 pb-3 text-xs leading-[1.5] text-[#3d3d3f]">{block.boxBody}</div>
    </details>
  );
}

function ComposedHeaderDesktop({ config, title }: { config: NormalizedResponseHeaderConfig; title: string }) {
  const parts = partitionHeaderBlocks(config.blocks);
  const above = parts.above.length > 0 && (
    <div data-testid="header-above-notices" className="mb-3 flex flex-col items-center gap-1.5 text-center">
      {parts.above.map((b) => <NoticeLine key={b.id} block={b} />)}
    </div>
  );
  const below = parts.below.length > 0 && (
    <div data-testid="header-below-notices" className="mt-3 flex flex-col items-center gap-1.5 text-center">
      {parts.below.map((b) => <NoticeLine key={b.id} block={b} />)}
    </div>
  );

  if (config.layout === 'inline') {
    return (
      <div>
        {above}
        <div data-testid="header-inline-table" className="flex items-stretch bg-white" style={{ border: '1.5px solid #4a4a4c' }}>
          {parts.rowLeft.map((b) => (
            <div key={b.id} className="flex items-center justify-center" style={{ borderRight: '1.5px solid #4a4a4c', padding: '14px 20px' }}>
              <HeaderBlockView block={b} config={config} inline />
            </div>
          ))}
          <div
            className="flex min-w-0 flex-1 flex-col px-[30px] py-[22px]"
            style={{ backgroundColor: config.bandBg, justifyContent: V_ALIGN_SELF[config.titleVAlign], textAlign: config.titleAlign }}
          >
            <TitleBandText config={config} title={title} inline />
          </div>
          {parts.rowRight.map((b) => (
            <div key={b.id} className="flex items-center justify-center" style={{ borderLeft: '1.5px solid #4a4a4c', padding: '14px 20px' }}>
              <HeaderBlockView block={b} config={config} inline />
            </div>
          ))}
        </div>
        {below}
      </div>
    );
  }

  const hasRow = parts.rowLeft.length + parts.rowCenter.length + parts.rowRight.length > 0;
  const band = getHeaderBandBorders(config.bandStyle);
  return (
    <div>
      {hasRow && (
        <div data-testid="header-block-row" className="mb-1 flex items-stretch justify-between gap-6">
          <div className="flex flex-wrap items-stretch gap-3.5">{parts.rowLeft.map((b) => <HeaderBlockView key={b.id} block={b} config={config} />)}</div>
          <div className="flex flex-wrap items-stretch justify-center gap-3.5">{parts.rowCenter.map((b) => <HeaderBlockView key={b.id} block={b} config={config} />)}</div>
          <div className="flex flex-wrap items-stretch justify-end gap-3.5">{parts.rowRight.map((b) => <HeaderBlockView key={b.id} block={b} config={config} />)}</div>
        </div>
      )}
      {above}
      <div
        data-testid="header-band"
        className="flex items-center gap-7 px-7 pt-3"
        style={{ backgroundColor: config.bandBg, borderTop: band.top, borderBottom: band.bottom, borderLeft: band.side, borderRight: band.side }}
      >
        {parts.titleLeft.map((b) => <div key={b.id} className="flex flex-none items-center"><HeaderBlockView block={b} config={config} /></div>)}
        <div className="min-w-0 flex-1" style={{ textAlign: config.titleAlign, alignSelf: V_ALIGN_SELF[config.titleVAlign] }}>
          <TitleBandText config={config} title={title} />
        </div>
        {parts.titleRight.map((b) => <div key={b.id} className="flex flex-none items-center"><HeaderBlockView block={b} config={config} /></div>)}
      </div>
      {below}
    </div>
  );
}

function TitleBandText({ config, title, inline = false }: { config: NormalizedResponseHeaderConfig; title: string; inline?: boolean }) {
  const titlePx = resolveHeaderTitlePx(config, title);
  return (
    <div className="inline-block max-w-full" style={{ textAlign: config.titleTextAlign }}>
      {/* 기존 테스트·a11y 관례: 설문 제목은 heading (v1 TitleBlock h1 계승) */}
      <h1
        className={cn('break-keep font-extrabold text-[#141414]', inline ? 'leading-[1.3] [text-wrap:pretty]' : 'leading-[1.25] [text-wrap:balance]')}
        style={{ fontSize: titlePx, letterSpacing: '-0.5px' }}
      >
        {title}
      </h1>
      {config.subtitle.trim() !== '' && (
        <div className="mt-1 font-bold text-[#2a2a2c]" style={{ fontSize: Math.round(titlePx * 0.74) }}>{config.subtitle}</div>
      )}
    </div>
  );
}

function HeaderBlockView({ block, config, inline = false, mobile = false }: {
  block: NormalizedResponseHeaderBlock; config: NormalizedResponseHeaderConfig; inline?: boolean; mobile?: boolean;
}) {
  if (block.type === 'notice') {
    return (
      <div style={{ alignSelf: inline ? undefined : V_ALIGN_SELF[config.vAlignNotice] }}>
        <NoticeBox block={block} inline={inline} />
      </div>
    );
  }
  const heightPx = (block.type === 'mark' ? HEADER_MARK_HEIGHTS : HEADER_LOGO_HEIGHTS)[block.size];
  return (
    <div style={{ alignSelf: inline ? undefined : V_ALIGN_SELF[config.vAlignLogo] }}>
      <HeaderImageBlock block={block} heightPx={heightPx} mobile={mobile} />
    </div>
  );
}

function HeaderImageBlock({ block, heightPx, mobile = false }: { block: NormalizedHeaderImageBlock; heightPx: number; mobile?: boolean }) {
  const defaultAlt = block.type === 'mark' ? '국가통계 마크' : '설문 로고';
  const lineStyle: CSSProperties = block.frame === 'line'
    ? { border: '1.5px solid #1f1f1f', padding: mobile ? '4px 6px' : '6px 10px', boxSizing: 'content-box' }
    : {};
  const img = block.imageUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={block.imageUrl} alt={block.altText || defaultAlt} className="w-auto object-contain" style={{ height: heightPx, ...lineStyle }} />
  ) : (
    <div
      className="flex items-center justify-center border border-dashed border-[#c3c9d4] font-mono text-[11px] text-[#8b93a3]"
      style={{
        height: heightPx,
        width: block.type === 'mark' ? heightPx : Math.round(heightPx * 3.2),
        background: 'repeating-linear-gradient(45deg,#f3f4f6 0 8px,#e9eaee 8px 16px)',
      }}
    >
      로고
    </div>
  );
  if (block.frame === 'wrap') {
    return <div className="flex items-center self-stretch" style={{ border: '1.5px solid #1f1f1f', padding: '10px 16px' }}>{img}</div>;
  }
  return img;
}

function NoticeBox({ block, inline = false }: { block: NormalizedHeaderNoticeBlock; inline?: boolean }) {
  return (
    <div className="bg-white text-center" style={{ width: HEADER_NOTICE_BOX_WIDTHS[block.size], border: inline ? 'none' : '1.5px solid #1f1f1f' }}>
      <div className="bg-[#111111] px-2 py-[5px] text-[13px] font-bold tracking-[-0.2px] text-white">{block.title}</div>
      <div
        className="whitespace-pre-line leading-[1.5] text-[#3d3d3f] [text-wrap:pretty]"
        style={{ fontSize: resolveNoticeFontPx(block), textAlign: block.alignBox, padding: inline ? '6px 4px 0' : '5px 10px 5px' }}
      >
        {block.boxBody}
      </div>
    </div>
  );
}

function NoticeLine({ block, mobile = false }: { block: NormalizedHeaderNoticeBlock; mobile?: boolean }) {
  return (
    <div
      className={cn('inline-block max-w-full whitespace-pre-line leading-[1.5] text-[#3d3d3f] [text-wrap:pretty]', mobile ? 'text-xs font-semibold' : 'font-semibold')}
      style={{ ...(mobile ? {} : { fontSize: resolveNoticeFontPx(block) }), textAlign: block.alignLine }}
    >
      {block.lineBody}
    </div>
  );
}

