-- A later network reply must not permanently win the glossary within the same chapter.
-- NULL means pre-existing/learned authoritative wording, which model ordering cannot overwrite.
ALTER TABLE translation_terms ADD COLUMN origin_chapter_key TEXT;
ALTER TABLE translation_terms ADD COLUMN origin_page_index INTEGER;
ALTER TABLE translation_characters ADD COLUMN origin_chapter_key TEXT;
ALTER TABLE translation_characters ADD COLUMN origin_page_index INTEGER;
