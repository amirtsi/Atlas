# Atlas Backend

FastAPI backend for the Atlas MVP.

## Run locally

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e .
uvicorn app.main:app --reload
```

Default API:

```text
http://localhost:8000
```

Health:

```text
GET /health
```

## Test

```bash
cd backend
.venv/bin/python -m unittest discover -s tests
```
