import type { AccessibilityProps } from '@nandomo/core';
// Image primitive · <Image> → gtk4::Picture.
// `src` becomes the file loaded by gtk4::Picture via set_filename.
import type { SpecNode } from './types.js';

export interface ImageProps extends AccessibilityProps {
  objectName?: string;
  src: string;
  alt?: string;
  class?: string;
  style?: Record<string, string>;
  /** Pass-through to Picture::set_content_fit. */
  contentFit?: 'contain' | 'cover' | 'fill' | 'scale-down';
}

export function Image(props: ImageProps): SpecNode {
  return {
    __spec: true,
    kind: 'Image',
    props: { ...props },
  };
}