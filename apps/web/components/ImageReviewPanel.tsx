import React from 'react';
import { t } from '../lib/i18n';

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
    {isValidImageUrl && <img src={image.url} alt={t('images.reviewImage')} />}
    <button onClick={onApprove}>{t('images.approve')}</button>
    <button onClick={onReject}>{t('images.reject')}</button>
  </div>
  );
}
