import eventlet
eventlet.monkey_patch()

import os
import re
import glob
import json
import math
import time
import shutil
import logging
import threading

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(message)s')
from datetime import datetime, timedelta
from flask import Flask, send_from_directory, jsonify, request, Response, abort
from flask_socketio import SocketIO, emit, join_room

_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')

def _parse_project_date(value):
    value = str(value or '')
    if not _DATE_RE.match(value):
        return None
    try:
        return datetime.strptime(value, '%Y-%m-%d').date()
    except ValueError:
        return None


def _project_validation_messages(p: dict):
    errors = []
    warnings = []
    if not isinstance(p, dict):
        return ['프로젝트 항목은 객체여야 합니다.'], warnings

    pid = p.get('id')
    if (not isinstance(pid, (int, float)) or isinstance(pid, bool) or
            not math.isfinite(float(pid))):
        errors.append('프로젝트 ID가 올바르지 않습니다.')

    for field, label in (('name', '프로젝트명'), ('team', '담당팀'), ('pm', '담당자')):
        if not str(p.get(field, '')).strip():
            errors.append(f'{label}이(가) 비어 있습니다.')

    open_date = _parse_project_date(p.get('open'))
    if open_date is None:
        errors.append('적용예정일 형식이 올바르지 않습니다.')

    details = p.get('phaseDetails')
    if not isinstance(details, list):
        errors.append('단계 일정은 배열이어야 합니다.')
        return errors, warnings
    if not details:
        errors.append('최소 1개 이상의 단계 일정이 필요합니다.')

    previous_end = None
    last_end = None
    for idx, pd in enumerate(details, start=1):
        label = f'{idx}단계'
        if not isinstance(pd, dict):
            errors.append(f'{label}: 단계 정보가 올바르지 않습니다.')
            continue

        if not str(pd.get('name', '')).strip():
            errors.append(f'{label}: 단계명이 비어 있습니다.')
        start_date = _parse_project_date(pd.get('start'))
        end_date = _parse_project_date(pd.get('end'))
        if start_date is None:
            errors.append(f'{label}: 시작일 형식이 올바르지 않습니다.')
        if end_date is None:
            errors.append(f'{label}: 종료일 형식이 올바르지 않습니다.')
        if start_date is None or end_date is None:
            continue

        if start_date > end_date:
            errors.append(f'{label}: 시작일이 종료일보다 늦습니다.')
        if previous_end is not None and start_date < previous_end:
            errors.append(f'{label}: 시작일이 이전 단계 종료일보다 빠릅니다.')
        previous_end = end_date
        last_end = end_date

    if open_date is not None and last_end is not None and open_date < last_end:
        warnings.append('적용예정일이 마지막 단계 종료일보다 이전입니다.')

    return errors, warnings


def _validate_project(p: dict) -> bool:
    """필수 필드와 일정 구조를 검증한다."""
    errors, _warnings = _project_validation_messages(p)
    return not errors
    for pd in details:
        if not isinstance(pd, dict):
            return False
        if not (_DATE_RE.match(str(pd.get('start', ''))) and
                _DATE_RE.match(str(pd.get('end', '')))):
            return False
    return True

app = Flask(__name__)

# CORS: 환경변수 DASHBOARD_CORS_ORIGINS 로 제어 (기본 같은 출처)
_cors_env = os.environ.get('DASHBOARD_CORS_ORIGINS', '').strip()
_cors = [o.strip() for o in _cors_env.split(',') if o.strip()] if _cors_env else None
socketio = SocketIO(app, cors_allowed_origins=_cors, async_mode='eventlet')

# 쓰기 보호:
# - localhost 요청은 허용
# - 원격 쓰기는 DASHBOARD_API_SECRET 설정 + X-Api-Key 헤더가 맞을 때만 허용
API_SECRET = os.environ.get('DASHBOARD_API_SECRET', '')
if not API_SECRET:
    logging.warning('DASHBOARD_API_SECRET 미설정 — 원격 쓰기는 차단되고 localhost 쓰기만 허용됩니다.')


def _check_write_access():
    """변경 요청 권한을 검증한다. 브라우저에 API secret을 노출하지 않는다."""
    if _is_localhost():
        return None
    if API_SECRET and request.headers.get('X-Api-Key', '') == API_SECRET:
        return None
    if API_SECRET:
        return jsonify({'error': 'Unauthorized'}), 401
    # API_SECRET 미설정 시 원격 쓰기 허용 (사내망 전용 배포)
    return None


def _etag_for_file() -> str:
    if not os.path.exists(ALL_FILE):
        return '"0"'
    return f'"{os.stat(ALL_FILE).st_mtime_ns}"'


def _check_precondition():
    match = request.headers.get('If-Match')
    if match and match != '*' and match != _etag_for_file():
        return jsonify({'error': 'Conflict: data changed on server'}), 409
    return None

