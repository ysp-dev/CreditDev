// 08:00~20:00, 30분 단위 서버 데이터 자동 갱신
const REFRESH_START_HOUR = 8,  REFRESH_START_MIN = 0;
const REFRESH_END_HOUR   = 20, REFRESH_END_MIN   = 0;
const REFRESH_INTERVAL_MS = 30 * 60 * 1000;

let _periodicTimer = null;
let _periodicCountdownInterval = null;

function _getNextRefreshTime() {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayStart = new Date(midnight); todayStart.setHours(REFRESH_START_HOUR, REFRESH_START_MIN, 0, 0);
    const todayEnd   = new Date(midnight); todayEnd.setHours(REFRESH_END_HOUR, REFRESH_END_MIN, 0, 0);
    if (now < todayStart) return new Date(todayStart);
    if (now.getTime() === todayEnd.getTime()) return new Date(todayEnd);
    if (now > todayEnd) {
        const tmr = new Date(midnight); tmr.setDate(tmr.getDate() + 1); tmr.setHours(REFRESH_START_HOUR, REFRESH_START_MIN, 0, 0);
        return tmr;
    }
    const elapsed = now.getTime() - midnight.getTime();
    const nextCount = Math.ceil((elapsed + 1) / REFRESH_INTERVAL_MS);
    const next = new Date(midnight.getTime() + nextCount * REFRESH_INTERVAL_MS);
    if (next > todayEnd) {
        const tmr = new Date(midnight); tmr.setDate(tmr.getDate() + 1); tmr.setHours(REFRESH_START_HOUR, REFRESH_START_MIN, 0, 0);
        return tmr;
    }
    return next;
}

function _updatePeriodicCountdown() {
    const el = document.getElementById('io-idle-countdown');
    if (!el) return;
    if (AppState.currentScreen === 'admin') { el.style.display = 'none'; return; }
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayStart = new Date(midnight); todayStart.setHours(REFRESH_START_HOUR, REFRESH_START_MIN, 0, 0);
    const todayEnd   = new Date(midnight); todayEnd.setHours(REFRESH_END_HOUR, REFRESH_END_MIN, 0, 0);
    el.style.display = '';
    el.dataset.source = 'periodic';
    if (now >= todayEnd) {
        el.textContent = `· 새로고침 다음 날 ${REFRESH_START_HOUR}시`;
    } else if (now < todayStart) {
        el.textContent = `· 새로고침 오늘 ${REFRESH_START_HOUR}시`;
    } else {
        const next = _getNextRefreshTime();
        const diffMin = Math.ceil((next.getTime() - Date.now()) / 60000);
        el.textContent = `· 새로고침 ${Math.max(1, diffMin)}분 전`;
    }
}

function _startPeriodicRefresh() {
    function schedule() {
        const next = _getNextRefreshTime();
        _periodicTimer = setTimeout(async () => {
            if (AppState.currentScreen !== 'admin') {
                AppState.projects = await loadFromStorage();
                renderDashboard();
            }
            _updatePeriodicCountdown();
            schedule();
        }, Math.max(0, next.getTime() - Date.now()));
    }
    _updatePeriodicCountdown();
    clearInterval(_periodicCountdownInterval);
    _periodicCountdownInterval = setInterval(_updatePeriodicCountdown, 60000);
    schedule();
}

