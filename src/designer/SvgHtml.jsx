// pageToSvg markup, put in the DOM through the CSSOM: a strict Content-Security-Policy (style-src without
// 'unsafe-inline') refuses the style attributes of markup, so they are set aside and applied after insertion.
import { useLayoutEffect, useRef } from 'react';
import { applyStyleAttributes, deferStyleAttributes } from '../embed/styles.js';

/** @param {{ html: string, as?: 'span'|'div', style?: object, className?: string }} props */
export default function SvgHtml({ html, as: Tag = 'span', ...rest }) {
  const ref = useRef(/** @type {HTMLElement|null} */ (null));
  useLayoutEffect(() => {
    if (!ref.current) return;
    ref.current.innerHTML = deferStyleAttributes(html);
    applyStyleAttributes(ref.current);
  }, [html]);
  return <Tag ref={ref} {...rest} />;
}
