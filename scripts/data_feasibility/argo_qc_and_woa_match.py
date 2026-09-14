import os
import pandas as pd
import numpy as np
import xarray as xr
import gsw
import requests

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(OUT_DIR, "data", "raw")
SUBSET_FILE = os.path.join(DATA_DIR, "argo_test_subset.nc")

def normalize_qc(val):
    if pd.isna(val):
        return np.nan
    
    if isinstance(val, (bytes, bytearray)):
        try:
            val = val.decode('utf-8')
        except:
            return np.nan
            
    if isinstance(val, str):
        val = val.strip()
        if not val:
            return np.nan
        try:
            val = float(val)
        except ValueError:
            return np.nan
            
    if isinstance(val, (int, float, np.number)):
        if not np.isfinite(val):
            return np.nan
        if val == int(val):
            return int(val)
        else:
            # Reject non-integral like 1.5
            return np.nan
            
    return np.nan

def test_qc_normalization():
    print("=== 2. QC Normalization Regression Tests ===")
    assert normalize_qc(1) == 1
    assert normalize_qc(1.0) == 1
    assert normalize_qc('1') == 1
    assert normalize_qc(b'1') == 1
    assert np.isnan(normalize_qc(1.5))
    assert np.isnan(normalize_qc('1.5'))
    assert np.isnan(normalize_qc('bad'))
    assert np.isnan(normalize_qc(np.nan))
    assert normalize_qc('4') == 4
    print("PASS: QC normalizer handles b'1', '1', 1, 1.0, and rejects 1.5 and missing.")

def report_argo_coverage():
    print("\n=== 3. Report Actual Argo Coverage ===")
    ds = xr.open_dataset(SUBSET_FILE)
    df = ds.to_dataframe().reset_index()
    
    print(f"Downloaded observation rows: {len(df)}")
    
    if 'direction' not in df.columns:
        df['direction'] = 'A'
        
    df['PROFILE_ID'] = df['platform_number'].astype(str) + '_' + df['cycle_number'].astype(str) + '_' + df['direction'].astype(str)
    
    distinct_floats = df['platform_number'].nunique()
    distinct_profiles = df['PROFILE_ID'].nunique()
    print(f"Distinct floats before QC: {distinct_floats}")
    print(f"Distinct profiles before QC: {distinct_profiles}")
    
    # Normalize QC
    df['PRES_QC_NORM'] = df['pres_qc'].apply(normalize_qc)
    df['TEMP_QC_NORM'] = df['temp_qc'].apply(normalize_qc)
    df['PSAL_QC_NORM'] = df['psal_qc'].apply(normalize_qc)
    
    valid_pres = (df['PRES_QC_NORM'] == 1).sum()
    valid_temp = (df['TEMP_QC_NORM'] == 1).sum()
    valid_psal = (df['PSAL_QC_NORM'] == 1).sum()
    print(f"Valid levels (QC=1) per variable - PRES: {valid_pres}, TEMP: {valid_temp}, PSAL: {valid_psal}")
    
    # We allow TEMP only profiles if PSAL is bad (but PRES and TEMP must be good)
    # The policy might require PSAL, but user said: "Keep temperature-only profiles usable for calculations that do not require salinity."
    # So we define valid points as having good PRES and TEMP.
    df['QC_PASS'] = (df['PRES_QC_NORM'] == 1) & (df['TEMP_QC_NORM'] == 1)
    
    df_valid = df[df['QC_PASS']].copy()
    valid_profiles = df_valid['PROFILE_ID'].nunique()
    print(f"Distinct usable profiles after QC (PRES & TEMP good): {valid_profiles}")
    
    exclusions = df[~df['QC_PASS']]
    print("Exclusions grouped by reason:")
    bad_pres = (exclusions['PRES_QC_NORM'] != 1).sum()
    bad_temp = (exclusions['TEMP_QC_NORM'] != 1).sum()
    print(f"  - Bad/Missing PRES QC: {bad_pres}")
    print(f"  - Bad/Missing TEMP QC: {bad_temp}")
    
    return df_valid