// 화면 보호기 방지 (Wake Lock + Canvas video 이중 방어)
(function () {
    let _wl = null;
    let _wlPending = null;
    let _retryTimer = null;
    let _heartbeat = null;
    let _fbVideo = null;
    let _fbCanvas = null;
    let _fbCtx = null;
    let _fbFrameTimer = null;
    let _fbPlayTimer = null;
    let _fbUnsupported = false;
    let _started = false;

    function _isVisible() {
        return document.visibilityState === 'visible' && !document.hidden;
    }

    function _scheduleAcquire(delay) {
        clearTimeout(_retryTimer);
        if (!_isVisible()) return;
        _retryTimer = setTimeout(_acquire, delay);
    }

    function _playFallbackVideo() {
        if (!_fbVideo || !_isVisible()) return;
        clearTimeout(_fbPlayTimer);
        const playPromise = _fbVideo.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {
                clearTimeout(_fbPlayTimer);
                _fbPlayTimer = setTimeout(_playFallbackVideo, 30000);
            });
        }
    }

    // Wake Lock 미지원 또는 실패 시: 1px canvas 스트림 video 재생으로 화면 활성 유지
    function _ensureFallbackVideo() {
        if (_fbUnsupported) return;
        if (!_fbVideo) {
            _fbCanvas = document.createElement('canvas');
            _fbCanvas.width = 2; _fbCanvas.height = 2;
            _fbCtx = _fbCanvas.getContext('2d');
            if (!_fbCanvas.captureStream || !_fbCtx) {
                _fbUnsupported = true;
                return;
            }

            _fbVideo = document.createElement('video');
            _fbVideo.srcObject = _fbCanvas.captureStream(1);
            _fbVideo.muted = true;
            _fbVideo.autoplay = true;
            _fbVideo.loop = true;
            _fbVideo.setAttribute('playsinline', '');
            _fbVideo.setAttribute('aria-hidden', 'true');
            _fbVideo.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0.001;pointer-events:none;top:0;left:0;z-index:-1;';
            document.body.appendChild(_fbVideo);
            _fbVideo.addEventListener('pause', _playFallbackVideo);
            _fbVideo.addEventListener('ended', _playFallbackVideo);
        }

        if (!_fbFrameTimer) {
            let tick = 0;
            const drawFrame = () => {
                tick = (tick + 1) % 255;
                _fbCtx.fillStyle = `rgb(${tick},${255 - tick},${tick % 2 ? 32 : 64})`;
                _fbCtx.fillRect(0, 0, 2, 2);
            };
            drawFrame();
            _fbFrameTimer = setInterval(drawFrame, 1000);
        }
        _playFallbackVideo();
    }

    async function _acquire() {
        clearTimeout(_retryTimer);
        if (!_isVisible()) return;
        _ensureFallbackVideo();
        if (!('wakeLock' in navigator)) return;
        if (_wl || _wlPending) return;
        try {
            _wlPending = navigator.wakeLock.request('screen');
            const sentinel = await _wlPending;
            _wl = sentinel;
            sentinel.addEventListener('release', () => {
                if (_wl === sentinel) _wl = null;
                // 예기치 않은 해제(리로드 직후 포함) 시 5초 후 재시도
                _scheduleAcquire(5000);
            });
        } catch (e) {
            // 획득 실패 시 fallback은 유지하고 30초 후 재시도
            _scheduleAcquire(30000);
        } finally {
            _wlPending = null;
        }
    }

    // 탭 복귀 시 즉시 재획득
    document.addEventListener('visibilitychange', () => {
        if (_isVisible()) {
            _ensureFallbackVideo();
            _acquire();
        }
    });
    ['pointerdown', 'keydown', 'touchstart'].forEach(eventName => {
        document.addEventListener(eventName, () => {
            if (!_wl) { _ensureFallbackVideo(); _acquire(); }
        }, { passive: true });
    });

    window._startWakeLock = function () {
        if (_started) return;
        _started = true;
        _ensureFallbackVideo();
        _acquire();
        // 30초마다 상태 점검 — 조용히 해제된 경우 복구
        _heartbeat = setInterval(() => {
            if (!_isVisible()) return;
            if (_fbVideo?.paused) _playFallbackVideo();
            if (!_wl) _acquire();
        }, 30000);
    };

    window._wakeLockDebug = function () {
        return {
            visible: _isVisible(),
            wakeLockActive: !!_wl,
            wakeLockPending: !!_wlPending,
            fallbackVideoReady: !!_fbVideo,
            fallbackVideoPaused: _fbVideo ? _fbVideo.paused : null,
            fallbackUnsupported: _fbUnsupported,
            retryScheduled: !!_retryTimer,
            heartbeatStarted: !!_heartbeat
        };
    };
})();

