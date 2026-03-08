import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// GET - Fetch birthday greetings for a celebrant or all today's
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const celebrantId = searchParams.get('celebrant_id');
    const celebrantName = searchParams.get('celebrant_name');
    const today = searchParams.get('today') === 'true';

    let query = supabase
      .from('birthday_greetings')
      .select('*')
      .order('created_at', { ascending: false });

    if (celebrantId) {
      query = query.eq('celebrant_user_id', celebrantId);
    }
    if (celebrantName) {
      query = query.eq('celebrant_name', celebrantName);
    }
    if (today) {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      query = query.gte('created_at', startOfDay.toISOString());
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true, data: data || [] });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// POST - Send a birthday greeting
export async function POST(request) {
  try {
    const body = await request.json();
    const { celebrant_user_id, celebrant_name, sender_user_id, sender_name, sender_picture, message, emoji } = body;

    if (!celebrant_name || !sender_user_id || !sender_name || !message) {
      return NextResponse.json({ success: false, message: 'Missing required fields' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('birthday_greetings')
      .insert({
        celebrant_user_id: celebrant_user_id || null,
        celebrant_name,
        sender_user_id,
        sender_name,
        sender_picture: sender_picture || null,
        message,
        emoji: emoji || '🎂',
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data, message: 'Birthday greeting sent!' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// PUT - Mark greetings as read
export async function PUT(request) {
  try {
    const body = await request.json();
    const { ids, celebrant_user_id } = body;

    let query = supabase.from('birthday_greetings').update({ is_read: true });

    if (ids && ids.length > 0) {
      query = query.in('id', ids);
    } else if (celebrant_user_id) {
      query = query.eq('celebrant_user_id', celebrant_user_id);
    } else {
      return NextResponse.json({ success: false, message: 'ids or celebrant_user_id required' }, { status: 400 });
    }

    const { error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Greetings marked as read' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// DELETE - Remove a greeting
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ success: false, message: 'ID required' }, { status: 400 });

    const { error } = await supabase.from('birthday_greetings').delete().eq('id', id);
    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Greeting deleted' });
  } catch (error) {
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
