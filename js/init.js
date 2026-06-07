// ── Gantt 호버 툴팁 ──────────────────────────────────
(function() {
    const tt = document.getElementById('ganttTooltip');
    if (!tt) return;
    document.addEventListener('mouseover', function(e) {
        const bar = e.target.closest('.phase-bar');
        if (!bar) return;
        const name  = bar.dataset.pname || bar.textContent.trim();
        const start = bar.dataset.start || '';
        const end   = bar.dataset.end   || '';
        const desc  = bar.dataset.desc  || '';
        tt.innerHTML = `<div class="gantt-tooltip-name">${escapeHtml(name)}</div><div class="gantt-tooltip-date">${escapeHtml(start)} ~ ${escapeHtml(end)}</div>${desc ? `<div class="gantt-tooltip-desc">${escapeHtml(desc)}</div>` : ''}`;
        tt.classList.add('visible');
    });
    document.addEventListener('mousemove', function(e) {
        if (!tt.classList.contains('visible')) return;
        const x = e.clientX + 14;
        const y = e.clientY - 44;
        tt.style.left = Math.min(x, window.innerWidth  - tt.offsetWidth  - 10) + 'px';
        tt.style.top  = Math.max(y, 10)                                         + 'px';
    });
    document.addEventListener('mouseout', function(e) {
        if (!e.target.closest('.phase-bar')) return;
        const to = e.relatedTarget;
        if (to && to.closest('.phase-bar')) return;
        tt.classList.remove('visible');
    });
})();

