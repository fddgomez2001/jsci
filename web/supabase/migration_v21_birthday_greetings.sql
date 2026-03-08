-- ============================================
-- Migration V21: Birthday Greetings
-- Allows users to send birthday greetings
-- to celebrants in announcements section
-- ============================================

-- 1. Birthday Greetings table
CREATE TABLE IF NOT EXISTS birthday_greetings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  celebrant_user_id UUID NOT NULL,
  celebrant_name TEXT NOT NULL,
  sender_user_id UUID NOT NULL,
  sender_name TEXT NOT NULL,
  sender_picture TEXT,
  message TEXT NOT NULL,
  emoji TEXT DEFAULT '🎂',
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE birthday_greetings ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Anyone can view birthday greetings" ON birthday_greetings FOR SELECT USING (true);
CREATE POLICY "Authenticated users can send greetings" ON birthday_greetings FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can delete own greetings" ON birthday_greetings FOR DELETE USING (true);
CREATE POLICY "Celebrant can update greetings" ON birthday_greetings FOR UPDATE USING (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE birthday_greetings;

-- Indexes for performance
CREATE INDEX idx_birthday_greetings_celebrant ON birthday_greetings(celebrant_user_id);
CREATE INDEX idx_birthday_greetings_sender ON birthday_greetings(sender_user_id);
CREATE INDEX idx_birthday_greetings_created ON birthday_greetings(created_at);