def demonstrate_woa_match(df_valid):
    print("\n=== 4. Demonstrate One Real WOA Match ===")
    
    if len(df_valid) == 0:
        print("No valid Argo observations available for WOA match.")
        return
        
    # Pick one genuinely retrieved Argo profile with valid measurements
    profile_id = df_valid['PROFILE_ID'].iloc[0]
    df_prof = df_valid[df_valid['PROFILE_ID'] == profile_id].copy()
    
    # Sort by pressure
    df_prof = df_prof.sort_values('pres')
    
    # Derive depth
    df_prof['depth_derived'] = -gsw.z_from_p(df_prof['pres'], df_prof['latitude'])
    
    # Select first surface-ish observation
    obs = df_prof.iloc[0]
    
    print(f"WMO/profile identity: {profile_id}")
    print(f"Observation date: {obs['time']}")
    print(f"Location: {obs['latitude']:.3f} N, {obs['longitude']:.3f} E")
    print(f"Selected source fields and QC:")
    print(f"  - PRES: {obs['pres']} (QC: {obs['pres_qc']} -> {obs['PRES_QC_NORM']})")
    print(f"  - TEMP: {obs['temp']} (QC: {obs['temp_qc']} -> {obs['TEMP_QC_NORM']})")
    print(f"Derived depth: {obs['depth_derived']:.2f} m")
    
    # Lookup WOA23
    month = pd.to_datetime(obs['time']).month
    woa_url = f"https://www.ncei.noaa.gov/thredds-ocean/dodsC/woa23/DATA/temperature/netcdf/decav91C0/1.00/woa23_decav91C0_t{month:02d}_01.nc"
    
    try:
        ds_woa = xr.open_dataset(woa_url, engine='netcdf4', decode_times=False)
        # Match nearest valid depth
        # WOA depths are typically 0, 5, 10, 15...
        woa_depths = ds_woa.depth.values
        idx_depth = (np.abs(woa_depths - obs['depth_derived'])).argmin()
        woa_target_depth = woa_depths[idx_depth]
        
        # We should NOT extrapolate. Compare at a supported depth without extrapolation.
        if abs(woa_target_depth - obs['depth_derived']) > 5.0: # simplistic limit
            print(f"Warning: Nearest WOA depth is {woa_target_depth}m, difference > 5m.")
            
        # Select spatial grid
        val_woa = ds_woa['t_an'].sel(
            lat=obs['latitude'], lon=obs['longitude'], 
            method='nearest'
        ).isel(time=0, depth=idx_depth).values
        
        # Calculate spatial offset
        nearest_lat = ds_woa['t_an'].sel(lat=obs['latitude'], method='nearest').lat.values
        nearest_lon = ds_woa['t_an'].sel(lon=obs['longitude'], method='nearest').lon.values
        offset_lat = nearest_lat - obs['latitude']
        offset_lon = nearest_lon - obs['longitude']
        
        print(f"WOA reference value (t_an): {float(val_woa):.3f} {ds_woa['t_an'].units}")
        print(f"WOA matched month: {month} (t{month:02d}), depth: {woa_target_depth}m")
        print(f"Spatial offset: {offset_lat:.3f} deg lat, {offset_lon:.3f} deg lon")
        
        diff = obs['temp'] - val_woa
        print(f"Signed difference (Argo - WOA): {diff:.3f} °C")
        print("Matching method and provenance: Nearest-neighbor spatial interpolation via xarray, nearest standard depth selection from NOAA NCEI WOA23 OPeNDAP endpoint.")
    except Exception as e:
        print("Failed to perform WOA match:", e)

def check_historical_sst_chunk():
    print("\n=== 5. Preserve Baseline Work Without Uncontrolled Download ===")
    
    # We will test loading a small temporal/spatial subset via NCSS (NetCDF Subset Service)
    print("Testing one historical chunk via NCSS (1991, 60-65E, 15-20N)...")
    ncss_url = (
        "https://psl.noaa.gov/thredds/ncss/grid/Datasets/noaa.oisst.v2.highres/sst.day.mean.1991.nc"
        "?var=sst&north=20&west=60&east=65&south=15"
        "&time_start=1991-01-01T00:00:00Z&time_end=1991-12-31T23:59:59Z&accept=netcdf3"
    )
    
    file_path = os.path.join(DATA_DIR, "oisst_1991_chunk.nc")
    
    if not os.path.exists(file_path):
        try:
            r = requests.get(ncss_url, timeout=60)
            r.raise_for_status()
            with open(file_path, "wb") as f:
                f.write(r.content)
            print(f"Successfully downloaded 1991 chunk. Size: {len(r.content) / 1024:.2f} KB")
        except Exception as e:
            print("Failed to download NCSS chunk:", e)
            return
    else:
        print("1991 chunk already downloaded.")
        
    try:
        ds = xr.open_dataset(file_path)
        # Load into memory first before area weighting
        ds.load()
        weights = np.cos(np.deg2rad(ds.lat))
        sst_reg = ds.sst.weighted(weights).mean(dim=['lat', 'lon'])
        df_year = sst_reg.to_dataframe().reset_index()
        print(f"Successfully calculated regional series from local chunk. Rows: {len(df_year)}")
        print("Bounded scaling plan: We will use the NCSS endpoint to loop through 1991-2020 sequentially, downloading ~150KB files per year instead of 30+ GB of global files, caching them locally, and computing the historical baseline safely.")
    except Exception as e:
        print("Failed to process historical chunk:", e)

if __name__ == "__main__":
    test_qc_normalization()
    df_valid = report_argo_coverage()
    demonstrate_woa_match(df_valid)
    check_historical_sst_chunk()
