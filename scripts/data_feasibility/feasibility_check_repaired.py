import os
import requests
import certifi
import pandas as pd
import numpy as np
import xarray as xr
import gsw
import datetime
import urllib.parse
from io import BytesIO

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(OUT_DIR, "data", "raw")
os.makedirs(DATA_DIR, exist_ok=True)

def fetch_one_argo_profile():
    print("\n=== 2. Repair Argo Certificate Verification ===")
    # Download one small subset via ERDDAP HTTP API (using requests + certifi)
    # Bounding box: 60-65E, 15-20N. Time: 2024-01-01 to 2024-01-10
    url = (
        "https://erddap.ifremer.fr/erddap/tabledap/ArgoFloats.nc?"
        "cycle_number,data_mode,direction,latitude,longitude,platform_number,"
        "pres,pres_qc,psal,psal_qc,temp,temp_qc,time,time_qc&"
        "longitude>=60&longitude<=65&latitude>=15&latitude<=20&"
        "pres>=0&pres<=500&time>=1704067200.0&time<=1704844800.0"
    )
    file_path = os.path.join(DATA_DIR, "argo_test_subset.nc")
    
    if not os.path.exists(file_path):
        print("Downloading Argo subset via requests with certifi verification...")
        try:
            r = requests.get(url, verify=certifi.where(), timeout=30)
            r.raise_for_status()
            with open(file_path, "wb") as f:
                f.write(r.content)
            print("Successfully downloaded Argo subset.")
        except Exception as e:
            print("Failed to download Argo subset:", e)
            return None
    else:
        print("Argo subset already downloaded.")
        
    try:
        ds = xr.open_dataset(file_path)
        df = ds.to_dataframe().reset_index()
        print(f"Retrieved {len(df)} points.")
        # Filter for QC=1
        df_qc = df[(df['pres_qc'] == 1) & (df['temp_qc'] == 1) & (df['psal_qc'] == 1)].copy()
        
        # Identity
        df_qc['PROFILE_ID'] = df_qc['platform_number'].astype(str) + '_' + df_qc['cycle_number'].astype(str) + '_' + df_qc['direction'].astype(str)
        print(f"Unique profiles retrieved: {df_qc['PROFILE_ID'].nunique()}")
        
        if len(df_qc) > 0:
            print("First verified profile identity:", df_qc['PROFILE_ID'].iloc[0])
            print(f"QC results: {len(df_qc)} valid points out of {len(df)}.")
        return df_qc
    except Exception as e:
        print("Failed to parse Argo dataset:", e)
        return None

def check_woa23():
    print("\n=== 3. Repair WOA23 Parsing ===")
    url = "https://www.ncei.noaa.gov/thredds-ocean/dodsC/woa23/DATA/temperature/netcdf/decav91C0/1.00/woa23_decav91C0_t01_01.nc"
    try:
        print("Opening WOA23 with decode_times=False...")
        ds = xr.open_dataset(url, engine='netcdf4', decode_times=False)
        ds_reg = ds.sel(lat=slice(15, 20), lon=slice(60, 65))
        
        print("Time variable values:", ds['time'].values, ds['time'].attrs['units'])
        print("Documented month: January (t01)")
        
        # Verify one baseline lookup at a valid location and depth
        test_val = ds_reg['t_an'].isel(time=0, depth=0).mean().values
        print(f"Verified WOA baseline lookup (mean SST in region for Jan): {test_val:.2f} °C")
    except Exception as e:
        print("Failed WOA23 check:", e)

def check_oisst_baseline():
    print("\n=== 4 & 5. Check SST Baseline & Bounded Retrieval ===")
    
    # 4. Check scientific suitability of LTM
    url_ltm = "https://psl.noaa.gov/thredds/dodsC/Datasets/noaa.oisst.v2.highres/sst.day.mean.ltm.1991-2020.nc"
    print(f"Checking LTM URL: {url_ltm}")
    try:
        ds_ltm = xr.open_dataset(url_ltm, engine='netcdf4', decode_times=False)
        dims = ds_ltm.dims
        print(f"LTM Dimensions: {dims}")
        print("Analysis: The 1991-2020 LTM dataset supplies only a mean seasonal cycle (time=365).")
        print("A long-term mean alone cannot establish the historical 90th percentile. We must retrieve historical daily observations.")
    except Exception as e:
        print("Failed to check LTM:", e)
        
    # 5. Retrieve bounded regional historical daily subsets for 1991-2020 incrementally
    print("\nTesting bounded historical subset retrieval (1991-1992)...")
    years = [1991, 1992]
    all_years = []
    
    for year in years:
        url = f"https://psl.noaa.gov/thredds/dodsC/Datasets/noaa.oisst.v2.highres/sst.day.mean.{year}.nc"
        file_path = os.path.join(DATA_DIR, f"sst_regional_{year}.parquet")
        
        if os.path.exists(file_path):
            print(f"Year {year} already cached.")
            df_year = pd.read_parquet(file_path)
        else:
            try:
                print(f"Fetching subset for {year}...")
                ds = xr.open_dataset(url, engine='netcdf4')
                ds_reg = ds.sel(lat=slice(15, 20), lon=slice(60, 65))
                weights = np.cos(np.deg2rad(ds_reg.lat))
                sst_reg = ds_reg.sst.weighted(weights).mean(dim=['lat', 'lon']).compute()
                df_year = sst_reg.to_dataframe().reset_index()
                df_year.to_parquet(file_path)
                print(f"Successfully cached {len(df_year)} daily regional SST records for {year}.")
            except Exception as e:
                print(f"Failed to fetch {year}: {e}")
                continue
        all_years.append(df_year)
    
    if all_years:
        df_hist = pd.concat(all_years)
        print(f"Total historical records so far: {len(df_hist)}")
        print("Threshold readiness: IN PROGRESS (Need to fetch up to 2020 to compute 90th percentile over 11-day window)")

if __name__ == "__main__":
    fetch_one_argo_profile()
    check_woa23()
    check_oisst_baseline()
