import { useState, useEffect } from 'react';
import { Shield } from 'lucide-react';

/**
 * Shared fixed-size team badge renderer.
 * Displays the custom logo constrained cleanly to `size x size` with `object-fit: contain`,
 * falling back seamlessly to the generic Shield icon if no URL is set or loading fails.
 */
export default function TeamBadge({
  url,
  size = 16,
  color = 'var(--color-primary)',
  className = '',
  style = {}
}) {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [url]);

  if (!url || imgError) {
    return (
      <Shield
        size={size}
        color={color}
        className={className}
        style={{ flexShrink: 0, ...style }}
      />
    );
  }

  return (
    <img
      src={url}
      alt="Team badge"
      width={size}
      height={size}
      className={className}
      style={{
        width: size,
        height: size,
        objectFit: 'contain',
        flexShrink: 0,
        borderRadius: 3,
        display: 'inline-block',
        ...style
      }}
      onError={() => setImgError(true)}
    />
  );
}

