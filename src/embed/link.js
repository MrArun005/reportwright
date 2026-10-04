// next/link outside Next.js (the embed build aliases it here): a plain anchor.
import { createElement } from 'react';
export default function Link({ href, children, prefetch, replace, scroll, shallow, ...rest }) { // eslint-disable-line no-unused-vars
  return createElement('a', { href: typeof href === 'string' ? href : String(href?.pathname || ''), ...rest }, children);
}
