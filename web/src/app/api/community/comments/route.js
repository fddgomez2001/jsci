import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

function safeJSON(data, status = 200) {
  try { return NextResponse.json(data, { status }); }
  catch { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }); }
}

// GET - Get comments for a post (with like counts + author pics)
export async function GET(request) {
  try {
    let postId, userId;
    try {
      const { searchParams } = new URL(request.url);
      postId = searchParams.get('postId');
      userId = searchParams.get('userId');
    } catch { return safeJSON({ success: false, message: 'Invalid request' }, 400); }
    if (!postId) return safeJSON({ success: false, message: 'Post ID required' }, 400);

    const { data, error } = await supabase.from('post_comments')
      .select('*').eq('post_id', postId).order('created_at', { ascending: true });

    if (error) { console.error('[comments GET] error:', error.message); return safeJSON({ success: false, message: 'Failed to load comments' }, 500); }

    const safeData = data || [];

    // Get comment like counts + whether current user liked each
    const commentIds = safeData.map(c => c.id);
    let commentLikeCounts = {};
    let userLikedComments = new Set();

    if (commentIds.length > 0) {
      try {
        const { data: allLikes } = await supabase.from('comment_likes')
          .select('comment_id, user_id')
          .in('comment_id', commentIds);
        if (allLikes) {
          allLikes.forEach(l => {
            commentLikeCounts[l.comment_id] = (commentLikeCounts[l.comment_id] || 0) + 1;
            if (userId && l.user_id === userId) userLikedComments.add(l.comment_id);
          });
        }
      } catch { /* non-fatal */ }
    }

    // Get author profile pictures
    const authorIds = [...new Set(safeData.map(c => c.author_id).filter(Boolean))];
    let authorPicMap = {};
    if (authorIds.length > 0) {
      try {
        const { data: profiles } = await supabase.from('users')
          .select('id, profile_picture')
          .in('id', authorIds);
        if (profiles) profiles.forEach(p => { authorPicMap[p.id] = p.profile_picture; });
      } catch { /* non-fatal */ }
    }

    const enriched = safeData.map(c => ({
      ...c,
      likeCount: commentLikeCounts[c.id] || 0,
      liked: userLikedComments.has(c.id),
      author_picture: authorPicMap[c.author_id] || null,
    }));

    return safeJSON({ success: true, data: enriched });
  } catch (error) {
    console.error('[comments GET] CRITICAL:', error?.message);
    return safeJSON({ success: false, message: 'Internal server error' }, 500);
  }
}

// POST - Add comment
export async function POST(request) {
  try {
    let body;
    try { body = await request.json(); } catch { return safeJSON({ success: false, message: 'Invalid JSON body' }, 400); }

    const { postId, authorId, authorName, content } = body || {};
    if (!postId || !content) {
      return safeJSON({ success: false, message: 'Post ID and content required' }, 400);
    }

    const { data, error } = await supabase.from('post_comments').insert({
      post_id: postId, author_id: authorId, author_name: authorName, content,
    }).select().single();

    if (error) { console.error('[comments POST] error:', error.message); return safeJSON({ success: false, message: 'Failed to add comment' }, 500); }
    return safeJSON({ success: true, data, message: 'Comment added' });
  } catch (error) {
    console.error('[comments POST] CRITICAL:', error?.message);
    return safeJSON({ success: false, message: 'Internal server error' }, 500);
  }
}

// PUT - Edit comment (only the author)
export async function PUT(request) {
  try {
    let body;
    try { body = await request.json(); } catch { return safeJSON({ success: false, message: 'Invalid JSON body' }, 400); }

    const { id, userId, content } = body || {};
    if (!id || !content) return safeJSON({ success: false, message: 'Comment ID and content required' }, 400);

    let comment;
    try {
      const { data } = await supabase.from('post_comments').select('author_id').eq('id', id).single();
      comment = data;
    } catch { return safeJSON({ success: false, message: 'Comment not found' }, 404); }

    if (!comment) return safeJSON({ success: false, message: 'Comment not found' }, 404);
    if (comment.author_id !== userId) return safeJSON({ success: false, message: 'You can only edit your own comments' }, 403);

    const { data, error } = await supabase.from('post_comments').update({ content }).eq('id', id).select().single();
    if (error) { console.error('[comments PUT] error:', error.message); return safeJSON({ success: false, message: 'Failed to update comment' }, 500); }
    return safeJSON({ success: true, data });
  } catch (error) {
    console.error('[comments PUT] CRITICAL:', error?.message);
    return safeJSON({ success: false, message: 'Internal server error' }, 500);
  }
}

// DELETE - Delete comment (only the author)
export async function DELETE(request) {
  try {
    let id, userId;
    try {
      const { searchParams } = new URL(request.url);
      id = searchParams.get('id');
      userId = searchParams.get('userId');
    } catch { return safeJSON({ success: false, message: 'Invalid request' }, 400); }
    if (!id || !userId) return safeJSON({ success: false, message: 'Comment ID and User ID required' }, 400);

    let comment;
    try {
      const { data } = await supabase.from('post_comments').select('author_id').eq('id', id).single();
      comment = data;
    } catch { return safeJSON({ success: false, message: 'Comment not found' }, 404); }

    if (!comment) return safeJSON({ success: false, message: 'Comment not found' }, 404);
    if (comment.author_id !== userId) return safeJSON({ success: false, message: 'You can only delete your own comments' }, 403);

    const { error } = await supabase.from('post_comments').delete().eq('id', id);
    if (error) { console.error('[comments DELETE] error:', error.message); return safeJSON({ success: false, message: 'Failed to delete comment' }, 500); }
    return safeJSON({ success: true, message: 'Comment deleted' });
  } catch (error) {
    console.error('[comments DELETE] CRITICAL:', error?.message);
    return safeJSON({ success: false, message: 'Internal server error' }, 500);
  }
}
