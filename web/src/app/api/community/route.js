import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { uploadToGoogleDrive, deleteFromGoogleDrive } from '@/lib/googleDrive';

export const dynamic = 'force-dynamic';

// GET - Fetch community posts (optimized - single query with counts)
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit')) || 50;
    const userId = searchParams.get('userId');

    const { data: posts, error } = await supabase.from('community_posts')
      .select('*, post_likes(count), post_comments(count)')
      .eq('is_active', true)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    const postIds = posts.map(p => p.id);

    // Get user's reaction types in one query
    let userReactionsMap = {};
    if (userId) {
      const { data: likes } = await supabase.from('post_likes')
        .select('post_id, reaction_type')
        .eq('user_id', userId);
      if (likes) likes.forEach(l => { userReactionsMap[l.post_id] = l.reaction_type || 'heart'; });
    }

    // Get reaction counts grouped by type for all posts
    let postReactionCounts = {};
    if (postIds.length > 0) {
      const { data: allLikes } = await supabase.from('post_likes')
        .select('post_id, reaction_type')
        .in('post_id', postIds);
      if (allLikes) {
        allLikes.forEach(l => {
          if (!postReactionCounts[l.post_id]) postReactionCounts[l.post_id] = { heart: 0, fire: 0, praise: 0, total: 0 };
          const rType = l.reaction_type || 'heart';
          if (postReactionCounts[l.post_id][rType] !== undefined) postReactionCounts[l.post_id][rType]++;
          postReactionCounts[l.post_id].total++;
        });
      }
    }

    // Get author profile pictures in one query
    const authorIds = [...new Set(posts.map(p => p.author_id).filter(Boolean))];
    let authorPicMap = {};
    if (authorIds.length > 0) {
      const { data: profiles } = await supabase.from('users')
        .select('id, profile_picture')
        .in('id', authorIds);
      if (profiles) {
        profiles.forEach(p => { authorPicMap[p.id] = p.profile_picture; });
      }
    }

    // Get images for all posts in one query
    let postImagesMap = {};
    if (postIds.length > 0) {
      const { data: images } = await supabase.from('community_post_images')
        .select('*')
        .in('post_id', postIds)
        .order('display_order', { ascending: true });
      if (images) {
        images.forEach(img => {
          if (!postImagesMap[img.post_id]) postImagesMap[img.post_id] = [];
          postImagesMap[img.post_id].push(img);
        });
      }
    }

    const enriched = posts.map(post => ({
      ...post,
      likeCount: postReactionCounts[post.id]?.total || 0,
      reactionCounts: postReactionCounts[post.id] || { heart: 0, fire: 0, praise: 0, total: 0 },
      commentCount: post.post_comments?.[0]?.count || 0,
      liked: !!userReactionsMap[post.id],
      myReaction: userReactionsMap[post.id] || null,
      author_picture: authorPicMap[post.author_id] || null,
      images: postImagesMap[post.id] || [],
      post_likes: undefined,
      post_comments: undefined,
    }));

    return NextResponse.json({ success: true, data: enriched });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST - Create post (supports multipart with images or JSON)
