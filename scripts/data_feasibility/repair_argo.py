import requests
import certifi
import os

def check_argo_ssl():
    print("=== 2. Repair Argo Certificate Verification ===")
    url_erddap = "https://erddap.ifremer.fr/erddap/index.json"
    url_gdac = "https://data-argo.ifremer.fr/dac/aoml/1901584/profiles/R1901584_001.nc"
    url_ncei = "https://www.ncei.noaa.gov/data/oceans/argo/gdac/dac/aoml/1901584/profiles/R1901584_001.nc"
    
    print("Testing ERDDAP endpoint with requests + certifi...")
    try:
        r = requests.get(url_erddap, verify=certifi.where(), timeout=10)
        print("ERDDAP SUCCESS:", r.status_code)
    except requests.exceptions.SSLError as e:
        print("ERDDAP SSL ERROR:", e)
    except Exception as e:
        print("ERDDAP OTHER ERROR:", e)
        
    print("\nTesting GDAC HTTPS mirror (Ifremer)...")
    try:
        r = requests.get(url_gdac, verify=certifi.where(), timeout=10)
        print("Ifremer GDAC SUCCESS:", r.status_code)
    except requests.exceptions.SSLError as e:
        print("Ifremer GDAC SSL ERROR:", e)
    except Exception as e:
        print("Ifremer GDAC OTHER ERROR:", e)
        
    print("\nTesting NCEI Argo Mirror...")
    try:
        r = requests.get(url_ncei, verify=certifi.where(), timeout=10)
        print("NCEI Mirror SUCCESS:", r.status_code)
        if r.status_code == 200:
            os.makedirs("data/raw", exist_ok=True)
            with open("data/raw/R1901584_001.nc", "wb") as f:
                f.write(r.content)
            print("Successfully downloaded one real profile: R1901584_001.nc")
    except requests.exceptions.SSLError as e:
        print("NCEI Mirror SSL ERROR:", e)
    except Exception as e:
        print("NCEI Mirror OTHER ERROR:", e)

if __name__ == "__main__":
    check_argo_ssl()
