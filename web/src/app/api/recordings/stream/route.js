import { NextResponse } from 'next/server';
import { streamFromGoogleDrive } from '@/lib/googleDrive';

export const dynamic = 'force-dynamic';

// Safely extract error message from anything
function safeErrorMessage(error) {
  try {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message || 'Unknown error';
    if (typeof error === 'object') return JSON.stringify(error).substring(0, 200);
    return String(error);
  } catch {
    return 'Unknown error';
  }
}

// Map error messages → HTTP status codes
function errorToStatus(message) {
  const m = (message || '').toLowerCase();
  if (m.includes('not found') || m.includes('404') || m.includes('deleted')) return 404;
  if (m.includes('access denied') || m.includes('forbidden') || m.includes('403')) return 403;
  if (m.includes('refresh token') || m.includes('access token') || m.includes('invalid_grant') || m.includes('not configured') || m.includes('token')) return 503;
  if (m.includes('timeout') || m.includes('timed out') || m.includes('aborted')) return 504;
  return 500;
}

// Stream a Google Drive file for in-browser playback
// Usage: /api/recordings/stream?fileId=GOOGLE_DRIVE_FILE_ID
export async function GET(request) {
  // Outer try-catch: absolutely nothing escapes
  try {
    // --- Validate input ---
    let fileId = null;
    try {
      const { searchParams } = new URL(request.url);
      fileId = searchParams.get('fileId');
    } catch {
      return NextResponse.json({ success: false, message: 'Invalid request URL' }, { status: 400 });
    }

    if (!fileId || typeof fileId !== 'string' || fileId.trim().length === 0) {
      return NextResponse.json({ success: false, message: 'fileId query parameter is required' }, { status: 400 });
    }

    // Basic fileId sanity check (Google Drive IDs are alphanumeric + _ + -)
    if (!/^[a-zA-Z0-9_-]{10,80}$/.test(fileId)) {
      return NextResponse.json({ success: false, message: 'Invalid fileId format' }, { status: 400 });
    }

    // --- Forward Range header for seeking ---
    let rangeHeader = null;
    try {
      rangeHeader = request.headers.get('range') || null;
    } catch {
      // ignore – proceed without range
    }

    // --- Stream from Google Drive with timeout ---
    let result;
    try {
      const streamPromise = streamFromGoogleDrive(fileId, rangeHeader);

      // 30-second timeout so a hung Google request doesn't freeze the endpoint
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Google Drive request timed out after 30 seconds')), 30000)
      );

      result = await Promise.race([streamPromise, timeoutPromise]);
    } catch (streamError) {
      const message = safeErrorMessage(streamError);
      const status = errorToStatus(message);
      console.error(`[stream] Google Drive error for fileId=${fileId}:`, message);
      return NextResponse.json({ success: false, message }, { status });
    }

    // --- Validate result shape ---
    if (!result || typeof result !== 'object') {
      console.error(`[stream] Unexpected result shape for fileId=${fileId}:`, typeof result);
      return NextResponse.json({ success: false, message: 'Unexpected response from Google Drive' }, { status: 502 });
    }

    // --- Build response headers safely ---
    const responseHeaders = new Headers();
    try {
      responseHeaders.set('Accept-Ranges', 'bytes');
      responseHeaders.set('Cache-Control', 'public, max-age=3600');
      responseHeaders.set('X-Content-Type-Options', 'nosniff');

      if (result.headers) {
        if (result.headers['Content-Type']) responseHeaders.set('Content-Type', result.headers['Content-Type']);
        if (result.headers['Content-Length']) responseHeaders.set('Content-Length', result.headers['Content-Length']);
        if (result.headers['Content-Range']) responseHeaders.set('Content-Range', result.headers['Content-Range']);
      }
    } catch (headerError) {
      console.warn('[stream] Header build warning:', safeErrorMessage(headerError));
    }

    return new Response(result.body, {
      status: result.status || 200,
      headers: responseHeaders,
    });
  } catch (outerError) {
    // This is the absolute last resort – NOTHING should reach here, but just in case:
    console.error('[stream] CRITICAL unhandled error:', safeErrorMessage(outerError));
    try {
      return NextResponse.json(
        { success: false, message: 'Internal server error' },
        { status: 500 }
      );
    } catch {
      // If even NextResponse.json fails, return bare Response
      return new Response(JSON.stringify({ success: false, message: 'Internal server error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }
}
