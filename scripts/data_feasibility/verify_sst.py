import os
import pandas as pd
import numpy as np

def verify_sst():
    print("=== 1. Verifying Existing SST Result ===")
    out_dir = os.path.dirname(os.path.abspath(__file__))
    file_path = os.path.join(out_dir, "sst_daily.parquet")
    
    if not os.path.exists(file_path):
        print("FAIL: sst_daily.parquet not found.")
        return

    df = pd.read_parquet(file_path)
    
    # 1. Exactly 182 unique, ordered daily dates
    dates = df['time']
    num_unique = dates.nunique()
    is_ordered = dates.is_monotonic_increasing
    start_date = dates.min().strftime('%Y-%m-%d')
    end_date = dates.max().strftime('%Y-%m-%d')
    
    expected_count = 182
    print(f"Row count: {len(df)}. Unique dates: {num_unique}. Ordered: {is_ordered}.")
    print(f"Date range: {start_date} to {end_date}.")
    
    if num_unique == expected_count and start_date == '2024-01-01' and end_date == '2024-06-30' and is_ordered:
        print("PASS: Exactly 182 unique, ordered daily dates from Jan-Jun 2024.")
    else:
        print("FAIL: Date requirements not met.")

    # 2. Missing/non-finite SST values, units, and source
    non_finite = df['sst'].isna().sum() + np.isinf(df['sst']).sum()
    print(f"Non-finite SST values: {non_finite}.")
    if non_finite == 0:
        print("PASS: All SST values are finite.")
    else:
        print("FAIL: Missing/non-finite SST values found.")
        
    # We will log the rest of the checks (lon/lat, mask, weights) from the feasibility_check script modifications
    print("Verification complete.")

if __name__ == "__main__":
    verify_sst()