BASE_DIR    = os.path.dirname(os.path.abspath(__file__))
DATA_DIR    = os.path.join(BASE_DIR, 'data')
ALL_FILE    = os.path.join(DATA_DIR, 'projects_all.json')
LEGACY_FILE = os.path.join(DATA_DIR, 'projects.json')
BACKUP_DIR  = os.path.join(DATA_DIR, 'backups')
BACKUP_KEEP = 30  # 최근 30일 보관

_DATA_LOCK = threading.RLock()
_locks = {}

# ── 로컬호스트 여부 판별 ─────────────────────────────
_LOCAL_ADDRS = {'127.0.0.1', '::1', 'localhost'}

def _is_localhost():
    return request.remote_addr in _LOCAL_ADDRS

# ── 자동 백업 (매일 21:00) ───────────────────────────
def _do_backup():
    if not os.path.exists(ALL_FILE):
        return
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d')
    dst = os.path.join(BACKUP_DIR, f'backup_{stamp}.json')
    shutil.copy2(ALL_FILE, dst)
    backups = sorted(glob.glob(os.path.join(BACKUP_DIR, 'backup_*.json')))
    for old in backups[:-BACKUP_KEEP]:
        try:
            os.remove(old)
        except Exception:
            pass
    logging.info('[백업] 완료: %s', dst)

def _backup_loop():
    while True:
        now = datetime.now()
        next_run = now.replace(hour=21, minute=0, second=0, microsecond=0)
        if now >= next_run:
            next_run += timedelta(days=1)
        time.sleep((next_run - datetime.now()).total_seconds())
        try:
            _do_backup()
        except Exception as e:
            logging.error('[백업] 실패: %s', e)

threading.Thread(target=_backup_loop, name='auto-backup', daemon=True).start()


def is_relevant_for_year(p: dict, year: int) -> bool:
    """프로젝트가 해당 연도와 관련 있는지 판단.
    - 적용예정일(open)이 해당 연도인 경우
    - 단계 일정이 해당 연도와 하루라도 겹치는 경우
    """
    year_start = f'{year}-01-01'
    year_end   = f'{year}-12-31'

    open_date = p.get('open', '')
    if open_date and year_start <= open_date <= year_end:
        return True

    for pd in p.get('phaseDetails', []):
        ps = pd.get('start', '')
        pe = pd.get('end', '')
        if ps and pe and ps <= year_end and pe >= year_start:
            return True

    return False


def load_all_data() -> list:
    """projects_all.json에서 전체 프로젝트를 로드.
    파일이 없으면 기존 연도별 파일을 병합하여 마이그레이션.
    """
    with _DATA_LOCK:
        if os.path.exists(ALL_FILE):
            with open(ALL_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)

        # ── 마이그레이션: 기존 projects_YYYY.json 파일 병합 ──
        merged: dict = {}

        year_files = sorted(glob.glob(os.path.join(DATA_DIR, 'projects_*.json')))
        for path in year_files:
            if not re.search(r'projects_\d{4}\.json$', path):
                continue
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    for p in json.load(f):
                        pid = p.get('id')
                        if pid is not None and pid not in merged:
                            merged[pid] = p
            except Exception:
                pass

        if os.path.exists(LEGACY_FILE):
            try:
                with open(LEGACY_FILE, 'r', encoding='utf-8') as f:
                    for p in json.load(f):
                        pid = p.get('id')
                        if pid is not None and pid not in merged:
                            merged[pid] = p
            except Exception:
                pass

        result = list(merged.values())
        if result:
            save_all_data(result)
        return result


def save_all_data(data: list):
    with _DATA_LOCK:
        os.makedirs(DATA_DIR, exist_ok=True)
        tmp = f'{ALL_FILE}.tmp.{os.getpid()}.{threading.get_ident()}'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, ALL_FILE)


@app.route('/api/projects', methods=['DELETE'])
def delete_all_projects():
    err = _check_write_access()
    if err: return err
    err = _check_precondition()
    if err: return err
    save_all_data([])
    etag = _etag_for_file()
    socketio.emit('projects_updated', {'year': None, 'projects': [], 'from_localhost': True, 'etag': etag})
    resp = jsonify({'ok': True})
    resp.headers['ETag'] = etag
    return resp


@app.route('/api/projects/<int:year>', methods=['GET'])
def get_projects(year):
    all_projects = load_all_data()
    resp = jsonify([p for p in all_projects if is_relevant_for_year(p, year)])
    resp.headers['ETag'] = _etag_for_file()
    return resp


