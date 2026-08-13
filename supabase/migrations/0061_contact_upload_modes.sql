-- 컨택 업로드 모드(교체/병합/추가) 구분 + 제외 행 카운트
ALTER TABLE contact_uploads ADD COLUMN mode text NOT NULL DEFAULT 'replace';
ALTER TABLE contact_uploads
  ADD CONSTRAINT contact_uploads_mode_check CHECK (mode IN ('replace', 'merge', 'append'));
ALTER TABLE contact_uploads ADD COLUMN skipped_rows integer NOT NULL DEFAULT 0;
