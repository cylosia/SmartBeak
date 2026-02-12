import React from 'react';

interface ReviewImage {
  url: string;
}

interface ImageReviewPanelProps {
  image: ReviewImage;
  onApprove: () => void;
  onReject: () => void;
}

export function ImageReviewPanel({ image, onApprove, onReject }: ImageReviewPanelProps) {
  const isValidImageUrl = image.url.startsWith('https://') || image.url.startsWith('http://');
  return (
  <div>
    {isValidImageUrl && <img src={image.url} />}
    <button onClick={onApprove}>Approve</button>
    <button onClick={onReject}>Reject</button>
  </div>
  );
}
