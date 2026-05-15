"use client";

import { useState } from "react";

interface OgImageProps {
  src: string;
  alt: string;
  className?: string;
}

export function OgImage({ src, alt, className }: OgImageProps) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={src}
      alt={alt}
      className={className ?? "h-28 w-full object-cover"}
      onError={() => setFailed(true)}
    />
  );
}
