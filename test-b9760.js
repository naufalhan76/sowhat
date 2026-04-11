async function test() {
  let loginRes = await fetch('https://app.mabox.tech/api/web-auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': 'https://app.mabox.tech', 'Referer': 'https://app.mabox.tech/' },
    body: JSON.stringify({ email: 'test', password: '123' })
  });
  if (loginRes.status !== 200) {
    loginRes = await fetch('https://app.mabox.tech/api/web-auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Origin': 'https://app.mabox.tech', 'Referer': 'https://app.mabox.tech/' },
      body: JSON.stringify({ username: 'test', password: '123' })
    });
  }
  const cookies = loginRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
  
  const boardRes = await fetch('https://app.mabox.tech/api/tms/board', { headers: { 'Cookie': cookies } });
  const boardData = await boardRes.json();
  const targetRow = boardData.rows?.find(r => r.unitLabel && r.unitLabel.includes('B 9760 SXW'));
  if (!targetRow) return console.log('Target unit not found.');
  
  const detailRes = await fetch('https://app.mabox.tech/api/tms/board/detail?rowId=' + targetRow.rowId, { headers: { 'Cookie': cookies } });
  const detailData = await detailRes.json();
  const detail = detailData.detail || targetRow;
  
  const today = new Date();
  const todayStr = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');
  const startDay = new Date(Date.now() - 86400000*2).toISOString().split('T')[0];
  
  const historyRes = await fetch('https://app.mabox.tech/api/unit-history?accountId=naufal&unitId=' + detail.unitId + '&startDate=' + startDay + '&endDate=' + todayStr + '&source=remote', { headers: { 'Cookie': cookies } });
  const historyData = await historyRes.json();
  
  console.log('Unit ID:', detail.unitId, 'History length:', historyData.records?.length);
}
test();
