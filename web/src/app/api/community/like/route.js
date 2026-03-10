import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const VALID_REACTIONS = ['heart', 'fire', 'praise'];

function safeJSON(data, status = 200) {
  try { return NextResponse.json(data, { status }); }
  catch { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }); }
}

// GET - Fetch who reacted to a post
export async function GET(request) {
  try {
    let postId;
    try { postId = new URL(request.url).searchParams.get('postId'); } catch { return safeJSON({ success: false, message: 'Invalid request' }, 400); }
    if (!postId) return safeJSON({ success: false, message: 'Post ID required' }, 400);

    const { data: likes, error } = await supabase.from('post_likes')
      .select('user_id, reaction_type, created_at')
      .eq('post_id', postId)
      .order('created_at', { ascending: false });
    if (error) { console.error('[community/like GET] error:', error.message); return safeJSON({ success: false, message: 'Failed to load reactions' }, 500); }

    // Get user names and pictures
    const userIds = [...new Set((likes || []).map(l => l.user_id).filter(Boolean))];
    let userMap = {};
    if (userIds.length > 0) {
      try {
        const { data: users } = await supabase.from('users')
          .select('id, firstname, lastname, profile_picture')
          .in('id', userIds);
        if (users) users.forEach(u => { userMap[u.id] = u; });
      } catch { /* non-fatal */ }
    }

    const reactions = (likes || []).map(l => ({
      userId: l.user_id,
      reactionType: l.reaction_type || 'heart',
      name: userMap[l.user_id] ? `${userMap[l.user_id].firstname} ${userMap[l.user_id].lastname}` : 'Unknown',
      picture: userMap[l.user_id]?.profile_picture || null,
      createdAt: l.created_at,
    }));

    const counts = { heart: 0, fire: 0, praise: 0 };
    reactions.forEach(r => { if (counts[r.reactionType] !== undefined) counts[r.reactionType]++; });

    return safeJSON({ success: true, data: reactions, counts, total: reactions.length });
  } catch (error) {
    console.error('[community/like GET] CRITICAL:', error?.message);
    return safeJSON({ success: false, message: 'Internal server error' }, 500);
  }
}

// POST - React/Unreact to a post (heart, fire, praise)
export async function POST(request) {
  try {
    let body;
    try { body = await request.json(); } catch { return safeJSON({ success: false, message: 'Invalid JSON body' }, 400); }

    const { postId, userId, reactionType } = body || {};
    if (!postId || !userId) {
      return safeJSON({ success: false, message: 'Post ID and User ID required' }, 400);
    }

    const type = VALID_REACTIONS.includes(reactionType) ? reactionType : 'heart';

    // Check if user already reacted to this post
    let existing = null;
    try {
      const { data } = await supabase.from('post_likes')
        .select('id, reaction_type').eq('post_id', postId).eq('user_id', userId).single();
      existing = data;
    } catch { /* no existing reaction */ }

    if (existing) {
      if (existing.reaction_type === type) {
        // Same reaction = toggle off (unreact)
        try { await supabase.from('post_likes').delete().eq('id', existing.id); } catch {}
        return safeJSON({ success: true, liked: false, reactionType: null, message: 'Reaction removed' });
      } else {
        // Different reaction = change type
        try { await supabase.from('post_likes').update({ reaction_type: type }).eq('id', existing.id); } catch {}
        return safeJSON({ success: true, liked: true, reactionType: type, message: 'Reaction changed' });
      }
    } else {
      // New reaction
      try {
        await supabase.from('post_likes').insert({ post_id: postId, user_id: userId, reaction_type: type });
      } catch (e) { console.error('[community/like POST] insert error:', e?.message); }
      return safeJSON({ success: true, liked: true, reactionType: type, message: 'Reacted' });
    }
  } catch (error) {
    console.error('[community/like POST] CRITICAL:', error?.message);
    return safeJSON({ success: false, message: 'Internal server error' }, 500);
  }
}
