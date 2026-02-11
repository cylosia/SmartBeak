
import React, { useState, useId } from 'react';
function isValidYouTubeUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;

  try {
  const parsedUrl = new URL(url);

  // Only allow https protocol
  if (parsedUrl.protocol !== 'https:') return false;

  // Allowed YouTube domains
  const allowedHostnames = [
    'youtube.com',
    'www.youtube.com',
    'youtu.be',
    'www.youtu.be'
  ];

  return allowedHostnames.includes(parsedUrl.hostname);
  } catch {
  return false;
  }
}

function getEmbedUrl(url: string): string | null {
  if (!isValidYouTubeUrl(url)) return null;

  try {
  const parsedUrl = new URL(url);
  let videoId: string | null = null;

  if (parsedUrl.hostname === 'youtu.be' || parsedUrl.hostname === 'www.youtu.be') {
    // Short URL format: youtu.be/VIDEO_ID
    videoId = parsedUrl.pathname.slice(1);
  } else {
    // Standard URL format: youtube.com/watch?v=VIDEO_ID
    videoId = parsedUrl.searchParams.get('v');
  }

  // Validate video ID is alphanumeric only (YouTube IDs are 11 characters)
  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return null;

  return `https://www.youtube.com/embed/${videoId}`;
  } catch {
  return null;
  }
}

export function VideoEditor() {
  const [url, setUrl] = useState('');
  const errorId = useId();
  const embedUrl = url ? getEmbedUrl(url) : null;
  const hasError = url && !embedUrl;

  return (
  <div>
    <h4>Video</h4>
    <input
    value={url}
    onChange={(e) => setUrl((e.target as HTMLInputElement).value)}
    placeholder='YouTube URL (https://youtube.com/watch?v=... or https://youtu.be/...)'
    aria-label='YouTube video URL'
    aria-describedby={hasError ? errorId : undefined}
    />
    {hasError && (
    <p id={errorId} style={{ color: 'red', fontSize: '12px', marginTop: '4px' }}>
      Invalid YouTube URL. Please use a valid https://youtube.com or https://youtu.be URL.
    </p>
    )}
    {embedUrl && (
    <iframe
      style={{ marginTop: 12 }}
      width='560'
      height='315'
      src={embedUrl}

      sandbox='allow-scripts allow-same-origin allow-presentation'

      allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
      title='YouTube Video'
    />
    )}
  </div>
  );
}
