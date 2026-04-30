import React, { useState, useEffect, useRef } from 'react';
import { GripVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import { TripMonitorShippingProgressClean } from './TripMonitorShippingProgress.jsx';

export function TripMonitorStopsEditor({ 
  jobOrderId, 
  originalStops = [], 
  shippingStatus, 
  headlineJob, 
  hoveredStopKey, 
  onHoverStop 
}) {
  const [editMode, setEditMode] = useState(false);
  const [stops, setStops] = useState([]);
  const [isSaving, setIsSaving] = useState(false);
  const dragItemIdx = useRef(null);
  const dragOverItemIdx = useRef(null);

  const DRAFT_KEY = `override-draft::${jobOrderId}`;

  useEffect(() => {
    if (!editMode) {
      setStops(originalStops);
      return;
    }

    const draft = localStorage.getItem(DRAFT_KEY);
    if (draft) {
      try {
        const parsed = JSON.parse(draft);
        // Add basic validation for draft structure if needed
        if (Array.isArray(parsed)) {
            // we could prompt here as per requirement
            const resume = window.confirm("Anda punya draft yang belum disimpan. [Lanjutkan] (OK) atau [Buang] (Cancel)?");
            if (resume) {
               setStops(parsed);
            } else {
               localStorage.removeItem(DRAFT_KEY);
               setStops(originalStops);
            }
        } else {
            setStops(originalStops);
        }
      } catch (e) {
        setStops(originalStops);
      }
    } else {
      setStops(originalStops);
    }
  }, [editMode, jobOrderId, originalStops]);

  const saveDraft = (newStops) => {
    setStops(newStops);
    localStorage.setItem(DRAFT_KEY, JSON.stringify(newStops));
  };

  const handleDragStart = (e, index) => {
    dragItemIdx.current = index;
    // slightly dim the dragged item to feedback
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragEnter = (e, index) => {
    e.preventDefault(); // necessary to allow dropping
    dragOverItemIdx.current = index;
  };

  const handleDragOver = (e) => {
      e.preventDefault();
  }

  const handleDrop = (e) => {
    const dragIdx = dragItemIdx.current;
    const dropIdx = dragOverItemIdx.current;
    
    if (dragIdx === null || dropIdx === null || dragIdx === dropIdx) return;

    const newStops = [...stops];
    const draggedItem = newStops.splice(dragIdx, 1)[0];
    newStops.splice(dropIdx, 0, draggedItem);
    
    dragItemIdx.current = null;
    dragOverItemIdx.current = null;
    saveDraft(newStops);
  };

  const handleAddStop = () => {
    const newStops = [
      ...stops, 
      { 
        taskType: stops.length === 0 ? 'load' : 'unload', 
        name: '', 
        taskAddress: '', 
        latitude: '', 
        longitude: '' 
      }
    ];
    saveDraft(newStops);
  };

  const handleRemoveStop = (idx) => {
    if (stops.length <= 1) return;
    const newStops = stops.filter((_, i) => i !== idx);
    saveDraft(newStops);
  };

  const handleChange = (idx, field, value) => {
    const newStops = [...stops];
    newStops[idx] = { ...newStops[idx], [field]: value };
    saveDraft(newStops);
  };

  const handleCancel = () => {
    localStorage.removeItem(DRAFT_KEY);
    setEditMode(false);
  };

  const handleSave = async () => {
    if (stops.length === 0) return alert('At least 1 stop required');
    for (const stop of stops) {
      if (!stop.name) return alert('All stops must have a name');
      // lat long both or none validation
      const hasLat = stop.latitude !== '' && stop.latitude !== null && stop.latitude !== undefined;
      const hasLng = stop.longitude !== '' && stop.longitude !== null && stop.longitude !== undefined;
      if ((hasLat && !hasLng) || (!hasLat && hasLng)) {
        return alert('If lat/lng is filled, both are required');
      }
    }
    
    setIsSaving(true);
    try {
      const response = await fetch(`/api/tms/overrides/${jobOrderId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stops })
      });
      if (!response.ok) throw new Error('Failed to save');
      localStorage.removeItem(DRAFT_KEY);
      setEditMode(false);
    } catch (error) {
      alert('Failed to save override: ' + error.message);
    } finally {
        setIsSaving(false);
    }
  };

  if (!editMode) {
    return (
      <div className="tm-stops-read-only">
        <div className="tm-section-header-actions" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span></span>
          <button 
             type="button" 
             className="tm-btn-icon" 
             onClick={() => setEditMode(true)}
             title="Edit Stops"
             style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6 }}
          >
            <Pencil size={14} />
          </button>
        </div>
        <TripMonitorShippingProgressClean 
            shippingStatus={shippingStatus} 
            headlineJob={headlineJob} 
            hoveredStopKey={hoveredStopKey} 
            onHoverStop={onHoverStop} 
        />
      </div>
    );
  }

  return (
    <div className="tm-stops-editor" style={{ 
        background: 'var(--edit-mode-bg, rgba(6, 182, 212, 0.04))', 
        border: '1px dashed var(--edit-mode-border, rgba(6, 182, 212, 0.32))',
        padding: '12px',
        borderRadius: '8px',
        marginTop: '8px'
    }}>
      <div className="tm-stops-list" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {stops.map((stop, idx) => (
          <div 
            key={idx}
            className="tm-stop-row" 
            draggable 
            onDragStart={(e) => handleDragStart(e, idx)} 
            onDragEnter={(e) => handleDragEnter(e, idx)}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'var(--edit-field-bg, rgba(255, 255, 255, 0.04))',
                border: '1px solid var(--edit-field-border, rgba(255, 255, 255, 0.12))',
                padding: '8px',
                borderRadius: '4px'
            }}
          >
            <div className="tm-stop-drag-handle" style={{ cursor: 'grab', opacity: 0.5 }}><GripVertical size={14} /></div>
            <span className="tm-stop-idx" style={{ fontSize: '12px', fontWeight: 600, width: '20px' }}>{idx + 1}</span>
            <select 
                value={stop.taskType || 'load'} 
                onChange={(e) => handleChange(idx, 'taskType', e.target.value)}
                style={{ padding: '4px', fontSize: '12px', borderRadius: '4px' }}
            >
              <option value="load">Load</option>
              <option value="unload">Unload</option>
            </select>
            <input 
                type="text" 
                value={stop.name || ''} 
                onChange={(e) => handleChange(idx, 'name', e.target.value)} 
                placeholder="Stop name"
                style={{ flex: 1, padding: '4px', fontSize: '12px', borderRadius: '4px', border: '1px solid #ccc' }} 
            />
            <input 
                type="text" 
                value={stop.taskAddress || ''} 
                onChange={(e) => handleChange(idx, 'taskAddress', e.target.value)} 
                placeholder="Address"
                style={{ flex: 1.5, padding: '4px', fontSize: '12px', borderRadius: '4px', border: '1px solid #ccc' }} 
            />
            <input 
                type="number" 
                value={stop.latitude || ''} 
                onChange={(e) => handleChange(idx, 'latitude', e.target.value)} 
                placeholder="Lat" 
                step="0.000001"
                style={{ width: '80px', padding: '4px', fontSize: '12px', borderRadius: '4px', border: '1px solid #ccc' }} 
            />
            <input 
                type="number" 
                value={stop.longitude || ''} 
                onChange={(e) => handleChange(idx, 'longitude', e.target.value)} 
                placeholder="Lng" 
                step="0.000001"
                style={{ width: '80px', padding: '4px', fontSize: '12px', borderRadius: '4px', border: '1px solid #ccc' }} 
            />
            {/* Map Picker button placeholder for next task */}
            <button type="button" disabled style={{ padding: '4px 8px', fontSize: '12px', opacity: 0.5, cursor: 'not-allowed' }}>Map</button>
            <button 
                type="button" 
                onClick={() => handleRemoveStop(idx)} 
                disabled={stops.length <= 1}
                style={{ padding: '4px', background: 'none', border: 'none', cursor: stops.length <= 1 ? 'not-allowed' : 'pointer', color: 'red', opacity: stops.length <= 1 ? 0.3 : 1 }}
            >
                <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px' }}>
          <button 
            type="button" 
            onClick={handleAddStop}
            style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer' }}
          >
              <Plus size={14}/> Add Stop
          </button>
          <div style={{ display: 'flex', gap: '8px' }}>
              <button 
                type="button" 
                onClick={handleCancel}
                style={{ padding: '6px 12px', fontSize: '12px', cursor: 'pointer' }}
              >
                  Cancel
              </button>
              <button 
                type="button" 
                onClick={handleSave}
                disabled={isSaving}
                style={{ padding: '6px 12px', fontSize: '12px', cursor: 'pointer', background: 'var(--override-accent, #06b6d4)', color: 'white', border: 'none', borderRadius: '4px' }}
              >
                  {isSaving ? 'Saving...' : 'Save'}
              </button>
          </div>
      </div>
    </div>
  );
}
