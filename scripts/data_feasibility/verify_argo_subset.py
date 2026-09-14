import os
import pandas as pd
import xarray as xr
import numpy as np

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
FILE_PATH = os.path.join(OUT_DIR, "data", "raw", "argo_test_subset.nc")

def verify_subset():
    if not os.path.exists(FILE_PATH):
        print("FAIL: File not found.")
        return
        
    ds = xr.open_dataset(FILE_PATH)
    df = ds.to_dataframe().reset_index()
    
    print("=== Verification of Argo Subset ===")
    print(f"Total rows: {len(df)}")
    
    # Check data modes
    if 'data_mode' in df.columns:
        modes = df['data_mode'].apply(lambda x: x.decode('utf-8') if isinstance(x, bytes) else x).unique()
        print(f"Data modes present: {modes}")
    else:
        print("Data mode missing!")
        
    # Check platform and cycle
    platforms = df['platform_number'].apply(lambda x: x.decode('utf-8') if isinstance(x, bytes) else x).unique()
    cycles = df['cycle_number'].unique()
    print(f"Number of floats: {len(platforms)}")
    print(f"Floats: {platforms}")
    
    # Profile ID
    df['platform_str'] = df['platform_number'].apply(lambda x: x.decode('utf-8') if isinstance(x, bytes) else str(x))
    df['direction_str'] = df['direction'].apply(lambda x: x.decode('utf-8') if isinstance(x, bytes) else str(x))
    
    df['PROFILE_ID'] = df['platform_str'] + '_' + df['cycle_number'].astype(int).astype(str) + '_' + df['direction_str']
    profiles = df['PROFILE_ID'].unique()
    print(f"Number of profiles: {len(profiles)}")
    print(f"Profiles: {profiles}")
    
    # Coverage dates
    min_date = df['time'].min()
    max_date = df['time'].max()
    print(f"Date coverage: {min_date} to {max_date}")

    # Adjusted fields
    print("Columns available:")
    for col in ds.variables:
        print(f" - {col}")

if __name__ == "__main__":
    verify_subset()
