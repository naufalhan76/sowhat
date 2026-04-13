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

async function run() {
  try {
    const loginRes = await fetch('https://app.mabox.tech/api/web-auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'sec-fetch-site': 'same-origin',
        'host': 'app.mabox.tech'
      },
      body: JSON.stringify({username: 'test', password: '123'})
    });
    const loginData = await loginRes.json();
    let cookie = loginRes.headers.get('set-cookie').split(';')[0];
    
    // API request for history between april 8
    const histRes = await fetch('https://app.mabox.tech/api/unit-history?unitId=COL89&accountId=primary&startDate=2026-04-08&endDate=2026-04-09', {
      headers: {
        'cookie': cookie,
        'sec-fetch-site': 'same-origin',
        'host': 'app.mabox.tech'
      }
    });

    const histData = await histRes.json();
    if (!histData.records) {
        console.error('Failed to get records:', histData);
        return;
    }

    const records = histData.records;
    console.log(`B9017SEV GPS Records for Apr 8-9: ${records.length} points.`);
    fs.writeFileSync('b9017_history_apr8.json', JSON.stringify(records, null, 2));

    const loadLat = -6.1619127;
    const loadLng = 106.7052204;
    
    let minDist = null;
    let closestRecord = null;
    let pointsInside1000m = 0;

    for (const r of records) {
       const dist = distanceMetersBetween(r.latitude, r.longitude, loadLat, loadLng);
       if (dist !== null) {
           if (minDist === null || dist < minDist) {
               minDist = dist;
               closestRecord = r;
           }
           if (dist <= 1000) {
               pointsInside1000m++;
           }
       }
    }
    
    console.log(`Min distance to Sci1 Semanan was: ${minDist} meters`);
    console.log(`Points inside 1000m radius: ${pointsInside1000m}`);
    if (closestRecord) {
        console.log(`Closest point at ${new Date(closestRecord.timestamp).toISOString()}: ${closestRecord.latitude}, ${closestRecord.longitude}`);
    }

  } catch (err) {
      console.error(err);
  }
}

run();
