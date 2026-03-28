# Solofleet Temp Error MVP

Start the local server from [package.json](/A:/Solofleet/package.json):

```powershell
cd A:\Solofleet
npm start
```

Then open `http://127.0.0.1:3000` and:

1. Upload one or more raw JSON files exported from Solofleet temperature report.
2. Pick the date range you want to see.
3. Click `Refresh report`.

Current MVP rules:

- `Temp1 error`: `vtemp1 = 0` for at least 5 minutes while `vtemp2` is not zero.
- `Temp2 error`: `vtemp2 = 0` for at least 5 minutes while `vtemp1` is not zero.
- `Temp1 + Temp2 error`: both virtual temps stay at `0` for at least 5 minutes.

The page shows:

- `Alert Unit Error`: incident-level alert rows
- `Compile Unit Error Per Day`: unit/day rollup for the selected range
- `Daily Totals`: quick management summary per day
