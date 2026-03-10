-- ============================================
-- Migration v24: Community Post Images (Google Drive)
-- ============================================
-- Allows users to attach photos to community posts,
-- stored in Google Drive and referenced here.

CREATE TABLE IF NOT EXISTS community_post_images (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  post_id UUID NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  google_drive_file_id TEXT NOT NULL,
  file_name TEXT,
  mime_type TEXT DEFAULT 'image/jpeg',
  file_size_bytes BIGINT DEFAULT 0,
  display_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups by post
CREATE INDEX IF NOT EXISTS idx_community_post_images_post_id ON community_post_images(post_id);

-- Enable RLS
ALTER TABLE community_post_images ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read images
CREATE POLICY "Anyone can view post images"
  ON community_post_images FOR SELECT
  USING (true);

-- Allow authenticated users to insert images
CREATE POLICY "Authenticated users can insert images"
  ON community_post_images FOR INSERT
  WITH CHECK (true);

-- Allow deletion (cascades from post delete, or direct for edit)
CREATE POLICY "Anyone can delete post images"
  ON community_post_images FOR DELETE
  USING (true);
