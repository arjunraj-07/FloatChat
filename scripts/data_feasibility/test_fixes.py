import os
import certifi
import urllib.request

# Try setting certifi
os.environ['SSL_CERT_FILE'] = certifi.where()
os.environ['REQUESTS_CA_BUNDLE'] = certifi.where()

import xarray as xr
from argopy import DataFetcher

def test_argo():
    print("Testing Argo connection...")
    try:
        box = [60, 61, 15, 16, 0, 10, '2024-01-01', '2024-01-05']
        loader = DataFetcher(src='erddap').region(box)
        ds = loader.to_xarray()
        print("Argo ERDDAP connection SUCCESS.", len(ds.variables))
    except Exception as e:
        print("Argo ERDDAP connection FAILED:", e)

def test_woa():
    print("Testing WOA23 decode_times=False...")
    url = "https://www.ncei.noaa.gov/thredds-ocean/dodsC/woa23/DATA/temperature/netcdf/decav91C0/1.00/woa23_decav91C0_t01_01.nc"
    try:
        ds = xr.open_dataset(url, engine='netcdf4', decode_times=False)
        print("WOA23 connection SUCCESS. Variables:", list(ds.variables))
        print("Time variable values:", ds['time'].values, ds['time'].attrs)
    except Exception as e:
        print("WOA23 FAILED:", e)

def check_oisst_ltm():
    print("Testing OISST LTM metadata...")
    url_ltm = "https://psl.noaa.gov/thredds/dodsC/Datasets/noaa.oisst.v2.highres/sst.day.mean.ltm.1991-2020.nc"
    try:
        ds = xr.open_dataset(url_ltm, engine='netcdf4', decode_times=False)
        print("OISST LTM connection SUCCESS.")
        print("Time values:", ds['time'].values[:5], ds['time'].attrs)
        print("Dimensions:", ds.dims)
    except Exception as e:
        print("OISST LTM FAILED:", e)

if __name__ == "__main__":
    test_argo()
    test_woa()
    check_oisst_ltm()
