'use client';

import { useState } from 'react';

/** Copies `text` to the clipboard. The only client code on /docs. */
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => {},
        );
      }}
      className="rounded-md border px-2 py-0.5 text-[0.6875rem] transition-colors hover:text-[var(--ink)]"
      style={{ borderColor: 'var(--rule-strong)', color: 'var(--dim)' }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}