export async function POST(request) {
  try {
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const authorId = formData.get('authorId');
      const authorName = formData.get('authorName');
      const content = formData.get('content') || '';
      const files = formData.getAll('images');

      if (!content && (!files || files.length === 0)) {
        return NextResponse.json({ success: false, message: 'Content or images required' }, { status: 400 });
      }

      // Create the post first
      const { data: post, error: postError } = await supabase.from('community_posts').insert({
        author_id: authorId, author_name: authorName, content: content || '',
      }).select().single();
      if (postError) throw postError;

      // Upload images to Google Drive and save references
      const uploadedImages = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file || !file.size) continue;
        try {
          const arrayBuffer = await file.arrayBuffer();
          const fileName = `community_${post.id}_${Date.now()}_${i}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
          const mimeType = file.type || 'image/jpeg';
          const driveResult = await uploadToGoogleDrive(arrayBuffer, fileName, mimeType);

          const { data: imgData, error: imgError } = await supabase.from('community_post_images').insert({
            post_id: post.id,
            google_drive_file_id: driveResult.id,
            file_name: file.name,
            mime_type: mimeType,
            file_size_bytes: file.size,
            display_order: i,
          }).select().single();

          if (!imgError && imgData) uploadedImages.push(imgData);
        } catch (uploadErr) {
          console.error('Image upload error:', uploadErr.message);
        }
      }

      return NextResponse.json({ success: true, data: { ...post, images: uploadedImages }, message: 'Post created' });
    }

    // JSON body (text-only post)
    const { authorId, authorName, content, imageUrl } = await request.json();
    if (!content) {
      return NextResponse.json({ success: false, message: 'Content required' }, { status: 400 });
    }

    const { data, error } = await supabase.from('community_posts').insert({
      author_id: authorId, author_name: authorName, content, image_url: imageUrl || null,
    }).select().single();

    if (error) throw error;
    return NextResponse.json({ success: true, data: { ...data, images: [] }, message: 'Post created' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT - Update post / Pin post / Add or remove images
export async function PUT(request) {
  try {
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const id = formData.get('id');
      const content = formData.get('content');
      const removeImageIds = JSON.parse(formData.get('removeImageIds') || '[]');
      const files = formData.getAll('newImages');

      if (!id) return NextResponse.json({ success: false, message: 'ID required' }, { status: 400 });

      // Update post content
      if (content !== null && content !== undefined) {
        const { error } = await supabase.from('community_posts').update({ content }).eq('id', id);
        if (error) throw error;
      }

      // Remove images
      for (const imgId of removeImageIds) {
        const { data: img } = await supabase.from('community_post_images')
          .select('google_drive_file_id').eq('id', imgId).single();
        if (img?.google_drive_file_id) {
          try { await deleteFromGoogleDrive(img.google_drive_file_id); } catch (e) { console.warn('Drive delete warning:', e.message); }
        }
        await supabase.from('community_post_images').delete().eq('id', imgId);
      }

      // Upload new images
      const { data: existingImages } = await supabase.from('community_post_images')
        .select('display_order').eq('post_id', id).order('display_order', { ascending: false }).limit(1);
      let nextOrder = (existingImages?.[0]?.display_order ?? -1) + 1;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file || !file.size) continue;
        try {
          const arrayBuffer = await file.arrayBuffer();
          const fileName = `community_${id}_${Date.now()}_${i}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
          const mimeType = file.type || 'image/jpeg';
          const driveResult = await uploadToGoogleDrive(arrayBuffer, fileName, mimeType);
          await supabase.from('community_post_images').insert({
            post_id: id, google_drive_file_id: driveResult.id,
            file_name: file.name, mime_type: mimeType,
            file_size_bytes: file.size, display_order: nextOrder++,
          });
        } catch (e) { console.error('Image upload error:', e.message); }
      }

      const { data: updatedPost } = await supabase.from('community_posts').select('*').eq('id', id).single();
      return NextResponse.json({ success: true, data: updatedPost });
    }

    // JSON body (text update, pin, etc.)
    const body = await request.json();
    const { id, ...updates } = body;
    if (!id) return NextResponse.json({ success: false, message: 'ID required' }, { status: 400 });

    const updateData = {};
    if (updates.content !== undefined) updateData.content = updates.content;
    if (updates.isPinned !== undefined) updateData.is_pinned = updates.isPinned;
    if (updates.isActive !== undefined) updateData.is_active = updates.isActive;

    const { data, error } = await supabase.from('community_posts').update(updateData).eq('id', id).select().single();
    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// DELETE - only the post author can delete their own post
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const userId = searchParams.get('userId');
    if (!id || !userId) return NextResponse.json({ success: false, message: 'Post ID and User ID required' }, { status: 400 });

    // Verify ownership
    const { data: post } = await supabase.from('community_posts').select('author_id').eq('id', id).single();
    if (!post) return NextResponse.json({ success: false, message: 'Post not found' }, { status: 404 });
    if (post.author_id !== userId) return NextResponse.json({ success: false, message: 'You can only delete your own posts' }, { status: 403 });

    // Delete images from Google Drive (best-effort)
    const { data: images } = await supabase.from('community_post_images')
      .select('google_drive_file_id').eq('post_id', id);
    if (images) {
      for (const img of images) {
        try { await deleteFromGoogleDrive(img.google_drive_file_id); } catch (e) { console.warn('Drive cleanup:', e.message); }
      }
    }

    // Soft-delete post (cascade will handle image rows if hard-deleted)
    const { error } = await supabase.from('community_posts').update({ is_active: false }).eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true, message: 'Post deleted' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
