import React from 'react';
export function ImageReviewPanel({ image, onApprove, onReject }: any) {
  return (
  <div>
    <img src={image.url} />
    <button onClick={onApprove}>Approve</button>
    <button onClick={onReject}>Reject</button>
  </div>
  );
}
