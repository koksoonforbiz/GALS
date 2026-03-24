# Prompt 05 — Python Post-Hoc Multimodal Time Synchronisation Pipeline

## Stack Context

- **Python**: 3.10+
- **Database**: PostgreSQL — connect using `psycopg2-binary` directly (NOT sqlalchemy)
- **DataFrame loading**: `pandas.read_sql(query, conn)` with a `psycopg2` connection
- **Object storage**: `minio` Python SDK (NOT boto3, NOT pyarrow S3)
- **DO NOT install or import**: `sqlalchemy`, `pyarrow`
- **Parquet**: use `fastparquet` if Parquet output is needed; otherwise default to CSV
- All code lives in the `analysis/` directory

---

## Task

Create `analysis/multimodal_sync.py` with the following full implementation.

---

## Database Connection Helper

```python
import psycopg2
import pandas as pd
import os

def get_connection(db_url: str | None = None):
    """
    Returns a psycopg2 connection.
    db_url format: postgresql://user:password@host:port/dbname
    Falls back to DATABASE_URL environment variable.
    """
    url = db_url or os.environ['DATABASE_URL']
    return psycopg2.connect(url)
```

Use `pd.read_sql(query, conn)` throughout — pass the psycopg2 connection object directly.

---

## CLASS: `SessionLoader`

```python
class SessionLoader:
    def __init__(self, session_id: str, db_url: str | None = None): ...
    def load_all(self) -> dict[str, pd.DataFrame]: ...
```

`load_all()` returns a dict keyed by modality name:
`'pupil'`, `'gaze'`, `'au'`, `'cursor'`, `'scroll'`, `'clicks'`,
`'visibility'`, `'activity'`, `'interventions'`, `'attempts'`,
`'recording_segments'`, `'sync_anchor'`, `'modality_offsets'`

Rules:
- Every DataFrame (except `sync_anchor` and `modality_offsets`) must have:
  - `t_ms`: raw Unix millisecond timestamp (cast BigInt → int64)
  - `t_rel`: milliseconds since session start from `session_sync_anchors.wallClockMs`
- Use `pd.read_sql(sql_string, conn)` with a psycopg2 connection for all queries
- AU data: JOIN `pyfeat_au_results → pyfeat_jobs → recording_segments` to derive
  `timestamp = segment."startedAt" + (frame_index * (1000.0 / fps))`
- Cast all BigInt columns to Python int64 after loading (Prisma BigInt comes back
  as `Decimal` from psycopg2 — use `.astype('int64')`)

---

## CLASS: `OffsetCorrector`

```python
class OffsetCorrector:
    def apply_offsets(
        self,
        df: pd.DataFrame,
        modality_name: str,
        session_id: str,
        offsets_df: pd.DataFrame
    ) -> pd.DataFrame:
```

- Looks up `offsetMs` in `offsets_df` for this `session_id` + `modality_name`
- Shifts `t_ms` by `-offsetMs`
- Recomputes `t_rel = t_ms - session_start_ms`
- Returns corrected DataFrame; returns original unchanged if no offset found

---

## FUNCTION: `build_video_frame_index`

```python
def build_video_frame_index(
    recording_segments_df: pd.DataFrame,
    fps: float = 30.0
) -> pd.DataFrame:
```

Returns DataFrame columns: `frame_id` (str, format `seg{segIdx}_f{N}`),
`frame_t_ms` (int64), `segment_id` (str), `segment_index` (int)

Generates one row per video frame across all segments.
Handles gaps between segments — frames only within each segment's duration.

---

## FUNCTION: `align_to_frames`

```python
def align_to_frames(
    frame_index_df: pd.DataFrame,
    modality_df: pd.DataFrame,
    value_cols: list[str],
    method: str = 'nearest',     # 'nearest' | 'interpolate' | 'window_mean'
    tolerance_ms: int = 100,
    window_ms: int = 500
) -> pd.DataFrame:
```

- `nearest`: `pd.merge_asof(direction='nearest', tolerance=tolerance_ms)`
  on `frame_t_ms` ← `t_ms`
- `interpolate`: `numpy.interp` — only for continuous signals (pupil, gaze).
  Add docstring warning: "Do not use for sparse events or categorical data."
- `window_mean`: for each frame, average modality values within ±`window_ms`
- Returns `frame_index_df` with `value_cols` appended

---

## FUNCTION: `build_aligned_master`

```python
def build_aligned_master(
    session_id: str,
    db_url: str | None = None,
    fps: float = 30.0,
    output_dir: str = './exports'
) -> pd.DataFrame:
```

Orchestration steps:
1. `SessionLoader(session_id, db_url).load_all()`
2. `OffsetCorrector().apply_offsets()` for each modality
3. `build_video_frame_index()` from recording_segments
4. `align_to_frames()` for each modality:
   - pupil → `nearest`, 100ms tolerance
   - gaze → `nearest`, 50ms tolerance
   - AUs → `nearest`, 34ms tolerance
   - cursor → `window_mean`, 500ms window
   - scroll → `nearest`, 200ms tolerance
   - interventions → `nearest`, 5000ms tolerance
   - activity → `nearest`, 5000ms tolerance
   - attempts → `nearest`, 10000ms tolerance
   - visibility → `nearest` then forward-fill `is_tab_visible`

Returns master DataFrame columns:
`frame_id`, `frame_t_ms`, `t_rel`,
`pupil_diameter`, `gaze_x`, `gaze_y`, `gaze_confidence`,
`au01`–`au28`, `face_conf`,
`cursor_x`, `cursor_y`, `scroll_percent`,
`intervention_type`, `activity_action`, `attempt_score`, `is_tab_visible`

Also saves output to `{output_dir}/{session_id}/aligned_master.csv` (CSV, not Parquet,
since pyarrow is not available).

---

## QUERY FUNCTIONS

```python
def get_clip_data(master_df: pd.DataFrame, start_ms: int, end_ms: int) -> pd.DataFrame:
    """Slice master for a time window (absolute Unix ms)."""

def find_au_spikes(
    master_df: pd.DataFrame,
    au_col: str,
    threshold: float = 2.0,
    min_duration_frames: int = 3
) -> pd.DataFrame:
    """Frames where AU column exceeds threshold for >= min_duration_frames consecutive frames."""

def compare_before_after_intervention(
    master_df: pd.DataFrame,
    intervention_t_ms: int,
    window_ms: int = 30000
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Returns (before_df, after_df) windows around an intervention timestamp."""

def find_recording_gaps(recording_segments_df: pd.DataFrame) -> list[dict]:
    """Returns list of {start_ms, end_ms, gap_duration_ms} for gaps between segments."""
```

---

## `__main__` Block

```python
if __name__ == '__main__':
    import sys
    session_id = sys.argv[1]
    db_url = sys.argv[2] if len(sys.argv) > 2 else None
    master = build_aligned_master(session_id, db_url)
    print(f"Master DataFrame shape: {master.shape}")
    print(master.head(10).to_string())
```

---

## `analysis/requirements-analysis.txt`

```
pandas>=2.0
psycopg2-binary>=2.9
numpy>=1.24
scipy>=1.10
minio>=7.2
redis>=4.6
fastparquet>=2023.10
tqdm>=4.66
orjson>=3.9
```
