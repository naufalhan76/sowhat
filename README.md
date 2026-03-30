# Solofleet Ops Analyst Dashboard

Run locally with one command:

```powershell
cd A:\Solofleet
npm start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

Available scripts:

- `npm start` runs backend API and Vite UI together for local development.
- `npm run build` creates the production frontend bundle in `web-dist`.
- `npm run serve` serves the built app from the local Node server.

Flow pakai:

1. Login ke Solofleet di browser biasa.
2. Copy `Cookie` header dari DevTools.
3. Paste ke panel Settings, lalu klik Save config.
4. Klik Auto discover units untuk tarik unit live dari endpoint vehicle page.
5. Klik Poll now, lalu Start auto polling kalau mau jalan otomatis.

Yang sekarang tersedia:

- Overview untuk live temp alerts, compile per day, dan daily totals.
- Fleet live untuk snapshot unit dari Vehicle page, termasuk lokasi, latitude, longitude, speed, temp live, dan error flag.
- Historical untuk lihat chart dan raw history per unit.
- Temp Errors untuk daftar incident suhu + chart unit terpilih.
- Stop / idle explorer untuk tarik report stop/idle per unit berdasarkan date range dan export CSV.

Data lokal tetap disimpan di [data\config.json](/A:/Solofleet/data/config.json) dan [data\state.json](/A:/Solofleet/data/state.json).
