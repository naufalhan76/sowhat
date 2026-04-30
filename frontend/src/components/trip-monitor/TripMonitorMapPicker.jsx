import React, { useState } from 'react';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

function MapClickHandler({ onLocationSelect }) {
  useMapEvents({
    click(e) {
      onLocationSelect(e.latlng.lat, e.latlng.lng);
    }
  });
  return null;
}

export function TripMonitorMapPicker({ isOpen, initialLat, initialLng, onConfirm, onCancel }) {
  const defaultLat = -6.2;
  const defaultLng = 106.8;

  // Parse initial values or fallback to default
  const parsedLat = initialLat !== null && initialLat !== undefined && initialLat !== '' ? parseFloat(initialLat) : defaultLat;
  const parsedLng = initialLng !== null && initialLng !== undefined && initialLng !== '' ? parseFloat(initialLng) : defaultLng;

  const validLat = isNaN(parsedLat) ? defaultLat : parsedLat;
  const validLng = isNaN(parsedLng) ? defaultLng : parsedLng;

  const [selectedLat, setSelectedLat] = useState(validLat);
  const [selectedLng, setSelectedLng] = useState(validLng);

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 9999
    }}>
      <div style={{
        background: 'var(--surface, #fff)',
        padding: '16px',
        borderRadius: '8px',
        width: '400px',
        maxWidth: '90%',
        boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
      }}>
        <h3 style={{ marginTop: 0, marginBottom: '12px', fontSize: '16px' }}>Pick Location</h3>
        
        {/* Important: Leaflet needs a defined height to render properly */}
        <div style={{ height: '200px', width: '100%', marginBottom: '12px', borderRadius: '4px', overflow: 'hidden' }}>
          <MapContainer center={[validLat, validLng]} zoom={13} style={{ height: '100%', width: '100%' }}>
            <TileLayer 
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" 
            />
            <Marker position={[selectedLat, selectedLng]} />
            <MapClickHandler onLocationSelect={(lat, lng) => { setSelectedLat(lat); setSelectedLng(lng); }} />
          </MapContainer>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px', fontSize: '12px' }}>
          <div>Lat: {selectedLat.toFixed(6)}</div>
          <div>Lng: {selectedLng.toFixed(6)}</div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button 
            type="button" 
            onClick={onCancel}
            style={{ padding: '6px 12px', fontSize: '12px', cursor: 'pointer', background: 'transparent', border: '1px solid var(--border, #ccc)', borderRadius: '4px' }}
          >
            Cancel
          </button>
          <button 
            type="button" 
            onClick={() => onConfirm(selectedLat, selectedLng)}
            style={{ padding: '6px 12px', fontSize: '12px', cursor: 'pointer', background: 'var(--override-accent, #06b6d4)', color: 'white', border: 'none', borderRadius: '4px' }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}