// ── Gantt Drag & Drop ─────────────────────────────────
(function initGanttDrag() {
    let ds = null;
    const tip = document.getElementById('ganttDragTip');
    const hoverTip = document.getElementById('ganttTooltip');

    function posToDate(pct) {
        pct = Math.max(0, Math.min(99.9, pct));
        const tm = pct / 100 * 12;
        const mo = Math.min(11, Math.floor(tm));
        const dim = new Date(AppState.currentYear, mo + 1, 0).getDate();
        const day = Math.max(1, Math.min(dim, Math.round((tm - mo) * dim) + 1));
        return `${AppState.currentYear}-${String(mo+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    }

    function showTip(e, s, en) {
        if (!tip) return;
        const days = Math.round((parseDate(en) - parseDate(s)) / MS_PER_DAY) + 1;
        const delta = ds ? days - ds.origDays : 0;
        const deltaHtml = delta === 0 ? '' : ` <span class="tip-delta ${delta > 0 ? 'pos' : 'neg'}">${delta > 0 ? '+' : ''}${delta}일</span>`;
        tip.innerHTML = `${fmtD(s)}<em>→</em>${fmtD(en)}<em>·</em>${days}일${deltaHtml}`;
        tip.classList.add('show');
        tip.style.left = Math.min(e.clientX + 16, window.innerWidth - tip.offsetWidth - 12) + 'px';
        tip.style.top  = (e.clientY - 40) + 'px';
    }

    // 커서 스타일: 좌우 10px 안에서 ew-resize
    document.addEventListener('mousemove', function(e) {
        if (ds) return;
        const bar = e.target.closest('.phase-bar');
        if (!bar) return;
        const r = bar.getBoundingClientRect();
        const rx = e.clientX - r.left;
        const cur = (rx <= 10 || rx >= r.width - 10) ? 'ew-resize' : 'grab';
        if (bar.style.cursor !== cur) bar.style.cursor = cur;
    });

    document.addEventListener('mousedown', function(e) {
        const bar = e.target.closest('.phase-bar');
        if (!bar || e.button !== 0) return;
        const barArea = bar.closest('.bar-area');
        if (!barArea) return;
        const projId   = parseInt(bar.dataset.projId);
        const phaseIdx = parseInt(bar.dataset.phaseIdx);
        if (isNaN(projId) || isNaN(phaseIdx)) return;

        const br = bar.getBoundingClientRect();
        const ar = barArea.getBoundingClientRect();
        const rx = e.clientX - br.left;
        const type = rx <= 14 ? 'resize-l' : rx >= br.width - 14 ? 'resize-r' : 'move';

        const origDays = (() => {
            const os = bar.dataset.start, oe = bar.dataset.end;
            if (!os || !oe) return 0;
            return Math.round((parseDate(oe) - parseDate(os)) / MS_PER_DAY) + 1;
        })();
        ds = {
            type, projId, phaseIdx, bar, barArea,
            areaW: ar.width,
            startX: e.clientX,
            origLeft:  (br.left - ar.left) / ar.width * 100,
            origWidth: br.width / ar.width * 100,
            origDays,
            dragging: false
        };
        e.preventDefault();
    }, true);

    document.addEventListener('mousemove', function(e) {
        if (!ds) return;
        const dx   = e.clientX - ds.startX;
        const dPct = dx / ds.areaW * 100;

        if (!ds.dragging) {
            if (Math.abs(dx) < 4) return;
            ds.dragging = true;
            ds.bar.classList.add('gd-dragging');
            if (hoverTip) hoverTip.classList.remove('visible');
            document.body.style.userSelect = 'none';
            ds.bar.style.width = ds.origWidth + '%';
            ds.bar.style.left  = ds.origLeft  + '%';
        }

        let L = ds.origLeft, W = ds.origWidth;
        if (ds.type === 'move') {
            L = Math.max(0, Math.min(100 - W, L + dPct));
        } else if (ds.type === 'resize-l') {
            const maxL = ds.origLeft + ds.origWidth - 0.5;
            L = Math.max(0, Math.min(maxL, L + dPct));
            W = ds.origWidth + (ds.origLeft - L);
        } else {
            W = Math.max(0.5, W + dPct);
        }
        ds.bar.style.left  = L + '%';
        ds.bar.style.width = W + '%';
        showTip(e, posToDate(L), posToDate(L + W));
        const bw = ds.bar.offsetWidth;
        if      (bw < 16) { ds.bar.style.fontSize = '0';       ds.bar.style.padding = '0'; }
        else if (bw < 28) { ds.bar.style.fontSize = '0.44rem'; ds.bar.style.padding = '0 2px'; }
        else if (bw < 45) { ds.bar.style.fontSize = '0.52rem'; ds.bar.style.padding = '0 4px'; }
        else if (bw < 70) { ds.bar.style.fontSize = '0.6rem';  ds.bar.style.padding = ''; }
        else if (bw < 95) { ds.bar.style.fontSize = '0.72rem'; ds.bar.style.padding = ''; }
        else              { ds.bar.style.fontSize = '';          ds.bar.style.padding = ''; }
    });

    document.addEventListener('mouseup', async function(e) {
        if (!ds) return;
        if (ds.dragging) {
            const L = parseFloat(ds.bar.style.left);
            const W = parseFloat(ds.bar.style.width);
            const newStart = posToDate(L);
            const newEnd   = posToDate(L + W);
            const proj = AppState.projects.find(p => p.id === ds.projId);
            if (proj && proj.phaseDetails[ds.phaseIdx]) {
                // 종료일이 오픈일을 초과하면 되돌리고 안내
                if (proj.open && new Date(newEnd) > new Date(proj.open)) {
                    showMsg(`단계 종료일(${fmtD(newEnd)})이 오픈일(${fmtD(proj.open)})을 초과합니다.\n오픈일을 먼저 수정해 주세요.`, 'warn');
                    ds.bar.style.left  = ds.origLeft  + '%';
                    ds.bar.style.width = ds.origWidth + '%';
                    autoFitBarFonts();
                    ds.bar.classList.remove('gd-dragging');
                    document.body.style.userSelect = '';
                    if (tip) tip.classList.remove('show');
                    ds = null;
                    return;
                }
                const prevProjects = JSON.parse(JSON.stringify(AppState.projects));
                saveHistory(`${proj.phaseDetails[ds.phaseIdx].name || '단계'} 드래그 전`);
                proj.phaseDetails[ds.phaseIdx].start = newStart;
                proj.phaseDetails[ds.phaseIdx].end   = newEnd;
                cascadePhases(proj, ds.phaseIdx);
                cascadePhasesBackward(proj, ds.phaseIdx);
                const saved = await saveToStorage([], `${proj.name} — ${proj.phaseDetails[ds.phaseIdx].name || '단계'} 일정 수정`);
                if (!saved) {
                    AppState.projects = prevProjects;
                    renderDashboard();
                    ds.bar.classList.remove('gd-dragging');
                    document.body.style.userSelect = '';
                    if (tip) tip.classList.remove('show');
                    ds = null;
                    return;
                }
                _ganttDragged = true;
                renderSingleGanttRow(proj.id);
                requestAnimationFrame(() => { autoFitBarFonts(); requestAnimationFrame(drawDepLines); });
                const cascaded = proj.phaseDetails.slice(ds.phaseIdx + 1)
                    .filter(pd => pd.start !== proj.phaseDetails[ds.phaseIdx].end);
                const cascadeNote = cascaded.length
                    ? ` · ${cascaded.length}개 후속 단계 연동` : '';
                showMsg(`${proj.phaseDetails[ds.phaseIdx].name || '단계'} 일정 변경: ${fmtD(newStart)} ~ ${fmtD(newEnd)}${cascadeNote}`);
                showAdminBanner(`${proj.name} — ${proj.phaseDetails[ds.phaseIdx].name || '단계'} 일정 수정 완료`);
            }
        }
        ds.bar.classList.remove('gd-dragging');
        document.body.style.userSelect = '';
        if (tip) tip.classList.remove('show');
        ds = null;
    });
})();

// 탭 포커스 폴링 → WebSocket 실시간 동기화로 대체됨 (socket.js)

window.onload = () => {
    // 연도 동적 적용 (헤더 텍스트 + 페이지 타이틀 + footer + 연도 선택기)
    document.getElementById('header-sub-tag').innerText = `Credit IT Development Department Roadmap ${AppState.currentYear}`;
    document.getElementById('header-title').innerText   = `${AppState.currentYear} 여신IT개발부 주요 프로젝트 현황`;
    document.title = `${AppState.currentYear} 여신IT개발부 주요 프로젝트 현황`;
    const fyEl = document.getElementById('footer-year');
    if (fyEl) fyEl.innerText = `© ${AppState.currentYear} `;
    const ydEl = document.getElementById('year-display');
    if (ydEl) ydEl.innerText = AppState.currentYear;

    const fContainer = document.getElementById('filter-container');
    const teamBtnClass = { '전체': 'filter-btn-all', '여신심사팀': 'filter-btn-team-a', '여신업무팀': 'filter-btn-team-b', '여신관리팀': 'filter-btn-team-c', '상품/신용평가팀': 'filter-btn-team-d', '외환팀': 'filter-btn-team-e', 'PPR팀': 'filter-btn-team-f' };
    fContainer.innerHTML = teams.map(team => `<button class="filter-btn ${teamBtnClass[team] || ''} ${AppState.currentFilter === team ? 'active' : ''}" data-team="${team}" onclick="setFilter('${team}')">${team}</button>`).join('');

    // 로컬호스트 접속자만 '대시보드 초기화' 버튼 표시
    const resetAllBtn = document.getElementById('btn-reset-all');
    if (resetAllBtn && ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)) {
        resetAllBtn.style.display = '';
    }

    setInterval(updateLiveClock, 1000);
    updateLiveClock();

    initData();
    initTagInput();
    _startPeriodicRefresh();
    _startWakeLock();
    if (typeof _initSocket === 'function') _initSocket();

    // gantt-content 너비 변경 시에만 폰트 재계산 (window resize는 모바일 스크롤에도 발화)
    const _ganttContent = document.querySelector('.gantt-content');
    if (_ganttContent && typeof ResizeObserver !== 'undefined') {
        let _roFitTimer = null;
        new ResizeObserver(function() {
            clearTimeout(_roFitTimer);
            _roFitTimer = setTimeout(autoFitBarFonts, 120);
        }).observe(_ganttContent);
    }

    // 폼 dirty 트래킹: adminSingle 내 입력 변경 시 플래그 설정
    const adminSingle = document.getElementById('adminSingle');
    if (adminSingle) {
        adminSingle.addEventListener('input',  () => { AppState.formDirty = true; });
        adminSingle.addEventListener('change', () => { AppState.formDirty = true; });
    }

    // 날짜 입력 연도 4자리 보정 (전역)
    document.addEventListener('input', function(e) {
        if (e.target.type !== 'date') return;
        const val = e.target.value;
        if (!val) return;
        const firstDash = val.indexOf('-');
        if (firstDash > 4) {
            e.target.value = val.slice(0, 4) + val.slice(firstDash);
        }
    });
    // textarea auto-expand (iOS/Android resize:vertical 미지원 대응)
    document.addEventListener('input', function(e) {
        if (e.target.tagName !== 'TEXTAREA') return;
        e.target.style.height = 'auto';
        e.target.style.height = e.target.scrollHeight + 'px';
    });
    document.addEventListener('change', function(e) {
        if (e.target.type === 'date') {
            var wrap = e.target.parentElement;
            if (wrap && wrap.classList.contains('date-wrap')) {
                wrap.classList.toggle('ph-show', !e.target.value);
            }
        }
    });

    // 단건 등록 폼 — Enter 키로 다음 항목 이동 (순환)
    (function() {
        function getOrderedFields() {
            const ids = [
                'in-name', 'in-team', 'in-pm',
                'in-client-dept', 'in-open'
            ];
            for (let i = 1; i <= 5; i++) {
                ids.push(`ph-name-${i}`, `ph-start-${i}`, `ph-end-${i}`, `ph-desc-${i}`);
            }
            return ids.map(id => document.getElementById(id)).filter(Boolean);
        }

        // Chrome은 keyup 핸들러에서 focus()를 호출하면 새 요소에도 keyup을 재발생시킴
        // → _justMoved 플래그로 150ms 내 재진입 차단
        let _justMoved = false;

        function moveToNext(target) {
            if (_justMoved) return;
            _justMoved = true;
            setTimeout(() => { _justMoved = false; }, 150);
            const fields = getOrderedFields();
            const idx = fields.indexOf(target);
            if (idx < 0) return;
            // 마지막 항목이면 첫 항목으로 순환
            const next = fields[(idx + 1) % fields.length];
            setTimeout(() => next.focus(), 0);
        }

        // keydown: textarea에서 Enter(Shift·IME 없이)의 줄바꿈만 방지
        document.addEventListener('keydown', function(e) {
            if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
            const adminView = document.getElementById('adminView');
            if (!adminView || adminView.style.display === 'none') return;
            if (e.target.tagName === 'TEXTAREA') e.preventDefault();
        });

        // keyup: 이 시점엔 IME 커밋 완료 → 다음 필드로 이동
        document.addEventListener('keyup', function(e) {
            if (e.key !== 'Enter' || _justMoved) return;
            const adminView = document.getElementById('adminView');
            if (!adminView || adminView.style.display === 'none') return;
            const tag = e.target.tagName;
            if (tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') return;
            if (tag === 'TEXTAREA' && e.shiftKey) return;
            moveToNext(e.target);
        });
    })();
}
