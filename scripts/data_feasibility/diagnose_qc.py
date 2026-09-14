import xarray as xr
import pandas as pd
import os

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
FILE_PATH = os.path.join(OUT_DIR, "data", "raw", "argo_test_subset.nc")

def diagnose_qc():
    if not os.path.exists(FILE_PATH):
        print("Argo subset file not found.")
        return
        
    ds = xr.open_dataset(FILE_PATH)
    
    qc_vars = ['pres_qc', 'temp_qc', 'psal_qc', 'data_mode']
    
    print("=== QC Representation Diagnostic ===")
    for var in qc_vars:
        if var in ds.variables:
            data = ds[var].values
            print(f"\nVariable: {var}")
            print(f"dtype: {data.dtype}")
            print(f"encoding: {ds[var].encoding}")
            
            # Using pandas for easy unique counts
            # Data might be multidimensional, flatten it
            flat_data = data.flatten()
            # drop Nans if they are float
            if pd.api.types.is_float_dtype(data.dtype):
                flat_data = flat_data[~pd.isna(flat_data)]
            else:
                flat_data = [x for x in flat_data if not pd.isna(x)]
                
            s = pd.Series(flat_data)
            counts = s.value_counts(dropna=False)
            print("Unique values and counts:")
            for val, count in counts.items():
                print(f"  {repr(val)}: {count}")
        else:
            print(f"\nVariable: {var} NOT FOUND")
            
    print("\nProfile Identity / Platform:")
    if 'platform_number' in ds.variables:
        print("platform_number dtype:", ds['platform_number'].values.dtype)
        print("platform_number example:", repr(ds['platform_number'].values[0] if ds['platform_number'].size > 0 else 'empty'))
        
if __name__ == "__main__":
    diagnose_qc()
