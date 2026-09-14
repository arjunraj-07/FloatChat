import requests
import certifi

def fetch_schema():
    print("Fetching ERDDAP Argo schema...")
    url = "https://erddap.ifremer.fr/erddap/tabledap/ArgoFloats.das"
    try:
        r = requests.get(url, verify=certifi.where(), timeout=30)
        r.raise_for_status()
        das_content = r.text
        
        # Check for our needed variables
        variables = ["pres", "pres_adjusted", "pres_qc", "pres_adjusted_qc", "pres_adjusted_error",
                     "temp", "temp_adjusted", "temp_qc", "temp_adjusted_qc", "temp_adjusted_error",
                     "psal", "psal_adjusted", "psal_qc", "psal_adjusted_qc", "psal_adjusted_error",
                     "data_mode", "direction", "platform_number", "cycle_number"]
                     
        missing = []
        for v in variables:
            if f" {v} {{" not in das_content and f" {v} " not in das_content:
                # simpler check
                if das_content.find(f" {v}") == -1:
                    missing.append(v)
                    
        print(f"Missing variables in schema: {missing}")
        if not missing:
            print("All required raw/adjusted variables are present in the ERDDAP schema.")
            
    except Exception as e:
        print("Failed to fetch ERDDAP schema:", e)

if __name__ == "__main__":
    fetch_schema()
