import os
import json
import logging
import traceback
import pandas as pd
import numpy as np
import xarray as xr
import gsw
from argopy import DataFetcher
import datetime

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger("Feasibility")

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

def save_provenance(key, data):
    prov_file = os.path.join(OUT_DIR, "provenance.json")
    prov = {}
    if os.path.exists(prov_file):
        with open(prov_file, 'r') as f:
            prov = json.load(f)
    prov[key] = data
    with open(prov_file, 'w') as f:
        json.dump(prov, f, indent=2)

def fetch_argo():
    logger.info("=== B. Retrieving Bounded Argo Subset ===")
    box = [60, 65, 15, 20, 0, 500, '2024-01-01', '2024-06-30']
    
    try:
        logger.info(f"Fetching Argo data for box: {box}")
        # fetch only core params to avoid missing BGC issues
        loader = DataFetcher(src='erddap').region(box)
        ds = loader.to_xarray()
        
        df = ds.to_dataframe().reset_index()
        
        expected_cols = ['PRES', 'TEMP', 'PSAL', 'PRES_QC', 'TEMP_QC', 'PSAL_QC']
        missing = [c for c in expected_cols if c not in df.columns]
        if missing:
            logger.warning(f"Columns {missing} missing. Available: {df.columns.tolist()}")
            
        # QC policy: allow only QC=1
        if 'PRES_QC' in df.columns and 'TEMP_QC' in df.columns and 'PSAL_QC' in df.columns:
            df_qc = df.copy()
            # argopy sometimes uses b'1' or 1 depending on backend, let's cast to int
            try:
                qc_mask = (df_qc['PRES_QC'].astype(int) == 1) & (df_qc['TEMP_QC'].astype(int) == 1) & (df_qc['PSAL_QC'].astype(int) == 1)
                df_qc = df_qc[qc_mask].copy()
            except ValueError:
                # If they are byte strings
                qc_mask = (df_qc['PRES_QC'] == b'1') & (df_qc['TEMP_QC'] == b'1') & (df_qc['PSAL_QC'] == b'1')
                df_qc = df_qc[qc_mask].copy()
            
            logger.info(f"Raw points: {len(df)}, QC=1 points: {len(df_qc)}, Excluded: {len(df) - len(df_qc)}")
            
            # TEOS-10 Depth
            df_qc['DEPTH'] = -gsw.z_from_p(df_qc['PRES'], df_qc['LATITUDE'])
            
            if 'DIRECTION' not in df_qc.columns:
                df_qc['DIRECTION'] = 'A'
                
            df_qc['PROFILE_ID'] = df_qc['WMO'].astype(str) + '_' + df_qc['CYCLE_NUMBER'].astype(str) + '_' + df_qc['DIRECTION'].astype(str)
            
            profile_counts = df_qc['PROFILE_ID'].nunique()
            logger.info(f"Unique profiles retrieved: {profile_counts}")
            
            df_qc.to_parquet(os.path.join(OUT_DIR, "argo_profiles.parquet"))
            
            df_qc['MONTH'] = pd.to_datetime(df_qc['TIME']).dt.month
            coverage = df_qc.groupby(['MONTH', pd.cut(df_qc['DEPTH'], bins=[0, 100, 250, 500])]).size().unstack()
            logger.info(f"Usable coverage by month and depth:\n{coverage}")
            
            save_provenance("argo", {
                "source": "Ifremer ERDDAP via argopy",
                "box": box,
                "raw_observations": len(df),
                "qc1_observations": len(df_qc),
                "qc_exclusions": len(df) - len(df_qc),
                "unique_profiles": profile_counts
            })
            return df_qc
        else:
            logger.error("Required QC columns missing, skipping QC filter.")
            return None
    except Exception as e:
        logger.error(f"Failed to fetch Argo data: {e}")
        traceback.print_exc()
        return None

def check_woa():
    logger.info("=== C. Retrieving Compatible WOA References ===")
    woa_urls = [
        "https://www.ncei.noaa.gov/thredds-ocean/dodsC/woa23/DATA/temperature/netcdf/decav91C0/1.00/woa23_decav91C0_t01_01.nc",
        "https://www.ncei.noaa.gov/thredds-ocean/dodsC/woa18/DATA/temperature/netcdf/decav/1.00/woa18_decav_t01_01.nc"
    ]
    
    for url in woa_urls:
        try:
            logger.info(f"Trying WOA url: {url}")
            ds_woa = xr.open_dataset(url, engine='netcdf4')
            
            # WOA lon is -180 to 180
            ds_region = ds_woa.sel(lat=slice(15, 20), lon=slice(60, 65))
            
            var = 't_an' if 't_an' in ds_region.variables else list(ds_region.data_vars)[0]
                
            mean_temp = ds_region[var].mean().values
            logger.info(f"Successfully loaded WOA climatology. Region mean temp: {mean_temp}")
            
            save_provenance("woa", {
                "source_url": url,
                "variable": var,
                "region_mean_test": float(mean_temp) if not np.isnan(mean_temp) else None
            })
            return True
        except Exception as e:
            logger.warning(f"Failed to load {url}: {e}")
            
    logger.error("Failed to load any WOA climatology references.")
    return False