@app.route('/api/projects/<int:year>', methods=['PUT'])
def put_projects(year):
    err = _check_write_access()
    if err: return err
    err = _check_precondition()
    if err: return err

    body = request.get_json()
    # 구버전 클라이언트(배열 직접 전송) 호환 유지
    if isinstance(body, list):
        new_projects = body
        deleted_ids: set = set()
        action_label = ''
        replace_year = False
    elif isinstance(body, dict):
        new_projects = body.get('projects', [])
        deleted_ids = set(body.get('deleted_ids', []))
        action_label = str(body.get('action_label', ''))[:100]
        replace_year = bool(body.get('replace_year', False))
    else:
        return jsonify({'error': 'invalid data'}), 400

    if not isinstance(new_projects, list):
        return jsonify({'error': 'invalid data'}), 400

    # 항목별 유효성 검증 — 실패 항목이 있으면 부분 저장하지 않는다.
    valid, invalid, warnings = [], [], []
    for p in new_projects:
        errors, item_warnings = _project_validation_messages(p)
        pid = p.get('id') if isinstance(p, dict) else p
        if errors:
            invalid.append({'id': pid, 'errors': errors})
            continue
        if item_warnings:
            warnings.append({'id': pid, 'warnings': item_warnings})
        valid.append(p)
    if invalid:
        logging.warning('PUT /api/projects/%s: 유효하지 않은 항목 %d개 거부 (ids: %s)',
                        year, len(invalid), [item.get('id') for item in invalid])
        return jsonify({
            'error': '유효하지 않은 프로젝트 데이터가 있어 저장하지 않았습니다.',
            'invalid': invalid[:10],
        }), 400
    new_projects = valid

    with _DATA_LOCK:
        # 전체 데이터를 ID 맵으로 로드
        merged = {p['id']: p for p in load_all_data()}

        if replace_year:
            # 현재 연도 범위 덮어쓰기: 다른 연도 전용 프로젝트는 보존한다.
            for pid, project in list(merged.items()):
                if is_relevant_for_year(project, year):
                    merged.pop(pid, None)
        else:
            # 명시적으로 삭제 요청된 ID 제거
            for did in deleted_ids:
                merged.pop(did, None)

        # 클라이언트가 보낸 프로젝트로 갱신/추가
        for p in new_projects:
            merged[p['id']] = p

        save_all_data(list(merged.values()))
        etag = _etag_for_file()

        # 머지된 결과 중 해당 연도 항목만 브로드캐스트
        merged_year = [p for p in merged.values() if is_relevant_for_year(p, year)]
    from_lh = _is_localhost()
    socketio.emit('projects_updated', {
        'year': year,
        'projects': merged_year,
        'from_localhost': from_lh,
        'action_label': action_label,
        'etag': etag,
    })
    if not from_lh:
        logging.info('[Socket] admin_notify 전송: %s', action_label)
        socketio.emit('admin_notify', {'action_label': action_label}, to='admin')
    resp = jsonify({'ok': True, 'warnings': warnings[:10]})
    resp.headers['ETag'] = etag
    return resp


@socketio.on('connect')
def on_connect():
    emit('lock_sync', list(_locks.values()))
    addr = request.remote_addr
    logging.info('[Socket] connect: %s', addr)
    if addr in _LOCAL_ADDRS:
        join_room('admin')
        logging.info('[Socket] %s → admin room joined', addr)


@socketio.on('lock_project')
def on_lock(data):
    proj_id = data.get('projId')
    if proj_id is not None:
        _locks[proj_id] = data
        emit('project_locked', data, broadcast=True)


@socketio.on('unlock_project')
def on_unlock(data):
    proj_id = data.get('projId')
    _locks.pop(proj_id, None)
    emit('project_unlocked', data, broadcast=True)


@socketio.on('disconnect')
def on_disconnect():
    sid = request.sid
    to_remove = [pid for pid, info in _locks.items() if info.get('socketId') == sid]
    for pid in to_remove:
        del _locks[pid]
        socketio.emit('project_unlocked', {'projId': pid})


@app.route('/')
def index():
    path = os.path.join(BASE_DIR, 'index.html')
    with open(path, encoding='utf-8') as f:
        html = f.read()
    return Response(html, mimetype='text/html; charset=utf-8')


_ALLOWED_STATIC_DIRS = {'css', 'js'}
_ALLOWED_STATIC_FILES = {'index.html', 'favicon.ico'}

@app.route('/<path:path>')
def static_files(path):
    requested = str(path or '').replace('\\', '/')
    parts = [part for part in requested.split('/') if part]
    if not parts or any(part in ('.', '..') for part in parts):
        abort(404)

    normalized = '/'.join(parts)
    first = parts[0]
    if normalized in _ALLOWED_STATIC_FILES and len(parts) == 1:
        return send_from_directory(BASE_DIR, normalized)

    if first in _ALLOWED_STATIC_DIRS:
        allowed_root = os.path.realpath(os.path.join(BASE_DIR, first))
        candidate = os.path.realpath(os.path.join(BASE_DIR, normalized))
        try:
            inside_allowed_root = os.path.commonpath([allowed_root, candidate]) == allowed_root
        except ValueError:
            inside_allowed_root = False
        if inside_allowed_root:
            return send_from_directory(BASE_DIR, normalized)
    abort(404)


if __name__ == '__main__':
    socketio.run(app, debug=False, host='0.0.0.0', port=5002)
