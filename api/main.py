import os
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import pandas as pd
import numpy as np
import xarray as xr
from typing import List, Dict, Any

app = FastAPI(title="FloatChat Explorer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load data
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROC_DIR = os.path.join(BASE_DIR, "scripts", "data_feasibility", "data", "processed")

df_prof = pd.read_parquet(os.path.join(PROC_DIR, "argo_profiles.parquet"))
df_obs = pd.read_parquet(os.path.join(PROC_DIR, "argo_observations.parquet"))

@app.get("/api/coverage")
def get_coverage():
    return {
        "dataset": "ERDDAP GDAC Argo (Jan 1-10 2024)",
        "label": "cached historical observations",
        "distinct_floats": int(df_prof['platform'].nunique()),
        "distinct_profiles": int(df_prof['profile_id'].nunique()),
        "date_range": [
            df_prof['time'].min().isoformat(),
            df_prof['time'].max().isoformat()
        ],
        "bounding_box": {
            "west": float(df_prof['longitude'].min()),
            "east": float(df_prof['longitude'].max()),
            "south": float(df_prof['latitude'].min()),
            "north": float(df_prof['latitude'].max()),
        }
    }

@app.get("/api/floats")
def get_floats():
    floats = {}
    for _, row in df_prof.iterrows():
        plat = str(row['platform'])
        if plat not in floats:
            floats[plat] = {
                "platform": plat,
                "profiles": []
            }
        floats[plat]["profiles"].append({
            "profile_id": row['profile_id'],
            "cycle": row['cycle'],
            "direction": row['direction'],
            "data_mode": row['data_mode'],
            "time": row['time'].isoformat(),
            "latitude": float(row['latitude']),
            "longitude": float(row['longitude']),
            "depth_min": float(row['depth_min']) if not pd.isna(row['depth_min']) else None,
            "depth_max": float(row['depth_max']) if not pd.isna(row['depth_max']) else None,
            "temp_count": int(row['temp_count']),
            "psal_count": int(row['psal_count'])
        })
    return list(floats.values())

@app.get("/api/profiles/{profile_id}")
def get_profile(profile_id: str):
    prof_data = df_obs[df_obs['profile_id'] == profile_id].copy()
    if prof_data.empty:
        raise HTTPException(status_code=404, detail="Profile not found")
        
    prof_data = prof_data.sort_values('depth')
    
    # Metadata
    meta = df_prof[df_prof['profile_id'] == profile_id].iloc[0]
    
    observations = []
    for _, row in prof_data.iterrows():
        observations.append({
            "pres": float(row['pres']),
            "depth": float(row['depth']),
            "temp": float(row['temp']) if not pd.isna(row['temp']) else None,
            "psal": float(row['psal']) if not pd.isna(row['psal']) else None,
            "source_field": row['source_field']
        })
        
    return {
        "profile_id": profile_id,
        "platform": str(meta['platform']),
        "cycle": int(meta['cycle']),
        "data_mode": str(meta['data_mode']),
        "time": meta['time'].isoformat(),
        "latitude": float(meta['latitude']),
        "longitude": float(meta['longitude']),
        "observations": observations,
        "metadata": {
            "source": "ERDDAP/GDAC",
            "mhw_detection": "Not yet available"
        }
    }

@app.get("/api/woa_match/{profile_id}")
def woa_match(profile_id: str):
    prof_data = df_obs[df_obs['profile_id'] == profile_id].copy()
    if prof_data.empty:
        raise HTTPException(status_code=404, detail="Profile not found")
        
    prof_data = prof_data.sort_values('depth').dropna(subset=['temp'])
    if prof_data.empty:
        return {"status": "Comparison unavailable", "reason": "No valid temperature data"}
        
    lat = prof_data['latitude'].iloc[0]
    lon = prof_data['longitude'].iloc[0]
    time = prof_data['time'].iloc[0]
    month = pd.to_datetime(time).month
    
    # WOA standard depths (subset)
    woa_depths = np.array([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100])
    
    # Find a standard depth bracketed by valid Argo levels
    argo_min = prof_data['depth'].min()
    argo_max = prof_data['depth'].max()
    
    # Find the shallowest WOA depth that is bracketed
    valid_woa_depths = woa_depths[(woa_depths >= argo_min) & (woa_depths <= argo_max)]
    if len(valid_woa_depths) == 0:
        return {"status": "Comparison unavailable", "reason": "No bracketed standard depth (no extrapolation allowed)"}
        
    target_depth = valid_woa_depths[0]
    
    # Interpolate Argo to this depth (linear)
    try:
        argo_interp = np.interp(target_depth, prof_data['depth'].values, prof_data['temp'].values)
    except:
        return {"status": "Comparison unavailable", "reason": "Interpolation failed"}
        
    # Check max gap
    # Find the two closest depths in Argo
    idx = np.searchsorted(prof_data['depth'].values, target_depth)
    if idx == 0 or idx == len(prof_data):
         return {"status": "Comparison unavailable", "reason": "Out of bounds"}
    
    d1 = prof_data['depth'].values[idx-1]
    d2 = prof_data['depth'].values[idx]
    
    MAX_GAP = 20.0
    if (d2 - d1) > MAX_GAP:
        return {"status": "Comparison unavailable", "reason": f"Gap {d2-d1:.1f}m exceeds max configured gap {MAX_GAP}m"}
        
    # Perform WOA lookup
    woa_url = f"https://www.ncei.noaa.gov/thredds-ocean/dodsC/woa23/DATA/temperature/netcdf/decav91C0/1.00/woa23_decav91C0_t{month:02d}_01.nc"
    try:
        ds_woa = xr.open_dataset(woa_url, engine='netcdf4', decode_times=False)
        
        # Match nearest depth index
        idx_depth = (np.abs(ds_woa.depth.values - target_depth)).argmin()
        actual_woa_depth = ds_woa.depth.values[idx_depth]
        
        val_woa = ds_woa['t_an'].sel(
            lat=lat, lon=lon, method='nearest'
        ).isel(time=0, depth=idx_depth).values
        
        nearest_lat = float(ds_woa['t_an'].sel(lat=lat, method='nearest').lat.values)
        nearest_lon = float(ds_woa['t_an'].sel(lon=lon, method='nearest').lon.values)
        
        offset_lat = nearest_lat - lat
        offset_lon = nearest_lon - lon
        
        diff = float(argo_interp - val_woa)
        
        return {
            "status": "Success",
            "argo_interpolated_value": float(argo_interp),
            "woa_reference_value": float(val_woa),
            "difference": diff,
            "units": "degrees_celsius",
            "comparison_depth": float(actual_woa_depth),
            "month": month,
            "baseline_period": "1991-2020",
            "method": "Linear interpolation of Argo within 20m max gap; nearest-neighbor spatial WOA lookup",
            "spatial_offset": {"lat": float(offset_lat), "lon": float(offset_lon)}
        }
    except Exception as e:
        return {"status": "Comparison unavailable", "reason": f"WOA lookup failed: {str(e)}"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