def check_sst():
    logger.info("=== D. Retrieving Daily SST and Baseline (OISST) ===")
    
    url_2024 = "https://psl.noaa.gov/thredds/dodsC/Datasets/noaa.oisst.v2.highres/sst.day.mean.2024.nc"
    url_ltm = "https://psl.noaa.gov/thredds/dodsC/Datasets/noaa.oisst.v2.highres/sst.day.mean.ltm.1991-2020.nc"
    
    try:
        logger.info(f"Testing OISST 2024 access: {url_2024}")
        ds_2024 = xr.open_dataset(url_2024, engine='netcdf4')
        ds_2024_reg = ds_2024.sel(lat=slice(15, 20), lon=slice(60, 65), time=slice('2024-01-01', '2024-06-30'))
        
        if 'sst' in ds_2024_reg:
            weights = np.cos(np.deg2rad(ds_2024_reg.lat))
            sst_regional = ds_2024_reg.sst.weighted(weights).mean(dim=['lat', 'lon']).compute()
            df_sst = sst_regional.to_dataframe().reset_index()
            df_sst.to_parquet(os.path.join(OUT_DIR, "sst_daily.parquet"))
            logger.info(f"Retrieved {len(df_sst)} daily regional SST records for 2024.")
            
            save_provenance("oisst_event", {
                "source_url": url_2024,
                "time_range": ["2024-01-01", "2024-06-30"],
                "records": len(df_sst)
            })
        else:
            logger.error("'sst' variable not found in 2024 dataset.")
            
        logger.info(f"Testing OISST LTM access: {url_ltm}")
        ds_ltm = xr.open_dataset(url_ltm, engine='netcdf4')
        ds_ltm_reg = ds_ltm.sel(lat=slice(15, 20), lon=slice(60, 65))
        if 'sst' in ds_ltm_reg:
            weights = np.cos(np.deg2rad(ds_ltm_reg.lat))
            sst_ltm_regional = ds_ltm_reg.sst.weighted(weights).mean(dim=['lat', 'lon']).compute()
            logger.info("Successfully calculated regional mean from LTM.")
            save_provenance("oisst_baseline", {
                "source_url": url_ltm,
                "notes": "LTM 1991-2020 daily climatology available."
            })
        else:
            logger.error("'sst' variable not found in LTM dataset.")
            
        return True
    except Exception as e:
        logger.error(f"Failed to check SST data: {e}")
        traceback.print_exc()
        return False

def generate_summary():
    logger.info("Generating feasibility summary...")
    prov_file = os.path.join(OUT_DIR, "provenance.json")
    if os.path.exists(prov_file):
        with open(prov_file, 'r') as f:
            prov = json.load(f)
            
        with open(os.path.join(OUT_DIR, "feasibility_summary.md"), 'w') as f:
            f.write("# Data Feasibility Summary\n\n")
            
            f.write("## 1. Argo Profiles\n")
            if "argo" in prov:
                f.write(f"- Unique profiles: {prov['argo'].get('unique_profiles')}\n")
                f.write(f"- QC=1 observations: {prov['argo'].get('qc1_observations')} (Excluded: {prov['argo'].get('qc_exclusions')})\n")
            else:
                f.write("- FAILED to fetch Argo data.\n")
                
            f.write("\n## 2. WOA Climatology\n")
            if "woa" in prov:
                f.write(f"- Source: {prov['woa'].get('source_url')}\n")
                f.write(f"- Status: SUCCESS\n")
            else:
                f.write("- FAILED to access WOA climatology.\n")
                
            f.write("\n## 3. OISST (Event & Baseline)\n")
            if "oisst_event" in prov:
                f.write(f"- Event Source: {prov['oisst_event'].get('source_url')}\n")
                f.write(f"- Baseline Source: {prov.get('oisst_baseline', {}).get('source_url', 'Failed')}\n")
            else:
                f.write("- FAILED to access OISST data.\n")
                
        logger.info("Feasibility summary generated.")

if __name__ == "__main__":
    if not os.path.exists(OUT_DIR):
        os.makedirs(OUT_DIR)
    
    fetch_argo()
    check_woa()
    check_sst()
    generate_summary()
    logger.info("Feasibility check complete.")
