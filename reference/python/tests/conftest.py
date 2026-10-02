import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PY = os.path.abspath(os.path.join(HERE, ".."))
sys.path.insert(0, PY)
sys.path.insert(0, os.path.join(PY, "kairos-replay"))