function switchView(view, isEdit = false) {
    if (view === 'dashboard' && AppState.formDirty) {
        if (!confirm('입력 중인 내용이 있습니다.\n대시보드로 이동하면 변경 사항이 사라집니다.\n계속하시겠습니까?')) return;
    }
    AppState.formDirty = false;
    if(view === 'dashboard') {
        AppState.currentScreen = 'dashboard';
        const dv = document.getElementById('dashboardView');
        dv.style.display = 'block';
        dv.classList.remove('view-fade'); void dv.offsetWidth; dv.classList.add('view-fade');
        document.getElementById('adminView').style.display = 'none';
        document.getElementById('tabDash').classList.add('active');
        document.getElementById('tabAdmin').classList.remove('active');
        AppState.currentFilter = '전체';
        AppState.currentSearch = '';
        const si = document.getElementById('search-input'); if (si) si.value = '';
        _updatePeriodicCountdown();
        renderDashboard();
    } else {
        AppState.currentScreen = 'admin';
        document.getElementById('dashboardView').style.display = 'none';
        const av = document.getElementById('adminView');
        av.style.display = 'block';
        av.classList.remove('view-fade'); void av.offsetWidth; av.classList.add('view-fade');
        setTimeout(initBulkColResize, 50);
        document.getElementById('tabDash').classList.remove('active');
        document.getElementById('tabAdmin').classList.add('active');
        window.scrollTo({ top: 0, behavior: 'instant' });
        
        if (!isEdit) {
            AppState.editingProjectId = null;
            // 단계 입력 영역 완전히 비우고 재생성 → 잔여값 없이 깨끗하게 초기화
            document.getElementById('phase-inputs-container').innerHTML = '';
        }
        initPhaseInputs();
        initTagInput();

        if (!isEdit) {
            resetForm(true);
            document.getElementById('in-open').value = '';
            document.getElementById('form-title').innerText = "신규 프로젝트 등록";
            document.getElementById('btn-submit').innerText = "등록 및 로드맵 반영";
            document.getElementById('btn-delete').style.display = 'none';
            document.getElementById('btn-top-sep').classList.remove('visible');
            document.getElementById('btn-top-reset').innerText = '전체 항목 초기화';
            const badge = document.getElementById('form-mode-badge');
            badge.style.display = 'none'; badge.innerText = '';
            document.getElementById('btn-step2-submit').style.display = '';
            syncDateWraps();
        }
        // 단건 탭으로 기본 이동
        switchAdminTab('single');
    }
}

function switchAdminTab(tab) {
    document.getElementById('adminSingle').style.display = tab === 'single' ? 'block' : 'none';
    document.getElementById('adminBulk').style.display  = tab === 'bulk'   ? 'block' : 'none';
    document.getElementById('adminTabSingle').classList.toggle('active', tab === 'single');
    document.getElementById('adminTabBulk').classList.toggle('active', tab === 'bulk');
    if (tab === 'bulk') {
        bulkGridInited = false; initBulkGrid();
        const ep = document.getElementById('bulk-error-panel');
        if (ep) ep.style.display = 'none';
    }
}

function updateLiveClock() {
    const now = new Date();
    const years = now.getFullYear();
    const months = String(now.getMonth() + 1).padStart(2, '0');
    const dates = String(now.getDate()).padStart(2, '0');
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    const day = dayNames[now.getDay()];
    
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');

    document.getElementById('live-date').innerText = `${years}년 ${months}월 ${dates}일 (${day}요일)`;
    document.getElementById('live-time').innerText = `${hours}:${minutes}`;
}

let _ganttDragged = false;

function setSearch(val) { AppState.currentSearch = val.trim(); renderDashboard(); }

function setDensity(level) {
    if (AppState.density === level) return;
    AppState.density = level;
    const gc = document.getElementById('gantt-rows');
    if (gc) {
        gc.classList.remove('gantt-comfortable', 'gantt-compact');
        if (level === 'comfortable') gc.classList.add('gantt-comfortable');
        if (level === 'compact')     gc.classList.add('gantt-compact');
    }
    document.querySelectorAll('.density-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.density === level);
    });
    drawDepLines();
    requestAnimationFrame(autoFitBarFonts);
}

