import sys
from pathlib import Path

# Tests import the backend as `app`, the way uvicorn and Modal do.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
