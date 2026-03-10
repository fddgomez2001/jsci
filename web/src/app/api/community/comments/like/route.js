import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

function safeJSON(data, status = 200) {
  try { return NextResponse.json(data, { status }); }
  catch { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }); }
}

// POST - Like/Unlike a comment
export async function POST(request) {
  try {
    let body;
    try { body = await request.json(); } catch { return safeJSON({ success: false, message: 'Invalid JSON body' }, 400); }

    const { commentId, userId } = body || {};
    if (!commentId || !userId) {
      return safeJSON({ success: false, message: 'Comment ID and User ID required' }, 400);
    }

    let existing = null;
    try {
      const { data } = await supabase.from('comment_likes')
        .select('id').eq('comment_id', commentId).eq('user_id', userId).single();
      existing = data;
    } catch { /* no existing like */ }

    if (existing) {
      try { await supabase.from('comment_likes').delete().eq('id', existing.id); } catch {}
      return safeJSON({ success: true, liked: false });
    } else {
      try { await supabase.from('comment_likes').insert({ comment_id: commentId, user_id: userId }); } catch {}
      return safeJSON({ success: true, liked: true });
    }
  } catch (error) {
    console.error('[comment/like POST] CRITICAL:', error?.message);
    return safeJSON({ success: false, message: 'Internal server error' }, 500);
  }
}
