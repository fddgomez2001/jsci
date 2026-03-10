import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const VALID_REACTIONS = ['heart', 'fire', 'praise'];

// GET - Fetch who reacted to a post
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const postId = searchParams.get('postId');
    if (!postId) return NextResponse.json({ success: false, message: 'Post ID required' }, { status: 400 });

    const { data: likes, error } = await supabase.from('post_likes')
      .select('user_id, reaction_type, created_at')
      .eq('post_id', postId)
      .order('created_at', { ascending: false });
    if (error) throw error;

    // Get user names and pictures
    const userIds = [...new Set((likes || []).map(l => l.user_id).filter(Boolean))];
    let userMap = {};
    if (userIds.length > 0) {
      const { data: users } = await supabase.from('users')
        .select('id, firstname, lastname, profile_picture')
        .in('id', userIds);
      if (users) users.forEach(u => { userMap[u.id] = u; });
    }

    const reactions = (likes || []).map(l => ({
      userId: l.user_id,
      reactionType: l.reaction_type || 'heart',
      name: userMap[l.user_id] ? `${userMap[l.user_id].firstname} ${userMap[l.user_id].lastname}` : 'Unknown',
      picture: userMap[l.user_id]?.profile_picture || null,
      createdAt: l.created_at,
    }));

    // Group counts by type
    const counts = { heart: 0, fire: 0, praise: 0 };
    reactions.forEach(r => { if (counts[r.reactionType] !== undefined) counts[r.reactionType]++; });

    return NextResponse.json({ success: true, data: reactions, counts, total: reactions.length });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST - React/Unreact to a post (heart, fire, praise)
export async function POST(request) {
  try {
    const { postId, userId, reactionType } = await request.json();
    if (!postId || !userId) {
      return NextResponse.json({ success: false, message: 'Post ID and User ID required' }, { status: 400 });
    }

    const type = VALID_REACTIONS.includes(reactionType) ? reactionType : 'heart';

    // Check if user already reacted to this post
    const { data: existing } = await supabase.from('post_likes')
      .select('id, reaction_type').eq('post_id', postId).eq('user_id', userId).single();

    if (existing) {
      if (existing.reaction_type === type) {
        // Same reaction = toggle off (unreact)
        await supabase.from('post_likes').delete().eq('id', existing.id);
        return NextResponse.json({ success: true, liked: false, reactionType: null, message: 'Reaction removed' });
      } else {
        // Different reaction = change type
        await supabase.from('post_likes').update({ reaction_type: type }).eq('id', existing.id);
        return NextResponse.json({ success: true, liked: true, reactionType: type, message: 'Reaction changed' });
      }
    } else {
      // New reaction
      await supabase.from('post_likes').insert({ post_id: postId, user_id: userId, reaction_type: type });
      return NextResponse.json({ success: true, liked: true, reactionType: type, message: 'Reacted' });
    }
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
