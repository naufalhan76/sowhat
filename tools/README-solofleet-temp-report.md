# Solofleet Temp Error Report

Script ini dipakai buat cari kejadian saat `virtual temp1` / `virtual temp2` bernilai `0` terus selama minimal 5 menit.

## 1. Ambil raw JSON dari browser yang sudah login

Jalankan ini di DevTools Console saat kamu sudah login ke `https://www.solofleet.com/ReportTemperatureChart`:

```js
(async () => {
  const payload = {
    ddl: "col39",
    startdatetime: "2026-03-26T17:00:00.000Z",
    enddatetime: "2026-03-27T16:57:14.000Z",
    interval: 120,
    tempprofile: "-1",
    temperatureprocessing: "",
    ArchiveType: "liveserver"
  };

  const response = await fetch("https://www.solofleet.com/ReportTemperatureChart/getVehicleDetailDefrostJson", {
    headers: {
      "accept": "application/json, text/javascript, */*; q=0.01",
      "content-type": "application/json; charset=UTF-8",
      "x-requested-with": "XMLHttpRequest"
    },
    referrer: "https://www.solofleet.com/ReportTemperatureChart",
    body: JSON.stringify(payload),
    method: "POST",
    mode: "cors",
    credentials: "include"
  });

  const text = await response.text();
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${payload.ddl}-temperature-raw.json`;
  a.click();
  URL.revokeObjectURL(url);
})();
```

## 2. Jalankan analyzer

```powershell
node A:\Solofleet\tools\solofleet-temp-report.js --input "C:\path\to\col39-temperature-raw.json"
```

Contoh simpan hasil CSV:

```powershell
node A:\Solofleet\tools\solofleet-temp-report.js `
  --input "C:\path\to\col39-temperature-raw.json" `
  --csv "A:\Solofleet\col39-temp-errors.csv"
```

## 3. Opsi penting

```powershell
node A:\Solofleet\tools\solofleet-temp-report.js `
  --input "C:\path\to\raw.json" `
  --min-duration-minutes 5 `
  --max-gap-minutes 6
```

Kalau nama field di akunmu beda, kamu bisa override manual:

```powershell
node A:\Solofleet\tools\solofleet-temp-report.js `
  --input "C:\path\to\raw.json" `
  --time-field gpstime `
  --temp1-field "virtual temp1" `
  --temp2-field "virtual temp2"
```

Catatan:

- Script akan otomatis coba cocokkan field seperti `vtemp1`, `virtual temp1`, `virtual_temp1`, `virtualtemp1`, lalu fallback ke `temp1`.
- `speed` tidak dipakai sebagai filter. Nilai speed cuma ikut dicatat di output kalau memang ada.
- File sampel yang bentuknya JSON-string juga tetap kebaca. Payload model `sampe 3` dengan struktur `detail[]` juga langsung kebaca.

