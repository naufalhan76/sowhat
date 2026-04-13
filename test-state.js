const fs = require('fs');

function distanceMetersBetween(leftLat, leftLng, rightLat, rightLng) {
  const a = Number(leftLat);
  const b = Number(leftLng);
  const c = Number(rightLat);
  const d = Number(rightLng);
  if (![a, b, c, d].every(Number.isFinite)) {
    return null;
  }
  const toRad = function (value) { return value * Math.PI / 180; };
  const earth = 6371000;
  const dLat = toRad(c - a);
  const dLng = toRad(d - b);
  const aa = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(toRad(a)) * Math.cos(toRad(c)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return earth * 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
}

const state = require('./data/state.json');
const cols = Object.keys(state.units || {}).filter(k => k.includes('COL89') || state.units[k].label === 'B 9017 SEV' || state.units[k].label === 'B9017SEV');
for (const k of cols) {
  const unit = state.units[k];
  console.log(`Found unit ${k}`);
  const records = unit.records || [];
  console.log(`Records: ${records.length}`);
  
  const loadLat = -6.1619127;
  const loadLng = 106.7052204;
  let minDist = null, closest = null, inside=0;
  for (const r of records) {
    const dist = distanceMetersBetween(r.latitude, r.longitude, loadLat, loadLng);
    if (dist !== null) {
      if (minDist === null || dist < minDist) { minDist=dist; closest=r; }
      if (dist <= 1000) inside++;
    }
  }
  console.log(`Min distance: ${minDist}m, inside: ${inside}`);
  if (closest) console.log(`Closest: ${new Date(closest.timestamp).toISOString()}`);
}

const linked = Object.keys(state.linkedAccounts || {});
for (const acc of linked) {
  const subState = state.linkedAccounts[acc];
  const subCols = Object.keys(subState.units || {}).filter(k => k.includes('COL89') || subState.units[k].label === 'B 9017 SEV' || subState.units[k].label === 'B9017SEV');
  for (const k of subCols) {
    const unit = subState.units[k];
    console.log(`[${acc}] Found unit ${k}`);
    const records = unit.records || [];
    console.log(`Records: ${records.length}`);
    
    const loadLat = -6.1619127;
    const loadLng = 106.7052204;
    let minDist = null, closest = null, inside=0;
    for (const r of records) {
      const dist = distanceMetersBetween(r.latitude, r.longitude, loadLat, loadLng);
      if (dist !== null) {
        if (minDist === null || dist < minDist) { minDist=dist; closest=r; }
        if (dist <= 1000) inside++;
      }
    }
    console.log(`Min distance: ${minDist}m, inside: ${inside}`);
    if (closest) console.log(`Closest: ${new Date(closest.timestamp).toISOString()}`);
  }
}
