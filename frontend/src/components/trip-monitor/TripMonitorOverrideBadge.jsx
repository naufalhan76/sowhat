import React, { useState, useRef, useEffect } from 'react';
import { ShieldAlert, X, Undo2 } from 'lucide-react';
import { Pill, Action, Surface } from '../index';

export function TripMonitorOverrideBadge({ overrides = {}, joId, onReset }) {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef(null);

  // Close popover when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const activeOverrides = Object.entries(overrides).filter(([_, value]) => value !== null && value !== undefined);

  if (activeOverrides.length === 0) {
    return null;
  }

  const handleReset = async (field) => {
    if (onReset) {
       await onReset(joId, field);
    }
  };

  const getOverrideLabel = (field, value) => {
    switch (field) {
      case 'stops':
        return `Stops (${value.length} modified)`;
      case 'targetTempRange':
        return `Temp Range (${value[0]} to ${value[1]})`;
      case 'isForceClosed':
        return `Force Closed (${value ? 'Yes' : 'No'})`;
      default:
        return `${field}: ${JSON.stringify(value)}`;
    }
  };

  return (
    <div style={{ position: 'relative' }} ref={popoverRef}>
      <Pill
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          cursor: 'pointer',
          background: 'var(--override-surface, rgba(6, 182, 212, 0.06))',
          border: '1px solid var(--override-border, rgba(6, 182, 212, 0.24))',
          color: 'var(--override-text, #22D3EE)',
          fontSize: '11px',
          fontWeight: 600,
          fontFamily: 'Inter',
          display: 'flex',
          alignItems: 'center',
          gap: '4px'
        }}
      >
        <ShieldAlert size={12} />
        Override Active
      </Pill>

      {isOpen && (
        <Surface
          variant="elevated"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: 0,
            width: '280px',
            zIndex: 100,
            padding: '12px',
            boxShadow: 'var(--shadow-xl)',
            border: '1px solid var(--border)',
            background: 'var(--surface)',
            borderRadius: '8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}
        >
           <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
             <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <ShieldAlert size={14} style={{ color: 'var(--override-text, #22D3EE)' }}/> Active Overrides
             </h4>
             <Action variant="ghost" size="icon" onClick={() => setIsOpen(false)} style={{ width: '24px', height: '24px' }}>
               <X size={14} />
             </Action>
           </div>
           
           <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
             {activeOverrides.map(([field, value]) => (
                <div key={field} style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between',
                    background: 'var(--bg)',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid var(--border-subtle)'
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-main)' }}>
                        {getOverrideLabel(field, value)}
                      </span>
                      {/* Placeholder for metadata, we might need to pass it from parent if available */}
                      <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                        Modified manually
                      </span>
                  </div>
                  <Action 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => handleReset(field)}
                    title={`Reset ${field}`}
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <Undo2 size={14} />
                  </Action>
                </div>
             ))}
           </div>
        </Surface>
      )}
    </div>
  );
}
