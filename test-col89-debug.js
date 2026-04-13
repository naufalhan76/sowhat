const BASE = 'https://app.mabox.tech';

async function run() {
  // 1. Login
  console.log('=== [1] LOGIN ===');
  const loginRes = await fetch(`${BASE}/api/web-auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'origin': BASE,
      'referer': BASE + '/',
    },
    body: JSON.stringify({ username: 'test', password: '123' })
  });
  const cookie = loginRes.headers.get('set-cookie')?.split(';')[0] || '';
  const loginData = await loginRes.json();
  console.log('Login status:', loginRes.status, loginData.ok ? 'OK' : 'FAIL');
  console.log('User:', loginData.user?.username || '(none)');
  if (!cookie) { console.error('No cookie received!'); return; }
  console.log('Cookie:', cookie.slice(0, 40) + '...');

  const headers = { cookie, 'sec-fetch-site': 'same-origin' };

  // 2. Cek status server
  console.log('\n=== [2] SERVER STATUS ===');
  const statusRes = await fetch(`${BASE}/api/status`, { headers });
  const status = await statusRes.json();
  console.log('isPolling:', status.runtime?.isPolling);
  console.log('lastRunMessage:', status.runtime?.lastRunMessage);
  console.log('Accounts:', JSON.stringify(status.accounts?.map(a => ({ id: a.id, unitCount: a.units?.length }))));
  console.log('All Account IDs:', status.accounts?.map(a => a.id));

  // 3. Test unit-history untuk COL89 dengan accountId naufal
  console.log('\n=== [3] unit-history COL89 accountId=naufal ===');
  const histRes = await fetch(`${BASE}/api/unit-history?accountId=naufal&unitId=COL89&startDate=2026-04-13&endDate=2026-04-13`, { headers });
  console.log('HTTP status:', histRes.status);
  const histText = await histRes.text();
  try {
    const hist = JSON.parse(histText);
    console.log('ok:', hist.ok);
    console.log('records count:', hist.records?.length ?? 'N/A');
    console.log('remoteError:', hist.remoteError || '(none)');
    console.log('unit:', JSON.stringify(hist.unit));
    if (!hist.ok) console.log('error field:', hist.error);
  } catch(e) {
    console.log('Response was NOT JSON:', histText.slice(0, 300));
  }

  // 4. Test unit-history untuk COL89 dengan accountId=primary
  console.log('\n=== [4] unit-history COL89 accountId=primary ===');
  const hist2Res = await fetch(`${BASE}/api/unit-history?accountId=primary&unitId=COL89&startDate=2026-04-13&endDate=2026-04-13`, { headers });
  console.log('HTTP status:', hist2Res.status);
  const hist2Text = await hist2Res.text();
  try {
    const hist2 = JSON.parse(hist2Text);
    console.log('ok:', hist2.ok);
    console.log('records count:', hist2.records?.length ?? 'N/A');
    console.log('remoteError:', hist2.remoteError || '(none)');
    console.log('unit:', JSON.stringify(hist2.unit));
    if (!hist2.ok) console.log('error field:', hist2.error);
  } catch(e) {
    console.log('Response was NOT JSON:', hist2Text.slice(0, 300));
  }

  // 5. Cek unit-detail COL89 untuk melihat apakah unit dikenali
  console.log('\n=== [5] unit-detail COL89 (naufal) ===');
  const detailRes = await fetch(`${BASE}/api/unit-detail?accountId=naufal&unitId=COL89`, { headers });
  console.log('HTTP status:', detailRes.status);
  const detailText = await detailRes.text();
  try {
    const detail = JSON.parse(detailText);
    console.log('ok:', detail.ok);
    console.log('unit:', JSON.stringify(detail.unit));
    console.log('error:', detail.error || '(none)');
  } catch(e) {
    console.log('Response was NOT JSON:', detailText.slice(0, 300));
  }
}

run().catch(console.error);
