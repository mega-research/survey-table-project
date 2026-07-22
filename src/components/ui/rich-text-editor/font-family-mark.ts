import { Mark, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontFamily: {
      setFontFamily: (family: string) => ReturnType;
      unsetFontFamily: () => ReturnType;
    };
  }
}

// 이메일 클라이언트 호환 폰트 스택. sanitize.ts 의 font-family 화이트리스트가
// ASCII([a-z0-9\s,'"_-])만 허용하므로 한글 폰트명은 스택에 넣지 않는다.
// 메일은 웹폰트를 로드하지 못하므로 수신자 미설치 폰트는 스택 뒤의 폴백으로 표시된다.
export type FontGroup = '한글 고딕' | '한글 명조' | '영문';

export const FONT_FAMILIES: ReadonlyArray<{ label: string; value: string; group: FontGroup }> = [
  // 한글 고딕
  { label: 'Pretendard', group: '한글 고딕', value: "Pretendard, 'Pretendard Variable', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif" },
  { label: '페이퍼로지', group: '한글 고딕', value: "Paperlogy, Pretendard, 'Malgun Gothic', sans-serif" },
  { label: 'KoPub돋움', group: '한글 고딕', value: "'KoPub Dotum', KoPubDotum, 'Malgun Gothic', sans-serif" },
  { label: 'KoPubWorld돋움', group: '한글 고딕', value: "'KoPubWorld Dotum', KoPubWorldDotum, 'KoPub Dotum', 'Malgun Gothic', sans-serif" },
  { label: 'Noto Sans KR', group: '한글 고딕', value: "'Noto Sans KR', 'Noto Sans CJK KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif" },
  { label: '나눔고딕', group: '한글 고딕', value: "'Nanum Gothic', NanumGothic, 'Malgun Gothic', sans-serif" },
  { label: '나눔스퀘어', group: '한글 고딕', value: "'NanumSquare', 'Nanum Gothic', 'Malgun Gothic', sans-serif" },
  { label: '스포카 한 산스', group: '한글 고딕', value: "'Spoqa Han Sans Neo', 'Spoqa Han Sans', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif" },
  { label: '맑은 고딕', group: '한글 고딕', value: "'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif" },
  { label: '애플 SD 고딕', group: '한글 고딕', value: "'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif" },
  { label: '돋움', group: '한글 고딕', value: "Dotum, 'Malgun Gothic', sans-serif" },
  { label: '굴림', group: '한글 고딕', value: "Gulim, 'Malgun Gothic', sans-serif" },
  // 한글 명조
  { label: 'KoPub바탕', group: '한글 명조', value: "'KoPub Batang', KoPubBatang, Batang, serif" },
  { label: 'KoPubWorld바탕', group: '한글 명조', value: "'KoPubWorld Batang', KoPubWorldBatang, 'KoPub Batang', Batang, serif" },
  { label: '나눔명조', group: '한글 명조', value: "'Nanum Myeongjo', NanumMyeongjo, Batang, serif" },
  { label: '노토 세리프 KR', group: '한글 명조', value: "'Noto Serif KR', 'Noto Serif CJK KR', Batang, serif" },
  { label: '바탕', group: '한글 명조', value: "Batang, 'Nanum Myeongjo', serif" },
  // 영문 (이메일 세이프)
  { label: 'Arial', group: '영문', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Verdana', group: '영문', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Tahoma', group: '영문', value: 'Tahoma, Geneva, sans-serif' },
  { label: 'Trebuchet MS', group: '영문', value: "'Trebuchet MS', Helvetica, sans-serif" },
  { label: 'Segoe UI', group: '영문', value: "'Segoe UI', Tahoma, sans-serif" },
  { label: 'Georgia', group: '영문', value: 'Georgia, serif' },
  { label: 'Times New Roman', group: '영문', value: "'Times New Roman', Times, serif" },
  { label: 'Courier New', group: '영문', value: "'Courier New', Courier, monospace" },
];

export const FONT_GROUPS: ReadonlyArray<FontGroup> = ['한글 고딕', '한글 명조', '영문'];

// 첫 번째 폰트명 (소문자, 따옴표 제거) → 정식 스택
const FAMILY_BY_FIRST_NAME = new Map(
  FONT_FAMILIES.map((f) => [firstFamilyName(f.value), f.value]),
);

export function firstFamilyName(stack: string): string {
  return (stack.split(',')[0] ?? '').replace(/['"]/g, '').trim().toLowerCase();
}

/** style font-family 값을 허용 목록의 정식 스택으로 정규화. 미등록 폰트는 null. */
export function normalizeFontFamily(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return FAMILY_BY_FIRST_NAME.get(firstFamilyName(raw)) ?? null;
}

export const FontFamily = Mark.create({
  name: 'fontFamily',

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      family: {
        default: null as string | null,
        renderHTML: (attrs) => {
          if (!attrs['family']) return {};
          return { style: `font-family: ${attrs['family']}` };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span',
        getAttrs: (el) => {
          const family = normalizeFontFamily((el as HTMLElement).style.fontFamily);
          return family ? { family } : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setFontFamily:
        (family) =>
        ({ chain }) => {
          const normalized = normalizeFontFamily(family);
          if (!normalized) return false;
          return chain().setMark(this.name, { family: normalized }).run();
        },
      unsetFontFamily:
        () =>
        ({ chain }) =>
          chain().unsetMark(this.name).run(),
    };
  },
});
