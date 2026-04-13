// Script debug login solofleet.com
async function run() {
  const BASE = 'https://www.solofleet.com';

  // Step 1: Ambil halaman login
  const loginPageRes = await fetch(`${BASE}/Account/Login`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const html = await loginPageRes.text();
  const initCookies = loginPageRes.headers.getSetCookie?.()?.map(c => c.split(';')[0]).join('; ') || '';
  
  // Cari form fields
  const formActionMatch = html.match(/action="([^"]+)"/i);
  const tokenMatch = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/i);
  const allInputs = [];
  let m;
  const inputRe = /<input([^>]+)>/gi;
  while ((m = inputRe.exec(html)) !== null) {
    const attrs = m[1];
    const nameM = attrs.match(/name="([^"]+)"/i);
    const typeM = attrs.match(/type="([^"]+)"/i);
    if (nameM) allInputs.push({ name: nameM[1], type: typeM ? typeM[1] : 'text' });
  }
  
  console.log('Login page status:', loginPageRes.status);
  console.log('Form action:', formActionMatch ? formActionMatch[1] : 'NOT FOUND');
  console.log('CSRF token:', tokenMatch ? tokenMatch[1].slice(0, 30) + '...' : 'NOT FOUND');
  console.log('Form inputs:', JSON.stringify(allInputs));
  console.log('Initial cookies:', initCookies.slice(0, 80));

  if (!tokenMatch) {
    console.log('\nTidak ada CSRF token - coba POST langsung...');
  }

  const rvToken = tokenMatch ? tokenMatch[1] : null;

  // Step 2: Login
  const formFields = {
    Email: 'naufal.hanafi@coldspace.id',
    Password: 'Cold123#',
    RememberMe: 'false',
  };
  if (rvToken) formFields['__RequestVerificationToken'] = rvToken;

  const formBody = Object.entries(formFields)
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
    .join('&');

  const loginUrl = formActionMatch ? (formActionMatch[1].startsWith('http') ? formActionMatch[1] : BASE + formActionMatch[1]) : `${BASE}/Account/Login`;
  console.log('\nPosting to:', loginUrl);

  const loginRes = await fetch(loginUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': `${BASE}/Account/Login`,
      'Cookie': initCookies,
      'Accept': 'text/html,application/xhtml+xml,*/*',
    },
    body: formBody,
    redirect: 'manual',
  });

  console.log('Login POST status:', loginRes.status);
  console.log('Location header:', loginRes.headers.get('location') || '(none)');
  const newCookies = loginRes.headers.getSetCookie?.() || [];
  console.log('New cookies:', newCookies.map(c => c.split(';')[0].split('=')[0]).join(', ') || '(none)');

  if (newCookies.length === 0 && loginRes.status !== 302) {
    // Baca body untuk lihat error message
    const loginBody = await loginRes.text();
    const errorMatch = loginBody.match(/class="[^"]*validation-summary[^"]*"[^>]*>([\s\S]{0,300})/i);
    console.log('Error on page:', errorMatch ? errorMatch[1].replace(/<[^>]+>/g, '').trim() : '(no error element found)');
    return;
  }

  const allCookies = [...initCookies.split('; '), ...newCookies.map(c => c.split(';')[0])].filter(Boolean).join('; ');
  console.log('\n✅ Login berhasil! Cookies:', allCookies.slice(0, 120) + '...');

  // Step 3: Test Vehicle list
  console.log('\n=== VEHICLE LIST ===');
  const vlRes = await fetch(`${BASE}/Vehicle/vehiclelivewithoutzonetripNewModelCondense`, {
    headers: {
      'Cookie': allCookies,
      'User-Agent': 'Mozilla/5.0',
      'X-Requested-With': 'XMLHttpRequest',
    }
  });
  console.log('Vehicle list status:', vlRes.status);
  const vlText = await vlRes.text();
  if (vlRes.status !== 200 || vlText.includes('<!doctype')) {
    console.log('Response (first 300):', vlText.slice(0, 300));
    return;
  }

  let vlist;
  try { vlist = JSON.parse(vlText); } catch(e) { console.log('Not JSON:', vlText.slice(0, 200)); return; }
  const arr = Array.isArray(vlist) ? vlist : (vlist.data || vlist.vehicles || []);
  console.log('Total vehicles:', arr.length);
  console.log('Fields of first vehicle:', Object.keys(arr[0] || {}).join(', '));

  // Cari COL89 / B 9017 SEV
  const col89 = arr.find(v => JSON.stringify(v).toLowerCase().includes('col89') || JSON.stringify(v).includes('9017'));
  if (col89) {
    console.log('✅ COL89 found:', JSON.stringify(col89, null, 2));
  } else {
    console.log('❌ COL89 not in vehicle list. Sample vehicles:');
    arr.slice(0, 5).forEach((v, i) => {
      const ddl = v.ddl || v.VehicleId || v.id || '?';
      const label = v.NamaKendaraan || v.label || v.VehicleNo || '?';
      console.log(`  [${i}] ddl=${ddl} label=${label}`);
    });
  }

  // Step 4: Test API COL89
  console.log('\n=== TEST API COL89 (getVehicleDetailDefrostJson) ===');
  const ddlVal = col89 ? String(col89.ddl || col89.VehicleId || 'col89').toLowerCase() : 'col89';
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);

  const body89 = {
    ddl: ddlVal,
    startdatetime: todayStart.toISOString(),
    enddatetime: todayEnd.toISOString(),
    interval: 120,
    tempprofile: '-1',
    temperatureprocessing: '',
    ArchiveType: 'liveserver',
  };
  console.log('ddl value used:', ddlVal);

  const api89Res = await fetch(`${BASE}/ReportDailyDetail/getVehicleDetailJsonWithoutZoneCalcFilterevery1minCalc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Cookie': allCookies,
      'Referer': `${BASE}/ReportTemperatureChart`,
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0',
    },
    body: JSON.stringify(body89),
  });
  const api89Text = await api89Res.text();
  console.log('COL89 API status:', api89Res.status);
  if (api89Res.status === 500 || api89Text.includes('<!doctype')) {
    const titleM = api89Text.match(/<title[^>]*>([^<]+)<\/title>/i);
    console.log('❌ ERROR! Title:', titleM ? titleM[1] : api89Text.slice(0, 200));
  } else {
    try {
      const data89 = JSON.parse(api89Text);
      console.log('✅ Records:', Array.isArray(data89) ? data89.length : JSON.stringify(data89).slice(0, 200));
    } catch(e) {
      console.log('Response:', api89Text.slice(0, 300));
    }
  }

  // Step 5: Compare COL65 (working)
  console.log('\n=== COMPARE COL65 (known good) ===');
  const body65 = { ...body89, ddl: 'col65' };
  const api65Res = await fetch(`${BASE}/ReportDailyDetail/getVehicleDetailJsonWithoutZoneCalcFilterevery1minCalc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Cookie': allCookies,
      'Referer': `${BASE}/ReportTemperatureChart`,
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0',
    },
    body: JSON.stringify(body65),
  });
  const api65Text = await api65Res.text();
  console.log('COL65 API status:', api65Res.status);
  try {
    const data65 = JSON.parse(api65Text);
    console.log('✅ COL65 Records:', Array.isArray(data65) ? data65.length : '(not array)');
  } catch(e) {
    console.log('COL65 Response:', api65Text.slice(0, 200));
  }
}

run().catch(console.error);
