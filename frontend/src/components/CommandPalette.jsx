import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';

/**
 * Lightweight command palette (Ctrl+K / Cmd+K).
 *
 * Props:
 *  - open: boolean
 *  - onClose: () => void
 *  - commands: Array<{ id, label, icon?, section?, shortcut?, onSelect }>
 *  - placeholder?: string
 */
export function CommandPalette({ open, onClose, commands = [], placeholder = 'Cari panel atau aksi...' }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      // Small delay so the dialog is painted before focus
      const timer = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Filter commands
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((cmd) =>
      [cmd.label, cmd.section, cmd.id].some((v) => String(v || '').toLowerCase().includes(q))
    );
  }, [commands, query]);

  // Clamp active index
  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const active = listRef.current.children[activeIndex];
    if (active) active.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const select = useCallback((cmd) => {
    if (!cmd) return;
    onClose();
    // Defer so the palette closes before the action runs
    setTimeout(() => cmd.onSelect?.(), 10);
  }, [onClose]);

  const handleKeyDown = useCallback((event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % Math.max(1, filtered.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + filtered.length) % Math.max(1, filtered.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      select(filtered[activeIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  }, [filtered, activeIndex, select, onClose]);

  // Close on backdrop click
  const handleBackdropClick = useCallback((event) => {
    if (event.target === event.currentTarget) onClose();
  }, [onClose]);

  if (!open) return null;

  // Group by section
  const sections = [];
  const sectionMap = new Map();
  for (const cmd of filtered) {
    const key = cmd.section || '';
    if (!sectionMap.has(key)) {
      const group = { label: key, items: [] };
      sectionMap.set(key, group);
      sections.push(group);
    }
    sectionMap.get(key).items.push(cmd);
  }

  let flatIndex = 0;

  return (
    <div className="cmdpal-backdrop" onClick={handleBackdropClick} role="presentation">
      <div className="cmdpal" role="dialog" aria-label="Command palette" aria-modal="true">
        <div className="cmdpal-input-row">
          <Search size={15} strokeWidth={1.75} className="cmdpal-input-icon" aria-hidden />
          <input
            ref={inputRef}
            type="text"
            className="cmdpal-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            aria-label="Search commands"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="cmdpal-kbd">esc</kbd>
        </div>

        <div className="cmdpal-list" ref={listRef} role="listbox">
          {filtered.length === 0 ? (
            <div className="cmdpal-empty">Tidak ada hasil untuk "{query}"</div>
          ) : (
            sections.map((section) => (
              <React.Fragment key={section.label || '__default'}>
                {section.label ? <div className="cmdpal-section-label">{section.label}</div> : null}
                {section.items.map((cmd) => {
                  const idx = flatIndex++;
                  const Icon = cmd.icon;
                  return (
                    <button
                      key={cmd.id}
                      type="button"
                      className={`cmdpal-item ${idx === activeIndex ? 'cmdpal-item-active' : ''}`}
                      role="option"
                      aria-selected={idx === activeIndex}
                      onClick={() => select(cmd)}
                      onMouseEnter={() => setActiveIndex(idx)}
                    >
                      {Icon ? <span className="cmdpal-item-icon"><Icon size={15} strokeWidth={1.75} /></span> : null}
                      <span className="cmdpal-item-label">{cmd.label}</span>
                      {cmd.shortcut ? <kbd className="cmdpal-item-shortcut">{cmd.shortcut}</kbd> : null}
                    </button>
                  );
                })}
              </React.Fragment>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
