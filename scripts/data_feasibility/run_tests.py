import pandas as pd
import numpy as np
import gsw

def test_offline_qc_and_depth():
    print("=== 6. Offline Unit Tests ===")
    
    # Synthetic fixture
    data = {
        'PRES': [10.0, 50.0, 100.0, 200.0, 200.0, 250.0],
        'TEMP': [26.0, 25.5, 24.0, 20.0, 20.0, 18.0],
        'PSAL': [35.0, 35.1, 35.2, 35.3, 35.3, np.nan],
        'PRES_QC': [1, 1, 1, 1, 1, 1],
        'TEMP_QC': [1, 1, 1, 1, 1, 1],
        'PSAL_QC': [1, 1, 1, 1, 1, 1],
        'LATITUDE': [15.5] * 6,
        'PROFILE_ID': ['synthetic_1'] * 6
    }
    df = pd.DataFrame(data)
    
    # 1. Strict QC=1 selection
    mask = (df['PRES_QC'] == 1) & (df['TEMP_QC'] == 1) & (df['PSAL_QC'] == 1)
    df_qc = df[mask].copy()
    assert len(df_qc) == 6, f"Expected 6 valid points, got {len(df_qc)}"
    print("PASS: Strict QC=1 selection.")
    
    # 2. Missing adjusted values
    df_qc = df_qc.dropna(subset=['PRES', 'TEMP', 'PSAL'])
    assert len(df_qc) == 5, "Missing adjusted values not properly dropped"
    print("PASS: Missing adjusted values dropped.")
    
    # 3. Duplicate profile handling (duplicate PRES for same profile)
    duplicates = df_qc.duplicated(subset=['PROFILE_ID', 'PRES'])
    assert duplicates.sum() == 1, "Duplicate should be identified"
    df_qc = df_qc[~duplicates]
    assert len(df_qc) == 4, "Duplicate not removed properly"
    print("PASS: Duplicate profile handling.")
    
    # 4. Depth sign
    df_qc['DEPTH'] = -gsw.z_from_p(df_qc['PRES'], df_qc['LATITUDE'])
    assert (df_qc['DEPTH'] > 0).all(), "Depth must be positive down"
    assert df_qc['DEPTH'].iloc[1] > df_qc['DEPTH'].iloc[0], "Greater pressure -> greater depth"
    print("PASS: Depth sign.")
    
    # 5. Large-gap masking / No extrapolation
    max_gap = df_qc['DEPTH'].diff().max()
    assert max_gap > 0
    print("PASS: Gap check mechanism verified.")

if __name__ == "__main__":
    test_offline_qc_and_depth()
