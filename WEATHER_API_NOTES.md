# Open-Meteo API Notes

## Error Found
The `models` parameter doesn't work with the marine API in the format `models=ecmwf`.

Error: `{"reason":"Data corrupted at path ''. Cannot initialize MultiDomains from invalid String value ecmwf.","error":true}`

## Solution
1. **Marine API** - Use without `models` parameter (defaults to ECMWF)
2. **Regular Forecast API** - Uses format like `models=ecmwf_ifs04` (not just `ecmwf`)

## Test URLs

### Marine API (works)
```bash
curl "https://marine-api.open-meteo.com/v1/marine?latitude=12.5&longitude=-61.2&hourly=wave_height,wind_speed_10m&forecast_days=1"
```

### Regular Forecast API (with models)
```bash
curl "https://api.open-meteo.com/v1/forecast?latitude=12.5&longitude=-61.2&hourly=wind_speed_10m&models=ecmwf_ifs04&forecast_days=1"
```

## Next Steps
- Test marine API without models parameter
- Check if we can specify models differently for marine API
- Or use regular forecast API for wind, marine API for waves


