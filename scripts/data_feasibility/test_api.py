import requests
import time
import subprocess
import os
import signal
import sys

def test_api():
    print("=== Testing FastAPI Endpoints ===")
    
    python_exe = r"C:\Users\DELL\Desktop\Orion\venv\Scripts\python.exe"
    
    # Start server
    env = os.environ.copy()
    proc = subprocess.Popen(
        [python_exe, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000"],
        cwd=r"C:\Users\DELL\Desktop\Orion\api",
        env=env,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP
    )
    
    try:
        # Wait for server to start
        time.sleep(10)
        
        # Test 1: Coverage
        print("\nTest 1: /api/coverage")
        r = requests.get("http://127.0.0.1:8000/api/coverage")
        r.raise_for_status()
        cov = r.json()
        print(cov)
        assert cov["distinct_floats"] > 0
        assert "ERDDAP" in cov["dataset"]
        print("PASS: Coverage endpoint")
        
        # Test 2: Floats
        print("\nTest 2: /api/floats")
        r = requests.get("http://127.0.0.1:8000/api/floats")
        r.raise_for_status()
        floats = r.json()
        print(f"Returned {len(floats)} floats")
        assert len(floats) == cov["distinct_floats"]
        prof_id = floats[0]["profiles"][0]["profile_id"]
        print("PASS: Floats endpoint")
        
        # Test 3: Profile Detail
        print(f"\nTest 3: /api/profiles/{prof_id}")
        r = requests.get(f"http://127.0.0.1:8000/api/profiles/{prof_id}")
        r.raise_for_status()
        prof = r.json()
        print(f"Returned {len(prof['observations'])} observations")
        assert len(prof['observations']) > 0
        assert 'depth' in prof['observations'][0]
        assert prof['data_mode'] in ['R', 'A', 'D']
        print("PASS: Profile endpoint")
        
        # Test 4: WOA Match
        print(f"\nTest 4: /api/woa_match/{prof_id}")
        r = requests.get(f"http://127.0.0.1:8000/api/woa_match/{prof_id}")
        r.raise_for_status()
        woa = r.json()
        print(woa)
        assert "status" in woa
        if woa["status"] == "Success":
            assert "comparison_depth" in woa
            assert "difference" in woa
        print("PASS: WOA match endpoint")
        
    finally:
        # Kill server
        os.kill(proc.pid, signal.CTRL_BREAK_EVENT)
        proc.kill()

if __name__ == "__main__":
    test_api()
