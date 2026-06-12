'use client';

import { useState, useRef, useEffect } from 'react';

// Compact popover grid — replaces the native <select>, whose iOS wheel
// takes over half the screen for a 1-character choice
export default function EmojiPicker({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (emoji: string) => void;
  options: string[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
    };
  }, [open]);

  return (
    <div className="emoji-picker" ref={ref}>
      <button type="button" className="emoji-picker-trigger" onClick={() => setOpen(o => !o)} aria-label="Pick emoji">
        {value}
      </button>
      {open && (
        <div className="emoji-popover">
          {options.map(em => (
            <button
              key={em}
              type="button"
              className={`emoji-option ${em === value ? 'active' : ''}`}
              onClick={() => { onChange(em); setOpen(false); }}
            >
              {em}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
