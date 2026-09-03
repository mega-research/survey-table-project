-- 공지 패널 배경색 — NULL=기본 파랑 패널(현행 유지), 'none'=무색(패널 제거), '#rrggbb'=커스텀
-- nullable 추가라 단일 단계 배포 가능 (구버전 앱 INSERT 영향 없음)
ALTER TABLE questions ADD COLUMN IF NOT EXISTS notice_bg_color text;
