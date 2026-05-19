"""
Post-hoc multimodal time synchronisation pipeline.

Loads all modality data for a student session, applies clock offsets,
aligns everything to a video frame index, and produces a single
master DataFrame with one row per video frame.

Usage:
    python analysis/multimodal_sync.py <session_id> [db_url]
"""

import os
import sys
import numpy as np
import pandas as pd
import psycopg2


# ─── Database Connection ─────────────────────────────────

def get_connection(db_url: str | None = None):
    """
    Returns a psycopg2 connection.
    db_url format: postgresql://user:password@host:port/dbname
    Falls back to DATABASE_URL environment variable.
    """
    url = db_url or os.environ['DATABASE_URL']
    return psycopg2.connect(url)


# ─── Session Loader ──────────────────────────────────────

class SessionLoader:
    def __init__(self, session_id: str, db_url: str | None = None):
        self.session_id = session_id
        self.db_url = db_url

    def load_all(self) -> dict[str, pd.DataFrame]:
        conn = get_connection(self.db_url)
        try:
            anchor = self._load_sync_anchor(conn)
            session_start_ms = int(anchor['wallClockMs'].iloc[0]) if len(anchor) > 0 else 0

            result = {
                'sync_anchor': anchor,
                'modality_offsets': self._load_modality_offsets(conn),
                'pupil': self._load_with_trel(conn, 'pupil_size_logs', 'timestamp', session_start_ms, is_datetime=True),
                'gaze': self._load_with_trel(conn, 'webgazer_logs', 'timestamp', session_start_ms, is_datetime=True),
                'au': self._load_au_data(conn, session_start_ms),
                'cursor': self._load_with_trel(conn, 'cursor_logs', 'timestamp', session_start_ms, is_bigint=True),
                'scroll': self._load_with_trel(conn, 'scroll_logs', 'timestamp', session_start_ms, is_bigint=True),
                'clicks': self._load_with_trel(conn, 'click_logs', 'timestamp', session_start_ms, is_bigint=True),
                'visibility': self._load_with_trel(conn, 'visibility_logs', 'timestamp', session_start_ms, is_bigint=True),
                'activity': self._load_activity(conn, session_start_ms),
                'interventions': self._load_interventions(conn, session_start_ms),
                'attempts': self._load_attempts(conn, session_start_ms),
                'recording_segments': self._load_recording_segments(conn),
            }
            return result
        finally:
            conn.close()

    def _load_sync_anchor(self, conn) -> pd.DataFrame:
        sql = '''SELECT * FROM session_sync_anchors WHERE "sessionId" = %s'''
        df = pd.read_sql(sql, conn, params=(self.session_id,))
        for col in ['wallClockMs', 'monotonicMs', 'serverReceiveMs']:
            if col in df.columns:
                df[col] = df[col].astype('int64')
        return df

    def _load_modality_offsets(self, conn) -> pd.DataFrame:
        sql = '''SELECT * FROM modality_offsets WHERE "sessionId" = %s'''
        df = pd.read_sql(sql, conn, params=(self.session_id,))
        if 'estimatedAt' in df.columns:
            df['estimatedAt'] = df['estimatedAt'].astype('int64')
        return df

    def _load_with_trel(self, conn, table: str, ts_col: str, session_start_ms: int,
                        is_datetime: bool = False, is_bigint: bool = False) -> pd.DataFrame:
        sql = f'''SELECT * FROM {table} WHERE "sessionId" = %s ORDER BY "{ts_col}"'''
        df = pd.read_sql(sql, conn, params=(self.session_id,))
        if len(df) == 0:
            df['t_ms'] = pd.Series(dtype='int64')
            df['t_rel'] = pd.Series(dtype='int64')
            return df

        if is_datetime:
            df['t_ms'] = (pd.to_datetime(df[ts_col]).astype('int64') // 10**6)
        elif is_bigint:
            df['t_ms'] = df[ts_col].astype('int64')
        else:
            df['t_ms'] = df[ts_col].astype('int64')

        df['t_rel'] = df['t_ms'] - session_start_ms
        return df

    def _load_au_data(self, conn, session_start_ms: int) -> pd.DataFrame:
        sql = '''
            SELECT r.*, j."sessionId", s."startedAt" as segment_start_ms
            FROM pyfeat_au_results r
            JOIN pyfeat_jobs j ON r."jobId" = j.id
            JOIN recording_segments s ON j."segmentId" = s.id
            WHERE j."sessionId" = %s
            ORDER BY r."frameIndex"
        '''
        df = pd.read_sql(sql, conn, params=(self.session_id,))
        if len(df) == 0:
            df['t_ms'] = pd.Series(dtype='int64')
            df['t_rel'] = pd.Series(dtype='int64')
            return df

        # Derive timestamp from segment start + frame index * frame duration
        df['segment_start_epoch'] = pd.to_datetime(df['segment_start_ms']).astype('int64') // 10**6
        fps = 30.0  # default
        df['t_ms'] = (df['segment_start_epoch'] + (df['frameIndex'] * (1000.0 / fps))).astype('int64')
        df['t_rel'] = df['t_ms'] - session_start_ms
        return df

    def _load_activity(self, conn, session_start_ms: int) -> pd.DataFrame:
        sql = '''SELECT * FROM activity_logs WHERE "sessionId" = %s ORDER BY "occurredAt"'''
        df = pd.read_sql(sql, conn, params=(self.session_id,))
        if len(df) == 0:
            df['t_ms'] = pd.Series(dtype='int64')
            df['t_rel'] = pd.Series(dtype='int64')
            return df
        df['t_ms'] = (pd.to_datetime(df['occurredAt']).astype('int64') // 10**6)
        df['t_rel'] = df['t_ms'] - session_start_ms
        return df

    def _load_interventions(self, conn, session_start_ms: int) -> pd.DataFrame:
        sql = '''SELECT * FROM learning_interventions WHERE "sessionId" = %s ORDER BY "createdAt"'''
        df = pd.read_sql(sql, conn, params=(self.session_id,))
        if len(df) == 0:
            df['t_ms'] = pd.Series(dtype='int64')
            df['t_rel'] = pd.Series(dtype='int64')
            return df
        df['t_ms'] = (pd.to_datetime(df['createdAt']).astype('int64') // 10**6)
        df['t_rel'] = df['t_ms'] - session_start_ms
        return df

    def _load_attempts(self, conn, session_start_ms: int) -> pd.DataFrame:
        sql = '''SELECT * FROM attempts WHERE "sessionId" = %s ORDER BY "submittedAt"'''
        df = pd.read_sql(sql, conn, params=(self.session_id,))
        if len(df) == 0:
            df['t_ms'] = pd.Series(dtype='int64')
            df['t_rel'] = pd.Series(dtype='int64')
            return df
        df['t_ms'] = (pd.to_datetime(df['submittedAt']).astype('int64') // 10**6)
        df['t_rel'] = df['t_ms'] - session_start_ms
        return df

    def _load_recording_segments(self, conn) -> pd.DataFrame:
        sql = '''SELECT * FROM recording_segments WHERE "sessionId" = %s ORDER BY "startedAt"'''
        return pd.read_sql(sql, conn, params=(self.session_id,))


# ─── Offset Corrector ────────────────────────────────────

class OffsetCorrector:
    def apply_offsets(
        self,
        df: pd.DataFrame,
        modality_name: str,
        session_id: str,
        offsets_df: pd.DataFrame,
        session_start_ms: int = 0,
    ) -> pd.DataFrame:
        if len(offsets_df) == 0 or 't_ms' not in df.columns or len(df) == 0:
            return df

        match = offsets_df[
            (offsets_df['sessionId'] == session_id) &
            (offsets_df['modality'] == modality_name)
        ]
        if len(match) == 0:
            return df

        offset_ms = int(match.iloc[0]['offsetMs'])
        df = df.copy()
        df['t_ms'] = df['t_ms'] - offset_ms
        df['t_rel'] = df['t_ms'] - session_start_ms
        return df


# ─── Video Frame Index Builder ───────────────────────────

def build_video_frame_index(
    recording_segments_df: pd.DataFrame,
    fps: float = 30.0,
) -> pd.DataFrame:
    """
    Generates one row per video frame across all recording segments.
    Returns DataFrame with columns: frame_id, frame_t_ms, segment_id, segment_index
    """
    rows = []
    for seg_idx, seg in recording_segments_df.iterrows():
        start_ms = int(pd.to_datetime(seg['startedAt']).timestamp() * 1000)
        # Estimate duration from stoppedAt or durationMs
        if pd.notna(seg.get('stoppedAt')):
            end_ms = int(pd.to_datetime(seg['stoppedAt']).timestamp() * 1000)
        elif pd.notna(seg.get('durationMs')):
            end_ms = start_ms + int(seg['durationMs'])
        else:
            continue

        duration_ms = end_ms - start_ms
        num_frames = int(duration_ms * fps / 1000)
        frame_duration_ms = 1000.0 / fps

        for f in range(num_frames):
            frame_t_ms = start_ms + int(f * frame_duration_ms)
            rows.append({
                'frame_id': f'seg{seg_idx}_f{f}',
                'frame_t_ms': frame_t_ms,
                'segment_id': seg.get('id', ''),
                'segment_index': int(seg_idx) if isinstance(seg_idx, (int, np.integer)) else 0,
            })

    if not rows:
        return pd.DataFrame(columns=['frame_id', 'frame_t_ms', 'segment_id', 'segment_index'])

    df = pd.DataFrame(rows)
    df['frame_t_ms'] = df['frame_t_ms'].astype('int64')
    return df


# ─── Alignment Functions ─────────────────────────────────

def align_to_frames(
    frame_index_df: pd.DataFrame,
    modality_df: pd.DataFrame,
    value_cols: list[str],
    method: str = 'nearest',
    tolerance_ms: int = 100,
    window_ms: int = 500,
) -> pd.DataFrame:
    """
    Align modality data to the video frame index.

    Methods:
      - 'nearest': pd.merge_asof with direction='nearest' and tolerance
      - 'interpolate': numpy.interp for continuous signals only.
        WARNING: Do not use for sparse events or categorical data.
      - 'window_mean': for each frame, average modality values within ±window_ms
    """
    if len(modality_df) == 0 or 't_ms' not in modality_df.columns:
        result = frame_index_df.copy()
        for col in value_cols:
            result[col] = np.nan
        return result

    frame_sorted = frame_index_df.sort_values('frame_t_ms').copy()
    mod_sorted = modality_df.sort_values('t_ms').copy()

    if method == 'nearest':
        merged = pd.merge_asof(
            frame_sorted,
            mod_sorted[['t_ms'] + value_cols],
            left_on='frame_t_ms',
            right_on='t_ms',
            direction='nearest',
            tolerance=tolerance_ms,
        )
        return merged.drop(columns=['t_ms'], errors='ignore')

    elif method == 'interpolate':
        result = frame_sorted.copy()
        for col in value_cols:
            valid = mod_sorted[['t_ms', col]].dropna(subset=[col])
            if len(valid) < 2:
                result[col] = np.nan
            else:
                result[col] = np.interp(
                    result['frame_t_ms'].values,
                    valid['t_ms'].values,
                    valid[col].values,
                )
        return result

    elif method == 'window_mean':
        result = frame_sorted.copy()
        for col in value_cols:
            means = []
            mod_times = mod_sorted['t_ms'].values
            mod_vals = mod_sorted[col].values if col in mod_sorted.columns else np.full(len(mod_sorted), np.nan)
            for ft in result['frame_t_ms'].values:
                mask = (mod_times >= ft - window_ms) & (mod_times <= ft + window_ms)
                vals = mod_vals[mask]
                valid = vals[~np.isnan(vals)] if len(vals) > 0 else np.array([])
                means.append(np.mean(valid) if len(valid) > 0 else np.nan)
            result[col] = means
        return result

    else:
        raise ValueError(f'Unknown alignment method: {method}')


# ─── Master Builder ──────────────────────────────────────

def build_aligned_master(
    session_id: str,
    db_url: str | None = None,
    fps: float = 30.0,
    output_dir: str = './exports',
) -> pd.DataFrame:
    """
    Orchestrates the full alignment pipeline for a session.
    Returns a master DataFrame with one row per video frame.
    """
    # 1. Load all data
    loader = SessionLoader(session_id, db_url)
    data = loader.load_all()

    anchor = data['sync_anchor']
    session_start_ms = int(anchor['wallClockMs'].iloc[0]) if len(anchor) > 0 else 0
    offsets_df = data['modality_offsets']
    corrector = OffsetCorrector()

    # 2. Apply offsets
    for modality_name in ['pupil', 'gaze', 'au', 'cursor', 'scroll', 'clicks', 'visibility']:
        data[modality_name] = corrector.apply_offsets(
            data[modality_name], modality_name, session_id, offsets_df, session_start_ms
        )

    # 3. Build video frame index
    frame_index = build_video_frame_index(data['recording_segments'], fps)
    if len(frame_index) == 0:
        return pd.DataFrame()

    # Compute t_rel for frame index
    frame_index['t_rel'] = frame_index['frame_t_ms'] - session_start_ms

    # 4. Align each modality to frames
    master = frame_index.copy()

    # Pupil
    master = align_to_frames(master, data['pupil'], ['pupilDiameter'], method='nearest', tolerance_ms=100)
    master.rename(columns={'pupilDiameter': 'pupil_diameter'}, inplace=True)

    # Gaze
    gaze_cols = ['gazeX', 'gazeY']
    if 'confidence' in data['gaze'].columns:
        gaze_cols.append('confidence')
    master = align_to_frames(master, data['gaze'], gaze_cols, method='nearest', tolerance_ms=50)
    rename_map = {'gazeX': 'gaze_x', 'gazeY': 'gaze_y', 'confidence': 'gaze_confidence'}
    master.rename(columns={k: v for k, v in rename_map.items() if k in master.columns}, inplace=True)
    if 'gaze_confidence' not in master.columns:
        master['gaze_confidence'] = np.nan

    # AUs
    au_cols = [c for c in data['au'].columns if c.startswith('au') and c != 'auResults']
    au_cols_with_face = au_cols + (['faceConf'] if 'faceConf' in data['au'].columns else [])
    if au_cols_with_face:
        master = align_to_frames(master, data['au'], au_cols_with_face, method='nearest', tolerance_ms=34)
    rename_map_au = {'faceConf': 'face_conf'}
    master.rename(columns={k: v for k, v in rename_map_au.items() if k in master.columns}, inplace=True)

    # Cursor
    cursor_cols = ['x', 'y']
    existing_cursor_cols = [c for c in cursor_cols if c in data['cursor'].columns]
    if existing_cursor_cols:
        master = align_to_frames(master, data['cursor'], existing_cursor_cols, method='window_mean', window_ms=500)
        if 'x' in master.columns:
            master['cursor_x'] = master['x'].apply(lambda v: int(v) if pd.notna(v) else None)
            master.drop(columns=['x'], inplace=True)
        if 'y' in master.columns:
            master['cursor_y'] = master['y'].apply(lambda v: int(v) if pd.notna(v) else None)
            master.drop(columns=['y'], inplace=True)
    else:
        master['cursor_x'] = None
        master['cursor_y'] = None

    # Scroll
    if 'scrollPercent' in data['scroll'].columns:
        master = align_to_frames(master, data['scroll'], ['scrollPercent'], method='nearest', tolerance_ms=200)
        master.rename(columns={'scrollPercent': 'scroll_percent'}, inplace=True)
    else:
        master['scroll_percent'] = np.nan

    # Interventions
    if 'type' in data['interventions'].columns:
        master = align_to_frames(master, data['interventions'], ['type'], method='nearest', tolerance_ms=5000)
        master.rename(columns={'type': 'intervention_type'}, inplace=True)
    else:
        master['intervention_type'] = None

    # Activity
    if 'action' in data['activity'].columns:
        master = align_to_frames(master, data['activity'], ['action'], method='nearest', tolerance_ms=5000)
        master.rename(columns={'action': 'activity_action'}, inplace=True)
    else:
        master['activity_action'] = None

    # Attempts
    if 'score' in data['attempts'].columns:
        master = align_to_frames(master, data['attempts'], ['score'], method='nearest', tolerance_ms=10000)
        master.rename(columns={'score': 'attempt_score'}, inplace=True)
    else:
        master['attempt_score'] = np.nan

    # Visibility — nearest then forward-fill
    if 'visibleState' in data['visibility'].columns:
        master = align_to_frames(master, data['visibility'], ['visibleState'], method='nearest', tolerance_ms=60000)
        master['is_tab_visible'] = master['visibleState'].apply(
            lambda v: v != 'hidden' if pd.notna(v) else True
        )
        master.drop(columns=['visibleState'], errors='ignore', inplace=True)
        master['is_tab_visible'] = master['is_tab_visible'].ffill().fillna(True)
    else:
        master['is_tab_visible'] = True

    # Save output
    out_path = os.path.join(output_dir, session_id)
    os.makedirs(out_path, exist_ok=True)
    csv_path = os.path.join(out_path, 'aligned_master.csv')
    master.to_csv(csv_path, index=False)

    return master


# ─── Query Functions ─────────────────────────────────────

def get_clip_data(master_df: pd.DataFrame, start_ms: int, end_ms: int) -> pd.DataFrame:
    """Slice master for a time window (absolute Unix ms)."""
    return master_df[
        (master_df['frame_t_ms'] >= start_ms) &
        (master_df['frame_t_ms'] <= end_ms)
    ].copy()


def find_au_spikes(
    master_df: pd.DataFrame,
    au_col: str,
    threshold: float = 2.0,
    min_duration_frames: int = 3,
) -> pd.DataFrame:
    """Frames where AU column exceeds threshold for >= min_duration_frames consecutive frames."""
    if au_col not in master_df.columns:
        return pd.DataFrame()

    above = master_df[au_col].fillna(0) > threshold
    groups = above.ne(above.shift()).cumsum()
    streaks = master_df[above].groupby(groups[above])

    result_frames = []
    for _, group in streaks:
        if len(group) >= min_duration_frames:
            result_frames.append(group)

    if not result_frames:
        return pd.DataFrame()
    return pd.concat(result_frames)


def compare_before_after_intervention(
    master_df: pd.DataFrame,
    intervention_t_ms: int,
    window_ms: int = 30000,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Returns (before_df, after_df) windows around an intervention timestamp."""
    before = master_df[
        (master_df['frame_t_ms'] >= intervention_t_ms - window_ms) &
        (master_df['frame_t_ms'] < intervention_t_ms)
    ].copy()
    after = master_df[
        (master_df['frame_t_ms'] >= intervention_t_ms) &
        (master_df['frame_t_ms'] <= intervention_t_ms + window_ms)
    ].copy()
    return before, after


def find_recording_gaps(recording_segments_df: pd.DataFrame) -> list[dict]:
    """Returns list of {start_ms, end_ms, gap_duration_ms} for gaps between segments."""
    if len(recording_segments_df) < 2:
        return []

    gaps = []
    sorted_segs = recording_segments_df.sort_values('startedAt').reset_index(drop=True)

    for i in range(1, len(sorted_segs)):
        prev = sorted_segs.iloc[i - 1]
        curr = sorted_segs.iloc[i]

        if pd.notna(prev.get('stoppedAt')):
            prev_end = int(pd.to_datetime(prev['stoppedAt']).timestamp() * 1000)
        elif pd.notna(prev.get('durationMs')):
            prev_start = int(pd.to_datetime(prev['startedAt']).timestamp() * 1000)
            prev_end = prev_start + int(prev['durationMs'])
        else:
            continue

        curr_start = int(pd.to_datetime(curr['startedAt']).timestamp() * 1000)
        gap = curr_start - prev_end

        if gap > 0:
            gaps.append({
                'start_ms': prev_end,
                'end_ms': curr_start,
                'gap_duration_ms': gap,
            })

    return gaps


# ─── Main ────────────────────────────────────────────────

if __name__ == '__main__':
    session_id = sys.argv[1]
    db_url = sys.argv[2] if len(sys.argv) > 2 else None
    master = build_aligned_master(session_id, db_url)
    print(f"Master DataFrame shape: {master.shape}")
    print(master.head(10).to_string())
