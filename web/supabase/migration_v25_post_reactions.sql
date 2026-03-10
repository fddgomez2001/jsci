-- ============================================
-- Migration v25: Community Post Reactions
-- ============================================
-- Add reaction_type column to post_likes table
-- Supports: heart, fire, praise
-- Default: heart (backward compatible)

-- Add reaction_type column with default 'heart'
ALTER TABLE post_likes ADD COLUMN IF NOT EXISTS reaction_type TEXT DEFAULT 'heart';

-- Drop the old unique constraint and add one that includes reaction_type
-- This allows a user to have ONE reaction per post (changing type replaces it)
-- The unique constraint stays on (post_id, user_id) so each user = 1 reaction per post

-- Update existing rows to have 'heart' reaction_type
UPDATE post_likes SET reaction_type = 'heart' WHERE reaction_type IS NULL;
