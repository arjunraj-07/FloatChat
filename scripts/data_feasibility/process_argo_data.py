import os
import requests
import certifi
import pandas as pd
import numpy as np
import xarray as xr
import gsw
import datetime

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(OUT_DIR, "data", "raw")
PROC_DIR = os.path.join(OUT_DIR, "data", "processed")
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(PROC_DIR, exist_ok=True)

def normalize_qc(val):
    if pd.isna(val):
        return np.nan
    if isinstance(val, (bytes, bytearray)):
        try: val = val.decode('utf-8')
        except: return np.nan
    if isinstance(val, str):
        val = val.strip()
        if not val: return np.nan
        try: val = float(val)
        except ValueError: return np.nan
    if isinstance(val, (int, float, np.number)):
        if not np.isfinite(val): return np.nan
        if val == int(val): return int(val)
    return np.nan

def download_and_process():
    print("=== Downloading full ERDDAP subset ===")
    url = (
        "https://erddap.ifremer.fr/erddap/tabledap/ArgoFloats.nc?"
        "cycle_number,data_mode,direction,latitude,longitude,platform_number,"
        "pres,pres_qc,pres_adjusted,pres_adjusted_qc,pres_adjusted_error,"
        "temp,temp_qc,temp_adjusted,temp_adjusted_qc,temp_adjusted_error,"
        "psal,psal_qc,psal_adjusted,psal_adjusted_qc,psal_adjusted_error,"
        "time,time_qc&"
        "longitude>=60&longitude<=65&latitude>=15&latitude<=20&"
        "pres>=0&pres<=500&time>=1704067200.0&time<=1704844800.0"
    )
    raw_file = os.path.join(DATA_DIR, "argo_test_subset_full.nc")
    
    if not os.path.exists(raw_file):
        try:
            r = requests.get(url, verify=certifi.where(), timeout=60)
            r.raise_for_status()
            with open(raw_file, "wb") as f:
                f.write(r.content)
            print("Successfully downloaded full Argo subset.")
        except Exception as e:
            print("Failed to download Argo subset:", e)
            return
            
    print("=== Processing Dataset ===")
    ds = xr.open_dataset(raw_file)
    df = ds.to_dataframe().reset_index()
    
    # Decoding bytes
    for col in ['data_mode', 'direction', 'platform_number']:
        if col in df.columns:
            df[col] = df[col].apply(lambda x: x.decode('utf-8') if isinstance(x, (bytes, bytearray)) else str(x))
            
    # Explicit missing handling for Data Mode
    df['data_mode'] = df['data_mode'].replace(['', 'nan', 'None'], np.nan)
    
    # Normalize QCs
    qc_cols = ['pres_qc', 'pres_adjusted_qc', 'temp_qc', 'temp_adjusted_qc', 'psal_qc', 'psal_adjusted_qc']
    for c in qc_cols:
        df[c] = df[c].apply(normalize_qc)
        
    records = []
    exclusions = {'unsupported_mode': 0, 'bad_pres': 0, 'bad_temp': 0}
    
    for idx, row in df.iterrows():
        dm = row['data_mode']
        if pd.isna(dm) or dm not in ['R', 'A', 'D']:
            exclusions['unsupported_mode'] += 1
            continue
            
        use_adj = (dm in ['A', 'D'])
        
        # Pressure
        p_val = row['pres_adjusted'] if use_adj else row['pres']
        p_qc = row['pres_adjusted_qc'] if use_adj else row['pres_qc']
        if pd.isna(p_val) or p_qc != 1:
            exclusions['bad_pres'] += 1
            continue
            
        # Temperature
        t_val = row['temp_adjusted'] if use_adj else row['temp']
        t_qc = row['temp_adjusted_qc'] if use_adj else row['temp_qc']
        if pd.isna(t_val) or t_qc != 1:
            exclusions['bad_temp'] += 1
            continue
            
        # Salinity (allow missing/bad)
        s_val = row['psal_adjusted'] if use_adj else row['psal']
        s_qc = row['psal_adjusted_qc'] if use_adj else row['psal_qc']
        
        # If salinity QC is not 1, we set it to NaN to preserve TEMP
        if pd.isna(s_val) or s_qc != 1:
            s_val = np.nan
            s_qc = np.nan
            
        depth = -gsw.z_from_p(p_val, row['latitude'])
        
        # Normalize cycle
        try:
            cyc = int(float(row['cycle_number']))
        except:
            cyc = 0
            
        prof_id = f"{row['platform_number']}_{cyc}_{row['direction']}"
        
        records.append({
            'profile_id': prof_id,
            'platform': row['platform_number'],
            'cycle': cyc,
            'direction': row['direction'],
            'data_mode': dm,
            'time': row['time'],
            'latitude': row['latitude'],
            'longitude': row['longitude'],
            'pres': p_val,
            'depth': depth,
            'temp': t_val,
            'psal': s_val,
            'source_field': 'adjusted' if use_adj else 'raw',
            'temp_error': row['temp_adjusted_error'] if use_adj else np.nan,
            'psal_error': row['psal_adjusted_error'] if use_adj else np.nan,
        })
        
    df_obs = pd.DataFrame(records)
    print(f"Total input rows: {len(df)}")
    print(f"Processed valid observations: {len(df_obs)}")
    print(f"Exclusions: {exclusions}")
    
    if len(df_obs) > 0:
        # Save observations
        df_obs.to_parquet(os.path.join(PROC_DIR, "argo_observations.parquet"))
        
        # Aggregate profiles
        df_prof = df_obs.groupby('profile_id').agg({
            'platform': 'first',
            'cycle': 'first',
            'direction': 'first',
            'data_mode': 'first',
            'time': 'first',
            'latitude': 'first',
            'longitude': 'first',
            'depth': ['min', 'max', 'count'],
            'temp': 'count',
            'psal': 'count'
        }).reset_index()
        
        df_prof.columns = ['profile_id', 'platform', 'cycle', 'direction', 'data_mode', 'time', 'latitude', 'longitude', 'depth_min', 'depth_max', 'obs_count', 'temp_count', 'psal_count']
        df_prof.to_parquet(os.path.join(PROC_DIR, "argo_profiles.parquet"))
        print(f"Saved {len(df_prof)} profiles.")
        
if __name__ == "__main__":
    download_and_process()
