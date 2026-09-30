-- Optional profile colors: old clients keep their existing profile fields.
ALTER TABLE profiles ADD COLUMN background_color TEXT;
ALTER TABLE profiles ADD COLUMN background_gradient TEXT;
ALTER TABLE profiles ADD COLUMN background_angle INTEGER;
ALTER TABLE profiles ADD COLUMN card_color TEXT;
