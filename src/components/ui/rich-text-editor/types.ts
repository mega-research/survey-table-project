import type { Editor } from '@tiptap/react';

export interface VariableDef {
  key: string;
  label: string;
  category: 'attrs' | 'system';
  description?: string;
}

/** 에디터 호스트와의 데이터 호환성 차이 */
export type RichTextEditorKind = 'mail' | 'survey';

/** 이미지 업로드 UX */
export type ImageUploadMode = 'simple' | 'modal';

export interface RichTextEditorProps {
  initialHtml: string;
  onChange: (html: string) => void;

  /** 'mail'은 발송용(<th>→<td> 마이그레이션, PNG 업로드), 'survey'는 일반 웹(<th> 유지, WebP 업로드). 기본 'survey'. */
  kind?: RichTextEditorKind;

  /** 변수 카탈로그. 비어있으면 변수 메뉴 미표시. */
  variableCatalog?: VariableDef[];

  /** 이미지 업로드 UX. 'simple'(메일 기본) = 파일 다이얼로그 직행, 'modal'(설문 기본) = 드래그앤드롭 + 진행률 + 미리보기 모달. */
  imageUploadMode?: ImageUploadMode;

  /** prose 컨테이너 추가 클래스 (compact 등). */
  className?: string;

  /** 에디터 내부 영역의 추가 클래스. */
  editorClassName?: string;

  /** 컨테이너 최소 높이 (기본 320px). compact는 80px 권장. */
  minHeight?: number;

  placeholder?: string;
}

export interface RichTextEditorHandle {
  /** 에디터에 삽입됐지만 아직 저장되지 않은 이미지 URL 목록 */
  getUnsavedImages: () => string[];
  /** 위 이미지들을 R2에서 일괄 삭제 */
  cleanupOrphanImages: () => Promise<void>;
  /** 외부에서 이미지 URL을 직접 삽입 image-upload-modal 같은 케이스 */
  insertImage: (url: string) => void;
  /** 내부 editor 인스턴스 탈출구 */
  getEditor: () => Editor | null;
  /** 에디터에 삽입됐지만 아직 저장되지 않은 첨부 R2 key 목록 tmp/notice-attachment/ 만 */
  getUnsavedFileAttachments: () => string[];
  /** 위 첨부들을 R2에서 일괄 삭제 */
  cleanupOrphanFileAttachments: () => Promise<void>;
}
