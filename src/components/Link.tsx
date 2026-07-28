import type { MouseEvent, ReactNode } from 'react';

import { goTo } from '../lib/router';

/**
 * A real anchor that navigates without reloading the document.
 *
 * It stays an `<a href>` rather than becoming a button: ⌘-click, middle-click
 * and "copy link address" are how a list of calls actually gets used, and a
 * crawler follows nothing else. The handler takes over only the plain left
 * click — the one that would otherwise throw the whole app away and rebuild it
 * to show a page it already has.
 */
export function Link({
  to,
  className,
  children,
}: {
  to: string;
  className?: string;
  children: ReactNode;
}) {
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
    if (event.defaultPrevented || event.button !== 0 || modified) return;
    event.preventDefault();
    goTo(to);
  }

  return (
    <a className={className} href={to} onClick={onClick}>
      {children}
    </a>
  );
}
