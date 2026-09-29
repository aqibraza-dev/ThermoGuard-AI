#!/bin/bash
echo "Starting FireSight Analytics..."

# Start Backend
echo "Setting up backend..."
cd backend
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi
source venv/bin/activate
pip install -r requirements.txt
echo "Starting FastAPI server on port 8000..."
uvicorn main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

# Start Frontend
echo "Setting up frontend..."
cd ../frontend
npm install
echo "Starting Vite dev server..."
npm run dev -- --port 5173 &
FRONTEND_PID=$!

echo "Both servers are running."
echo "Backend: http://localhost:8000"
echo "Frontend: http://localhost:5173"
echo "Press Ctrl+C to stop both."

trap "kill $BACKEND_PID $FRONTEND_PID; exit" INT TERM
wait
