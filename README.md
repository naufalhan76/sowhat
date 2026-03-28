# Solofleet Ops Analyst Dashboard

Run locally:

```powershell
cd A:\Solofleet
npm start
```

Open `http://127.0.0.1:3000`.

Kalau habis ubah source frontend React, rebuild dulu:

```powershell
cd A:\Solofleet
npm run build
```

Flow pakai:

1. Login ke Solofleet di browser biasa.
2. Copy `Cookie` header dari DevTools.
3. Paste ke panel `Settings`, lalu klik `Save config`.
4. Klik `Auto discover units` untuk tarik unit live dari endpoint vehicle page.
5. Klik `Poll now`, lalu `Start auto polling` kalau mau jalan otomatis.

Yang sekarang tersedia:

- `Overview` untuk live temp alerts, compile per day, dan daily totals.
- `Fleet live` untuk snapshot unit dari Vehicle page, termasuk lokasi, `latitude`, `longitude`, speed, temp live, dan error flag.
- `Stop / idle explorer` untuk tarik report stop/idle per unit berdasarkan date range dan export CSV.
- export CSV untuk fleet snapshot, temp alerts, dan stop/idle rows.

Data lokal tetap disimpan di [data\config.json](/A:/Solofleet/data/config.json) dan [data\state.json](/A:/Solofleet/data/state.json).