function onListChkChange() {
    const all = document.querySelectorAll('.list-row-chk');
    const checked = document.querySelectorAll('.list-row-chk:checked');
    const allChk = document.getElementById('list-chk-all');
    if (allChk) allChk.checked = all.length > 0 && checked.length === all.length;
    _updateDeleteBtn();
}

function onCardChkChange(el) {
    const card = el.closest('.project-card');
    if (card) card.classList.toggle('card-checked', el.checked);
    _updateDeleteBtn();
}

function _updateDeleteBtn() {
    const listChecked = document.querySelectorAll('.list-row-chk:checked').length;
    const cardChecked = document.querySelectorAll('.card-row-chk:checked').length;
    const total = listChecked + cardChecked;
    const btn = document.getElementById('btn-delete-selected');
    if (btn) {
        btn.style.display = total > 0 ? '' : 'none';
        btn.textContent = total > 0 ? `선택 삭제 (${total}건)` : '선택 삭제';
    }
}

function toggleAllListChk(checked) {
    document.querySelectorAll('.list-row-chk').forEach(c => c.checked = checked);
    onListChkChange();
}

async function deleteSelected() {
    const listIds = [...document.querySelectorAll('.list-row-chk:checked')].map(c => parseInt(c.dataset.id));
    const cardIds = [...document.querySelectorAll('.card-row-chk:checked')].map(c => parseInt(c.dataset.id));
    const ids = [...new Set([...listIds, ...cardIds])];
    if (!ids.length) return;
    if (!confirm(`선택한 ${ids.length}건의 프로젝트를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;
    saveHistory(`선택 삭제 ${ids.length}건`);
    const prevProjects = AppState.projects.slice();
    AppState.projects = AppState.projects.filter(p => !ids.includes(p.id));
    const saved = await saveToStorage(ids, `프로젝트 ${ids.length}건 삭제`);
    if (!saved) {
        AppState.projects = prevProjects;
        renderDashboard();
        return;
    }
    renderDashboard();
    showMsg(`${ids.length}건의 프로젝트가 삭제되었습니다.`);
    showAdminBanner(`프로젝트 ${ids.length}건 삭제 완료`);
    const btn = document.getElementById('btn-delete-selected');
    if (btn) btn.style.display = 'none';
}
function setView(mode) {
    AppState.currentView = mode;
    document.getElementById('btn-view-card').classList.toggle('active', mode === 'card');
    document.getElementById('btn-view-list').classList.toggle('active', mode === 'list');
    document.getElementById('card-grid').style.display  = mode === 'card' ? '' : 'none';
    document.getElementById('list-view').style.display  = mode === 'list' ? '' : 'none';
    const isList = mode === 'list';
    const colWrap = document.getElementById('col-panel-wrap');
    if (!isList) { if (colWrap) colWrap.style.display = 'none'; }
    else { if (colWrap) colWrap.style.display = ''; }
    // 카드뷰로 전환 시 선택 초기화
    if (!isList) {
        document.querySelectorAll('.card-row-chk').forEach(c => { c.checked = false; });
        document.querySelectorAll('.project-card').forEach(c => c.classList.remove('card-checked'));
        _updateDeleteBtn();
    }
    renderDashboard();
}

// 드래그 후 해당 프로젝트 행의 bar-area만 갱신 (전체 리렌더 없이)
function setFilter(team) { AppState.currentFilter = team; document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.team === team)); renderDashboard(); }

function setTagFilter(tagId) {
    AppState.currentTagFilter = AppState.currentTagFilter === tagId ? null : tagId;
    renderDashboard();
}

function updateTeamFilterCounts() {
    const counts = {};
    AppState.projects.forEach(p => { counts[p.team] = (counts[p.team] || 0) + 1; });
    const total = AppState.projects.length;
    document.querySelectorAll('.filter-btn').forEach(btn => {
        const team = btn.dataset.team;
        const count = team === '전체' ? total : (counts[team] || 0);
        btn.innerHTML = `${escapeHtml(team)}<span class="tag-count">${count}</span>`;
    });
}

function renderTagFilter(projects) {
    const el = document.getElementById('tag-filter-container');
    const divider = document.getElementById('tag-filter-divider');
    if (!el) return;
    const src = projects ?? AppState.projects;
    const hasTagged = src.some(p => p.tags?.length);
    if (!hasTagged) {
        el.style.display = 'none';
        if (divider) divider.style.display = 'none';
        // 현재 연도·팀에 없는 태그 필터는 자동 해제
        if (AppState.currentTagFilter) AppState.currentTagFilter = null;
        return;
    }
    el.style.display = '';
    if (divider) divider.style.display = '';
    // 현재 태그 필터가 이 목록에 없으면 자동 해제
    if (AppState.currentTagFilter && !src.some(p => (p.tags||[]).includes(AppState.currentTagFilter))) {
        AppState.currentTagFilter = null;
    }
    el.innerHTML = PRESET_TAGS.map(tag => {
            const count = src.filter(p => p.tags?.includes(tag.id)).length;
            if (!count) return '';
            const isActive = AppState.currentTagFilter === tag.id;
            return `<button class="tag-filter-btn" data-tag="${tag.id}"
                style="${isActive ? `background:${tag.fg};color:white;border-color:${tag.fg};` : `background:${tag.bg};color:${tag.fg};border-color:${tag.bg};`}"
                onclick="setTagFilter('${tag.id}')">
                ${tag.label}<span class="tag-count">${count}</span>
            </button>`;
        }).join('') +
        (AppState.currentTagFilter ? `<button class="tag-filter-btn tag-filter-clear" onclick="setTagFilter(null)">× 해제</button>` : '');
}

function toggleAlertBanner() {
    const el = document.getElementById('alert-banner');
    if (!el) return;
    el.classList.toggle('collapsed');
    const body = el.querySelector('.alert-banner-body');
    const btn = el.querySelector('.alert-banner-toggle');
    if (body) body.classList.toggle('collapsed');
    if (btn) btn.textContent = el.classList.contains('collapsed') ? '펼치기' : '접기';
}

function dismissAlertBanner() {
    sessionStorage.setItem('alert-banner-dismissed', '1');
    const el = document.getElementById('alert-banner');
    if (el) el.style.display = 'none';
}

// ── Cmd+K 커맨드 팔레트 ──────────────────────────────
let _cmdSelIdx = -1;

function openCmdPal() {
    const ov = document.getElementById('cmdPalOverlay');
    if (!ov) return;
    ov.classList.add('open');
    const inp = document.getElementById('cmdPalInput');
    if (inp) { inp.value = ''; inp.focus(); }
    _cmdSelIdx = -1;
    updateCmdPal();
}

function closeCmdPal() {
    const ov = document.getElementById('cmdPalOverlay');
    if (ov) ov.classList.remove('open');
}

function updateCmdPal() {
    const q = (document.getElementById('cmdPalInput')?.value || '').toLowerCase().trim();
    const res = document.getElementById('cmdPalResults');
    if (!res) return;

    const matched = !q
        ? AppState.projects.slice(0, 8)
        : AppState.projects.filter(p =>
            p.name.toLowerCase().includes(q) ||
            p.pm.toLowerCase().includes(q) ||
            p.team.toLowerCase().includes(q)
          ).slice(0, 10);

    if (!matched.length) {
        res.innerHTML = `<div class="cmdpal-empty">검색 결과가 없습니다</div>`;
        _cmdSelIdx = -1; return;
    }

    res.innerHTML = `<div class="cmdpal-section-label">${q ? '검색 결과' : '전체 프로젝트'}</div>` +
        matched.map((p, i) => {
            const styles = getStyleSet(p.team);
            return `<div class="cmdpal-item${i === _cmdSelIdx ? ' selected' : ''}" data-idx="${i}" onclick="cmdPalSelect(${i})" onmouseover="_cmdSelIdx=${i};renderCmdPalSel()">
                <div class="cmdpal-item-icon" style="background:${statusBgForPalette(p)};color:${statusFgForPalette(p)};">${escapeHtml(p.team.slice(0,2))}</div>
                <div><div class="cmdpal-item-name">${escapeHtml(p.name)}</div><div class="cmdpal-item-meta">${escapeHtml(p.team)} · 담당자 ${escapeHtml(p.pm)} · ${calcDDay(p.open, new Date()).text}</div></div>
            </div>`;
        }).join('');
    _cmdSelIdx = -1;
}

function statusBgForPalette(p) {
    const now = new Date(); now.setHours(0,0,0,0);
    const openDate = new Date(p.open); openDate.setHours(23,59,59);
    const ap = p.phaseDetails?.find(pd => { const s=parseDate(pd.start),e=parseDate(pd.end); e.setHours(23,59,59); return now>=s&&now<=e; });
    if (ap) return '#dbeafe';
    if (now >= openDate) return '#d1fae5';
    if (p.phaseDetails?.length && now < parseDate(p.phaseDetails[0].start)) return '#f1f5f9';
    return '#ede9fe';
}
function statusFgForPalette(p) {
    const now = new Date(); now.setHours(0,0,0,0);
    const openDate = new Date(p.open); openDate.setHours(23,59,59);
    const ap = p.phaseDetails?.find(pd => { const s=parseDate(pd.start),e=parseDate(pd.end); e.setHours(23,59,59); return now>=s&&now<=e; });
    if (ap) return '#1d4ed8';
    if (now >= openDate) return '#065f46';
    if (p.phaseDetails?.length && now < parseDate(p.phaseDetails[0].start)) return '#64748b';
    return '#5b21b6';
}

function renderCmdPalSel() {
    document.querySelectorAll('.cmdpal-item').forEach((el, i) => el.classList.toggle('selected', i === _cmdSelIdx));
}

function cmdPalSelect(idx) {
    const q = (document.getElementById('cmdPalInput')?.value || '').toLowerCase().trim();
    const matched = !q ? AppState.projects.slice(0,8) : AppState.projects.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.pm.toLowerCase().includes(q) || p.team.toLowerCase().includes(q)).slice(0,10);
    if (matched[idx]) { closeCmdPal(); editProject(matched[idx].id); }
}

function cmdPalKeyDown(e) {
    const res = document.getElementById('cmdPalResults');
    const items = res?.querySelectorAll('.cmdpal-item') || [];
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        _cmdSelIdx = Math.min(_cmdSelIdx + 1, items.length - 1);
        renderCmdPalSel();
        items[_cmdSelIdx]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        _cmdSelIdx = Math.max(_cmdSelIdx - 1, 0);
        renderCmdPalSel();
        items[_cmdSelIdx]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
        if (_cmdSelIdx >= 0) cmdPalSelect(_cmdSelIdx);
        else if (items.length === 1) cmdPalSelect(0);
    } else if (e.key === 'Escape') {
        closeCmdPal();
    }
}

document.addEventListener('keydown', function(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        const ov = document.getElementById('cmdPalOverlay');
        if (ov?.classList.contains('open')) closeCmdPal(); else openCmdPal();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        undoLast();
    }
});

// ── 실행취소 (Ctrl+Z / Cmd+Z) ────────────────────────
function saveHistory(label) {
    AppState.commandHistory.push({ label, snapshot: JSON.parse(JSON.stringify(AppState.projects)) });
    if (AppState.commandHistory.length > 10) AppState.commandHistory.shift();
}

async function undoLast() {
    const entry = AppState.commandHistory.pop();
    if (!entry) { showMsg('되돌릴 작업이 없습니다.', 'warn'); return; }
    const prevProjects = AppState.projects;
    AppState.projects = entry.snapshot;
    const saved = await saveToStorage([], '실행 취소');
    if (!saved) {
        AppState.projects = prevProjects;
        AppState.commandHistory.push(entry);
        renderDashboard();
        return;
    }
    renderDashboard();
    showMsg(`실행 취소: ${entry.label}`);
}

// ── 폼 이탈 방지 (beforeunload) ───────────────────────
window.addEventListener('beforeunload', function(e) {
    if (AppState.formDirty) { e.preventDefault(); e.returnValue = ''; }
});

function updateSavedInfo() {
    const el = document.getElementById('io-last-saved');
    if (!el) return;
    // 서버 접속 시 projects 배열 기준으로 표시
    if (AppState.projects.length > 0) {
        const now = new Date();
        const fmt = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
        el.innerText = `- ${AppState.projects.length}건 · 마지막 저장: ${fmt}`;
        return;
    }
    const raw = localStorage.getItem(lsKey());
    if (!raw) { el.innerText = '- 저장 데이터 없음'; return; }
    try {
        const meta = localStorage.getItem(lsKey() + '_meta');
        if (meta) {
            const { savedAt, count } = JSON.parse(meta);
            const d = new Date(savedAt);
            const fmt = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
            el.innerText = `- ${count}건 · 마지막 저장: ${fmt}`;
        } else {
            const parsed = JSON.parse(raw);
            el.innerText = `- ${parsed.length}건 저장됨`;
        }
    } catch(e) { el.innerText = '- 저장 데이터 있음'; }
}

// ── 내보내기 ──────────────────────────────────────
function exportProjects() {
    if (AppState.projects.length === 0) { showMsg('내보낼 프로젝트가 없습니다.', 'warn'); return; }
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
    const payload = {
        exportedAt: now.toISOString(),
        exportedBy: 'SI Dashboard 2026',
        version: '1.0',
        count: AppState.projects.length,
        projects: AppState.projects
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob(['﻿' + json], { type: 'application/json;charset=utf-8' }); // BOM 포함 → 윈도우 메모장 한글 깨짐 방지
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `si_projects_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showMsg(`${AppState.projects.length}개 프로젝트 내보내기 완료.\n다운로드 폴더에서 확인하세요.`);
}

// ── 가져오기 공통 처리 (isMerge: false=덮어쓰기, true=병합) ──
function handleImportFile(e, isMerge) {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.name.endsWith('.json')) {
        showMsg('JSON 파일(.json)만 가져올 수 있습니다.', 'warn');
        e.target.value = ''; return;
    }
    const reader = new FileReader();
    reader.onload = async function(ev) {
        try {
            // BOM 제거 후 파싱
            const text = ev.target.result.replace(/^﻿/, '');
            const raw = JSON.parse(text);

            // 배열 직접 또는 {projects:[]} 형식 모두 허용
            const incoming = Array.isArray(raw) ? raw : (Array.isArray(raw.projects) ? raw.projects : null);
            if (!incoming) {
                showMsg('올바른 형식의 파일이 아닙니다.\n내보내기로 생성된 JSON만 지원됩니다.', 'error');
                e.target.value = ''; return;
            }

            const incomingProjects = _normalizeProjectList(incoming);

            // 필수 필드 및 일정 검증
            const invalid = [];
            incomingProjects.forEach((p) => {
                const errors = [];
                if (!p.name) errors.push('프로젝트명 누락');
                if (!p.team) errors.push('담당팀 누락');
                if (!p.pm) errors.push('담당자 누락');
                const schedule = validateProjectSchedule(p);
                if (!schedule.valid) errors.push(schedule.errors[0].message);
                if (errors.length > 0) invalid.push({ name: p.name || '(이름없음)', message: errors.join(', ') });
                else p.phaseDetails = schedule.phaseDetails;
            });
            if (invalid.length > 0) {
                showMsg(`데이터 손상 ${invalid.length}건 — 필수 필드 또는 일정 오류\n(${invalid.map(p => p.name).slice(0,3).join(', ')}${invalid.length > 3 ? '...' : ''})`, 'error');
                e.target.value = ''; return;
            }

            const prevProjects = AppState.projects.slice();
            if (isMerge) {
                // 병합: 기존 프로젝트명 기준으로 중복 제외
                const existingNames = new Set(AppState.projects.map(p => p.name));
                const toAdd = incomingProjects.filter(p => !existingNames.has(p.name));
                const skipped = incomingProjects.length - toAdd.length;
                if (toAdd.length === 0) {
                    showMsg(`신규 프로젝트 없음 — ${skipped}개 모두 이미 존재하는 프로젝트명`, 'warn');
                    e.target.value = ''; return;
                }
                const msg = `[병합 가져오기]\n\n신규 추가: ${toAdd.length}개\n중복 제외: ${skipped}개${skipped > 0 ? '\n  -> ' + incomingProjects.filter(p => existingNames.has(p.name)).map(p => p.name).join(', ') : ''}\n\n계속하시겠습니까?`;
                if (!confirm(msg)) { e.target.value = ''; return; }
                toAdd.forEach(p => { p.id = Date.now() + Math.random(); });
                AppState.projects = [...AppState.projects, ...toAdd];
            } else {
                const exportedAt = raw.exportedAt ? new Date(raw.exportedAt).toLocaleString('ko-KR') : '알 수 없음';
                const msg = `[가져오기 - 덮어쓰기]\n\n파일 내 프로젝트: ${incomingProjects.length}개\n내보낸 시각: ${exportedAt}\n\n[!] 현재 데이터(${AppState.projects.length}개)가 모두 교체됩니다.\n계속하시겠습니까?`;
                if (!confirm(msg)) { e.target.value = ''; return; }
                AppState.projects = incomingProjects;
            }

            const saved = await saveToStorage([], '데이터 가져오기', AppState.projects, { replaceYear: !isMerge });
            if (!saved) {
                AppState.projects = prevProjects;
                renderDashboard();
                e.target.value = '';
                return;
            }
            AppState.currentFilter = '전체';
            renderDashboard();
            showMsg(`${isMerge ? '병합' : '가져오기'} 완료 — 현재 ${AppState.projects.length}개 프로젝트`);
        } catch(err) {
            showMsg('파일 읽기 오류 — 올바른 JSON 파일인지 확인해 주세요.', 'error');
            console.error('[가져오기 오류]', err.message);
        }
        e.target.value = ''; // 동일 파일 재선택 가능하도록 초기화
    };
    reader.readAsText(file, 'utf-8');
}

async function setYear(year) {
    AppState.currentYear = year;
    clearColorCache();
    // 헤더/타이틀 갱신
    document.getElementById('header-sub-tag').innerText = `Credit IT Development Department Roadmap ${year}`;
    document.getElementById('header-title').innerText   = `${year} 여신IT개발부 주요 프로젝트 현황`;
    document.title = `${year} 여신IT개발부 주요 프로젝트 현황`;
    const fyEl = document.getElementById('footer-year');
    if (fyEl) fyEl.innerText = `© ${year} `;
    // 연도 선택기 표시 갱신
    const yd = document.getElementById('year-display');
    if (yd) yd.innerText = year;
    // 데이터 재로드 & 렌더
    AppState.projects = [];
    await initData();
    showMsg(`${year}년 데이터로 전환되었습니다.`);
}

async function resetAllData() {
    if (!confirm('[!] 저장된 모든 프로젝트 데이터를 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.')) return;
    try {
        const headers = AppState.dataVersion ? { 'If-Match': AppState.dataVersion } : {};
        const res = await fetch('/api/projects', { method: 'DELETE', headers });
        if (!res.ok) {
            showMsg(`전체 삭제 실패 (${res.status})`, 'error');
            return;
        }
        AppState.dataVersion = res.headers.get('ETag') || AppState.dataVersion;
    } catch(e) {
        showMsg('서버에 연결할 수 없어 전체 삭제를 완료하지 못했습니다.', 'error');
        return;
    }
    // 모든 연도의 로컬스토리지 제거
    Object.keys(localStorage)
        .filter(k => k.startsWith('si_projects_'))
        .forEach(k => localStorage.removeItem(k));
    AppState.projects = [];
    AppState.currentFilter = '전체';
    renderDashboard();
    switchView('dashboard');
    showMsg('모든 데이터가 삭제되었습니다.');
}
function _applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('si-theme', theme);
    const lbl = document.getElementById('theme-toggle-label');
    if (lbl) lbl.innerText = theme === 'dark' ? '라이트모드' : '다크모드';
}

function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    _applyTheme(isDark ? 'light' : 'dark');
    clearColorCache();
    renderDashboard();
}

(function() {
    _applyTheme(localStorage.getItem('si-theme') || 'dark');
})();
