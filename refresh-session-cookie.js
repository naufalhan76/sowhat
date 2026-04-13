// Script untuk ambil fresh session cookie dari Solofleet dan update ke app.mabox.tech
const APP_BASE = 'https://app.mabox.tech';
const SF_BASE = 'https://www.solofleet.com';

async function getSolofleetCookie() {
  console.log('=== Login ke solofleet.com ===');
  const loginPageRes = await fetch(`${SF_BASE}/Account/Login`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const html = await loginPageRes.text();
  const initCookies = loginPageRes.headers.getSetCookie?.()?.map(c => c.split(';')[0]).join('; ') || '';
  
  const tokenMatch = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/i);
  const rvToken = tokenMatch ? tokenMatch[1] : null;

  const formFields = {
    Email: 'naufal.hanafi@coldspace.id',
    Password: 'Cold123#',
    RememberMe: 'false',
  };
  if (rvToken) formFields['__RequestVerificationToken'] = rvToken;
  const formBody = Object.entries(formFields).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');

  const loginRes = await fetch(`${SF_BASE}/Account/Login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': `${SF_BASE}/Account/Login`,
      'Cookie': initCookies,
    },
    body: formBody,
    redirect: 'manual',
  });

  if (loginRes.status !== 302) {
    throw new Error('Login failed: status ' + loginRes.status);
  }

  const newCookies = loginRes.headers.getSetCookie?.() || [];
  const sessionCookie = [...initCookies.split('; '), ...newCookies.map(c => c.split(';')[0])].filter(Boolean).join('; ');
  console.log('✅ Session cookie obtained. Keys:', newCookies.map(c => c.split('=')[0]).join(', '));
  return sessionCookie;
}

async function run() {
  // Step 1: Login ke solofleet, ambil session cookie
  const sfCookie = await getSolofleetCookie();

  // Step 2: Verifikasi cookie bekerja
  console.log('\n=== Verifikasi cookie dengan test COL89 ===');
  const testRes = await fetch(`${SF_BASE}/ReportDailyDetail/getVehicleDetailJsonWithoutZoneCalcFilterevery1minCalc`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Cookie': sfCookie,
      'Referer': `${SF_BASE}/ReportTemperatureChart`,
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'Mozilla/5.0',
    },
    body: JSON.stringify({
      ddl: 'col89',
      startdatetime: new Date(Date.now() - 3600000).toISOString(),
      enddatetime: new Date().toISOString(),
      interval: 120,
      tempprofile: '-1',
      temperatureprocessing: '',
      ArchiveType: 'liveserver',
    }),
  });
  console.log('COL89 test status:', testRes.status);
  const testText = await testRes.text();
  if (testRes.status === 200 && !testText.includes('<!doctype')) {
    const data = JSON.parse(testText);
    const arr = Array.isArray(data) ? data : (data.detail || []);
    console.log('✅ Cookie valid! Data ada:', Array.isArray(arr) ? arr.length + ' records' : 'response ok');
  } else {
    console.log('❌ Cookie masih bermasalah:', testText.slice(0, 200));
    return;
  }

  // Step 3: Login ke app.mabox.tech
  console.log('\n=== Login ke app.mabox.tech ===');
  const appLoginRes = await fetch(`${APP_BASE}/api/web-auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': APP_BASE,
      'Referer': APP_BASE + '/',
    },
    body: JSON.stringify({ username: 'test', password: '123' }),
  });
  const appCookie = appLoginRes.headers.getSetCookie?.()?.map(c => c.split(';')[0]).join('; ') || '';
  const appLoginData = await appLoginRes.json();
  if (!appLoginData.ok) {
    console.log('❌ App login failed:', appLoginData.error);
    return;
  }
  console.log('✅ App login ok. User:', appLoginData.user?.username);

  // Step 4: Update session cookie untuk account naufal
  console.log('\n=== Update session cookie account naufal ===');
  // Ambil config dulu untuk lihat linked accounts
  const configRes = await fetch(`${APP_BASE}/api/config`, {
    headers: { 'Cookie': appCookie }
  });
  const configData = await configRes.json();
  console.log('Current accounts:', configData.linkedAccounts?.map(a => a.id) || ['primary only']);

  // POST config update dengan cookie baru untuk account naufal
  const updateBody = {
    activeAccountId: 'naufal',
    sessionCookie: sfCookie,
  };
  const updateRes = await fetch(`${APP_BASE}/api/config`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': appCookie,
      'Origin': APP_BASE,
      'Referer': APP_BASE + '/',
    },
    body: JSON.stringify(updateBody),
  });
  console.log('Config update status:', updateRes.status);
  const updateData = await updateRes.json();
  if (updateData.ok) {
    console.log('✅ Session cookie untuk account naufal berhasil diupdate!');
  } else {
    console.log('❌ Update gagal:', updateData.error);
  }

  // Step 5: Test unit-history COL89 setelah update
  console.log('\n=== Final test: /api/unit-history COL89 setelah update ===');
  const finalRes = await fetch(`${APP_BASE}/api/unit-history?accountId=naufal&unitId=COL89&startDate=2026-04-13&endDate=2026-04-13`, {
    headers: { 'Cookie': appCookie }
  });
  console.log('unit-history status:', finalRes.status);
  const finalData = await finalRes.json();
  console.log('ok:', finalData.ok);
  console.log('records count:', finalData.records?.length ?? 'N/A');
  console.log('remoteError:', finalData.remoteError || '✅ none');
  if (finalData.remoteError) {
    console.log('⚠️  Masih ada error meski cookie sudah diupdate. Perlu cek lebih lanjut.');
  } else {
    console.log('🎉 BERHASIL! COL89 sekarang bisa tarik data.');
  }
}

run().catch(console.error);
