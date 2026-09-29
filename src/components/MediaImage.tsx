import React, { useState, useEffect, ImgHTMLAttributes } from 'react';
import { buildDirectImageUrl, FALLBACK_IMAGE_DATA_URI } from '../utils/mediaUtils';

export interface MediaImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  src?: string | null;
  serverUrl?: string | null;
  fallbackSrc?: string;
  alt?: string;
  className?: string;
  loading?: 'lazy' | 'eager';
}

/**
 * Shared image component for channel logos, movie posters, series covers, and backdrops.
 * Safely resolves direct image URLs without proxy dependencies and gracefully falls back to SVG.
 */
export function MediaImage({
  src,
  serverUrl,
  fallbackSrc = FALLBACK_IMAGE_DATA_URI,
  alt = '',
  className = '',
  loading = 'lazy',
  ...rest
}: MediaImageProps) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [src, serverUrl]);

  const targetUrl = hasError
    ? fallbackSrc
    : buildDirectImageUrl(src, serverUrl);

  return (
    <img
      src={targetUrl}
      alt={alt}
      loading={loading}
      className={className}
      onError={() => {
        if (!hasError) {
          setHasError(true);
        }
      }}
      {...rest}
    />
  );
}
