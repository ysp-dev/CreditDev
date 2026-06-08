function buildBarAreaHtml(p) {
    const now = new Date();
    const todayPos = now.getFullYear() === AppState.currentYear ? getDatePos(now) : null;
    const openDateObj  = parseDate(p.open);
    const openYear     = openDateObj.getFullYear();
    // 오픈일 위치 결정:
    //  - 해당 연도: 정확한 위치
    //  - 내년 이후: 오른쪽 밖
    //  - 이전 연도: 1월 왼쪽 앞 (비컨만 표시, 날짜 라벨 생략)
    const openInThisYear  = openYear === AppState.currentYear;
    const openInFuture    = openYear >  AppState.currentYear;
    const openInPast      = openYear <  AppState.currentYear;
    const milestoneStyle  = openInFuture ? 'left:calc(100% + 8px)'
                          : openInPast   ? 'left:-20px'
                          :                `left:${getDatePos(p.open)}%`;
    const yearStart = new Date(AppState.currentYear, 0, 1);   // 1월 1일 00:00
    const yearEnd   = new Date(AppState.currentYear, 11, 31); // 12월 31일 00:00

    const bars = p.phaseDetails.map((pd, idx) => {
        const pdStartDate = parseDate(pd.start);
        const pdEndDate   = parseDate(pd.end);

        // 해당 연도와 전혀 겹치지 않으면 생략
        if (pdEndDate < yearStart || pdStartDate > yearEnd) return '';

        // 연도 경계로 클리핑 (전년도에서 이어지거나 내년으로 넘어가는 바 대응)
        const clippedStart  = pdStartDate < yearStart ? yearStart : pdStartDate;
        const clippedEnd    = pdEndDate   > yearEnd   ? yearEnd   : pdEndDate;
        const startsPrevYear = pdStartDate < yearStart;
        const endsNextYear   = pdEndDate   > yearEnd;

        const startX = getDatePos(clippedStart);
        const endX   = getDatePos(clippedEnd);
        const widthX = Math.max(MIN_BAR_WIDTH, endX - startX);

        const pdEnd = new Date(pdEndDate); pdEnd.setHours(23,59,59);
        const phaseState = now > pdEnd ? 'phase-done' : (now >= pdStartDate ? 'phase-active' : '');
        const continuesCls = (endsNextYear   ? ' phase-continues'      : '') +
                             (startsPrevYear ? ' phase-continues-left'  : '');
        const barLabel   = pd.name.split(':')[1] || pd.name;
        const safeBarDesc = (pd.desc||'').replace(/"/g,'&quot;').replace(/\r?\n/g,' ');
        // 단계 번호를 이름("1단계:...")에서 추출, 없으면 순서(idx+1) 사용
        const phaseNum   = parseInt(pd.name.match(/^(\d+)단계/)?.[1]) || (idx + 1);
        const barColor   = resolveColor(`var(--phase-${Math.min(5, Math.max(1, phaseNum))})`);
        return `<div class="phase-bar ${idx===0?'first-phase':''} ${phaseState}${continuesCls}" data-pname="${escapeHtml(barLabel)}" data-start="${pd.start}" data-end="${pd.end}" data-desc="${escapeHtml(safeBarDesc)}" data-proj-id="${p.id}" data-phase-idx="${idx}" style="left:${startX}%;width:${widthX}%;background-color:${barColor};background-image:linear-gradient(to bottom,rgba(255,255,255,0.30) 0%,rgba(255,255,255,0.06) 50%,rgba(0,0,0,0.08) 100%);">${escapeHtml(barLabel)}</div>`;
    }).join('');
    const gridLines = Array.from({length:12},(_,mi)=>{
        const now2=new Date();
        const isCur=now2.getFullYear()===AppState.currentYear&&now2.getMonth()===mi;
        return `<div class="grid-line${isCur?' current-month-bar':''}"></div>`;
    }).join('');
    const todayHtml = todayPos!==null
        ? `<div class="past-overlay" style="width:${todayPos}%;"></div><div class="today-line" style="left:${todayPos}%;"></div>` : '';
    const milestoneLabel = openInPast ? '' : formatOpenTag(p.open);
    const milestoneTitle = openInPast ? ` title="${p.open} 오픈 (전년도)"` : '';
    return gridLines + todayHtml + bars +
        `<div class="milestone" style="${milestoneStyle};"${milestoneTitle}><span class="open-beacon"><span class="open-beacon-ring"></span><span class="open-beacon-ring"></span><span class="open-beacon-dot"></span></span>${milestoneLabel}</div>`;
}

function renderSingleGanttRow(projId) {
    const proj = AppState.projects.find(p => p.id === projId);
    if (!proj) return;
    const row = document.querySelector(`.gantt-row[data-proj-id="${projId}"]`);
    if (!row) return;
    const barArea = row.querySelector('.bar-area');
    if (!barArea) return;
    barArea.innerHTML = buildBarAreaHtml(proj);
    requestAnimationFrame(drawDepLines);
}

function drawDepLines() {
    const ganttRows = document.getElementById('gantt-rows');
    if (!ganttRows) return;

    const hasDeps = AppState.projects.some(p => p.deps && p.deps.length > 0);

    let svg = document.getElementById('dep-lines-svg');
    if (!hasDeps || AppState.density === 'compact') {
        if (svg) svg.innerHTML = '';
        return;
    }

    if (!svg) {
        svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.id = 'dep-lines-svg';
        svg.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;overflow:visible;z-index:10;';
        ganttRows.style.position = 'relative';
        ganttRows.appendChild(svg);
    }

    svg.setAttribute('width',  ganttRows.scrollWidth);
    svg.setAttribute('height', ganttRows.scrollHeight);

    svg.innerHTML = `<defs>
        <marker id="dlar-ok" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M0,1.5 L9,5 L0,8.5 Z" fill="#3b82f6"/>
        </marker>
        <marker id="dlar-err" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M0,1.5 L9,5 L0,8.5 Z" fill="#F46600"/>
        </marker>
    </defs>`;

    const cr = ganttRows.getBoundingClientRect();

    AppState.projects.forEach(succ => {
        if (!succ.deps || !succ.deps.length) return;
        const succRow = ganttRows.querySelector(`.gantt-row[data-proj-id="${succ.id}"]`);
        if (!succRow) return;
        const succFirstBar = succRow.querySelector('.phase-bar.first-phase') || succRow.querySelector('.phase-bar');
        if (!succFirstBar) return;

        succ.deps.forEach(predId => {
            const pred = AppState.projects.find(p => p.id === predId);
            if (!pred) return;
            const predRow = ganttRows.querySelector(`.gantt-row[data-proj-id="${predId}"]`);
            if (!predRow) return;
            const predBars = predRow.querySelectorAll('.phase-bar');
            if (!predBars.length) return;
            const predLastBar = predBars[predBars.length - 1];

            const pr = predLastBar.getBoundingClientRect();
            const sr = succFirstBar.getBoundingClientRect();
            const x1 = pr.right  - cr.left;
            const y1 = pr.top    + pr.height / 2 - cr.top;
            const x2 = sr.left   - cr.left + 12;
            const y2 = sr.top    + sr.height / 2 - cr.top;

            const isConflict = pred.phaseDetails.length > 0 && succ.phaseDetails.length > 0 &&
                succ.phaseDetails[0].start < pred.phaseDetails[pred.phaseDetails.length - 1].end;

            const color  = isConflict ? '#F46600' : '#3b82f6';
            const sw     = isConflict ? '2.2' : '1.8';
            const dash   = isConflict ? '5,3' : '4,3';
            const marker = isConflict ? 'url(#dlar-err)' : 'url(#dlar-ok)';
            const cx     = (x1 + x2) / 2;

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', `M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`);
            path.setAttribute('fill', 'none');
            path.setAttribute('stroke', color);
            path.setAttribute('stroke-width', sw);
            if (dash) path.setAttribute('stroke-dasharray', dash);
            path.setAttribute('marker-end', marker);
            svg.appendChild(path);
        });
    });

}

function renderAlertBanner() {
    const el = document.getElementById('alert-banner');
    if (!el) return;
    if (sessionStorage.getItem('alert-banner-dismissed')) { el.style.display = 'none'; return; }

    const now = new Date(); now.setHours(0, 0, 0, 0);
    const urgent = AppState.projects.filter(p => {
        const diff = Math.round((parseDate(p.open) - now) / MS_PER_DAY);
        return diff >= 0 && diff <= 10;
    }).sort((a, b) => new Date(a.open) - new Date(b.open));

    if (!urgent.length) { el.style.display = 'none'; return; }

    const isCollapsed = el.classList.contains('collapsed');
    el.style.display = '';
    el.innerHTML = `
        <div class="alert-banner-header">
            <span class="alert-banner-icon">⚠</span>
            <span class="alert-banner-title">마감 임박 알림 — D-10 이내 <strong>${urgent.length}건</strong></span>
            <div class="alert-banner-actions">
                <button class="alert-banner-toggle" onclick="toggleAlertBanner()">${isCollapsed ? '펼치기' : '접기'}</button>
                <button class="alert-banner-close" onclick="dismissAlertBanner()" title="이 세션 동안 닫기">✕</button>
            </div>
        </div>
        <div class="alert-banner-body${isCollapsed ? ' collapsed' : ''}">
            ${urgent.map(p => {
                const diff = Math.round((new Date(p.open) - now) / MS_PER_DAY);
                const cls = diff <= 7 ? 'urgent' : 'warning';
                const ddayText = diff === 0 ? 'D-Day' : `D-${diff}`;
                return `<div class="alert-item ${cls}" onclick="editProject(${p.id})" title="클릭하여 수정">
                    <span class="alert-dday">${ddayText}</span>
                    <span class="alert-name">${escapeHtml(p.name)}</span>
                    <span class="alert-team">${escapeHtml(p.team)}</span>
                    <span class="alert-open">${fmtD(p.open)}</span>
                </div>`;
            }).join('')}
        </div>`;
}

// ── Partial-update caches ──────────────────────────────────────────────────────
const _ganttCache = new Map(); // projId -> { el, sig }
const _cardCache  = new Map(); // projId -> { el, sig }
const _listCache  = new Map(); // projId -> { el, sig, idx }

function _sortForGantt(projects, now) {
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const openTime = p => {
        const d = parseDate(p.open);
        return d && !isNaN(d) ? d.getTime() : Number.MAX_SAFE_INTEGER;
    };
    const fallback = (a, b) =>
        String(a.name || '').localeCompare(String(b.name || ''), 'ko') ||
        String(a.id || '').localeCompare(String(b.id || ''));

    return projects.slice().sort((a, b) => {
        const aOpen = openTime(a);
        const bOpen = openTime(b);
        const aDone = aOpen < today.getTime();
        const bDone = bOpen < today.getTime();

        if (aDone !== bDone) return aDone ? 1 : -1;

        const dateDiff = aOpen - bOpen;
        if (dateDiff !== 0) return aDone ? -dateDiff : dateDiff;
        return fallback(a, b);
    });
}

// Signature captures all fields that affect rendering, plus date and theme
function _projSig(p) {
    return document.documentElement.getAttribute('data-theme') + '|' +
           AppState.currentYear + '|' +
           new Date().toDateString() + '|' +
           JSON.stringify(p);
}

// ── Element builders ───────────────────────────────────────────────────────────

function _buildGanttRowEl(p, rowIdx) {
    const styles = getStyleSet(p.team);
    const div = document.createElement('div');
    div.className = 'gantt-row';
    div.dataset.team = p.team;
    div.dataset.projId = p.id;
    div.style.animation = `fadeSlideLeft 0.38s ${rowIdx * 40}ms ease both`;
    div.title = '더블클릭하여 수정';
    div.addEventListener('dblclick', (e) => {
        if (e.target.closest('.phase-bar')) return;
        editProject(p.id);
    });
    div.innerHTML = `
        <div class="project-info">
            <span class="team-tag ${styles.light}">${escapeHtml(p.team)}</span>
            <div class="project-name">${escapeHtml(p.name)}</div>
            <div class="project-meta">
                <span class="project-meta-sep">·</span>
                ${p.part ? `<span class="pm-val">${escapeHtml(p.part)}</span><span class="project-meta-sep">·</span>` : ''}
                <span>담당자 <span class="pm-val">${escapeHtml(p.pm)}</span></span>
            </div>
        </div>
        <div class="bar-area">${buildBarAreaHtml(p)}</div>`;
    return div;
}

function _buildCardHtml(p, cardIdx, q, now) {
    const styles = getStyleSet(p.team);
    const openDate = new Date(p.open);

    let activePhase = p.phaseDetails.find(pd => {
        const s = parseDate(pd.start); const e = parseDate(pd.end); e.setHours(23,59,59);
        return now >= s && now <= e;
    });
    let displayPhase = activePhase;
    let isGap = false;
    if (!displayPhase && now >= parseDate(p.phaseDetails[0]?.start) && now < openDate) {
        displayPhase = p.phaseDetails.find(pd => parseDate(pd.start) > now);
        if (displayPhase) isGap = true;
    }

    let statusBg, statusFg, statusTxt;
    if (activePhase) {
        statusBg='#dbeafe'; statusFg='#1d4ed8';
        statusTxt = escapeHtml((activePhase.name.split(':')[1]||activePhase.name).trim()) + ' 진행중';
    } else if (now < parseDate(p.phaseDetails[0]?.start)) {
        statusBg='#f1f5f9'; statusFg='#64748b'; statusTxt='착수 준비중';
    } else if (now >= openDate) {
        statusBg='#d1fae5'; statusFg='#065f46'; statusTxt='개발 완료';
    } else if (isGap && displayPhase) {
        statusBg='#ede9fe'; statusFg='#5b21b6';
        statusTxt = escapeHtml((displayPhase.name.split(':')[1]||displayPhase.name).trim()) + ' 준비중';
    } else {
        statusBg='#ede9fe'; statusFg='#5b21b6'; statusTxt='오픈 준비중';
    }

    const openD = parseDate(p.open);
    const diffDays = Math.round((openD - now) / MS_PER_DAY);
    let ddayText, ddayColor, ddayBg;
    if (diffDays > 0) {
        ddayText = `D-${diffDays}`;
        ddayColor = diffDays <= 7 ? '#dc2626' : diffDays <= 30 ? '#d97706' : '#475569';
        ddayBg    = diffDays <= 7 ? '#fff1f2' : diffDays <= 30 ? '#fff7ed' : '#f1f5f9';
    } else if (diffDays === 0) {
        ddayText = 'D-Day'; ddayColor = '#dc2626'; ddayBg = '#fee2e2';
    } else {
        ddayText = `D+${Math.abs(diffDays)}`; ddayColor = '#94a3b8'; ddayBg = '#f1f5f9';
    }

    const shownPhase = displayPhase;
    const shownDesc = shownPhase
        ? shownPhase.desc.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\r?\n/g,'<br>') : '';
    const shownLabel = isGap ? '예정' : '단계';

    const phaseSection = shownPhase ? `
        <hr class="card-divider">
        <div class="card-phase-row">
            <span class="card-phase-name">${escapeHtml((shownPhase.name.split(':')[1]||shownPhase.name).trim())}</span><span style="font-size:0.62rem;color:#94a3b8;font-weight:600;margin:0 5px 0 0;">${shownLabel}</span>
            <span class="card-phase-date">${fmtD(shownPhase.start)} ~ ${fmtD(shownPhase.end)}</span>
        </div>
        ${shownDesc ? `<div class="card-phase-desc" style="margin-top:4px;">${shownDesc}</div>` : ''}` : '';

    const tagsHtml = (p.tags?.length) ? `<div class="card-tags">${p.tags.map(tid => {
        const tag = PRESET_TAGS.find(t => t.id === tid);
        return tag ? `<span class="tag-badge" style="background:${tag.bg};color:${tag.fg};">${tag.label}</span>` : '';
    }).join('')}</div>` : '';

    let totalMonthsStr = '-';
    let _earliest = null, _latest = null;
    if (p.phaseDetails && p.phaseDetails.length > 0) {
        const starts = p.phaseDetails.map(pd => parseDate(pd.start)).filter(d => !isNaN(d));
        const ends   = p.phaseDetails.map(pd => parseDate(pd.end)).filter(d => !isNaN(d));
        if (starts.length && ends.length) {
            _earliest = new Date(Math.min(...starts));
            const phaseLatest = new Date(Math.max(...ends));
            const openDate2 = new Date(p.open);
            _latest = openDate2 > phaseLatest ? openDate2 : phaseLatest;
            const months = (_latest.getFullYear() - _earliest.getFullYear()) * 12 + (_latest.getMonth() - _earliest.getMonth()) + 1;
            totalMonthsStr = `${months}개월`;
        }
    }
    const periodLine = (() => {
        if (!_earliest || !_latest) return '';
        return `<div style="margin-top:3px;font-size:0.68rem;color:#94a3b8;font-weight:500;display:flex;align-items:center;gap:5px;flex-wrap:wrap;"><span style="font-size:0.6rem;font-weight:700;background:#e2e8f0;color:#64748b;padding:1px 5px;border-radius:3px;white-space:nowrap;">총 개발기간</span>${fmtD(_earliest.toISOString().slice(0,10))} ~ ${fmtD(_latest.toISOString().slice(0,10))}<span style="font-size:0.6rem;font-weight:700;background:#dbeafe;color:#1d4ed8;padding:1px 6px;border-radius:3px;white-space:nowrap;">${totalMonthsStr}</span><span style="font-size:0.6rem;font-weight:700;background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:3px;white-space:nowrap;">오픈 ${fmtD(p.open)}</span></div>`;
    })();

    const clientRow = p.clientDept
        ? `<span class="card-meta-item"><span class="card-meta-label" style="background:#e2e8f0;color:#475569;">의뢰부서</span><span class="card-meta-value">${hl(p.clientDept, q)}</span></span>` : '';

    const ambientRgba = hexToRgba(statusBg, 0.09);
    return `<div class="project-card" data-proj-id="${p.id}" style="border-left-color:${styles.hex};background:linear-gradient(150deg,${ambientRgba} 0%,white 38%);animation:cardFadeIn 0.35s ease forwards;animation-delay:${cardIdx * 50}ms" ondblclick="editProject(${p.id})">
        <div class="card-chk-wrap">
            <input type="checkbox" class="card-row-chk" data-id="${p.id}" onchange="onCardChkChange(this)" title="선택">
        </div>

        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
            <span class="team-tag ${styles.light}">${hl(p.team, q)}</span>
            <div style="display:flex;align-items:center;gap:4px;">
                <span class="dday-badge" style="background:${ddayBg};color:${ddayColor};">${ddayText}</span>
                <span class="status-tag" style="background:${statusBg};color:${statusFg};">${statusTxt}</span>
            </div>
        </div>

        <div class="card-proj-name" style="font-weight:900;font-size:0.95rem;color:var(--text-main);line-height:1.3;">${hl(p.name, q)}</div>
        ${tagsHtml}
        ${periodLine}

        ${phaseSection}

        <hr class="card-divider">
        <div class="card-meta-row">
            <span class="card-meta-item">
                <span class="card-meta-label" style="background:#e2e8f0;color:#475569;">파트</span>
                <span class="card-meta-value">${p.part ? hl(p.part, q) : hl(p.team, q)}</span>
            </span>
            <span class="card-meta-item">
                <span class="card-meta-label" style="background:#e2e8f0;color:#475569;">담당자</span>
                <span class="card-meta-value">${hl(p.pm, q)}</span>
            </span>
            ${clientRow}
        </div>
    </div>`;
}

function _buildCardEl(p, cardIdx, q, now) {
    const tmp = document.createElement('div');
    tmp.innerHTML = _buildCardHtml(p, cardIdx, q, now);
    return tmp.firstElementChild;
}

function _buildListRowHtml(p, idx, q, now) {
    const { text: ddayTxt, cls: ddayCls } = calcDDay(p.open, now);
    const diff = Math.round((new Date(p.open) - now) / MS_PER_DAY);
    const openCls = diff < 0 ? 'open-past' : diff <= 30 ? 'open-soon' : 'open-future';
    const { periodStart, periodEnd, durStr } = calcDuration(p);
    const curPhase = calcCurPhase(p, now);

    const v = AppState.listColVisible;
    const td = (key, html) => v[key] ? `<td>${html}</td>` : '';
    return `<tr data-proj-id="${p.id}" ondblclick="editProject(${p.id})" title="더블클릭하여 수정">
        <td style="text-align:center;"><input type="checkbox" class="list-row-chk" data-id="${p.id}" onchange="onListChkChange()" style="cursor:pointer;width:14px;height:14px;accent-color:#ef4444;"></td>
        ${td('no',`<span class="list-no-num">${idx+1}</span>`)}
        ${td('name',`<span class="list-td-name">${hl(p.name, q)}</span>`)}
        ${td('team',`<span class="list-team-tag">${hl(p.team, q)}</span>`)}
        ${td('part',p.part ? hl(p.part, q) : '<span style="color:#BBBBBB;">—</span>')}
        ${td('pm',hl(p.pm, q))}
        ${td('client',hl(p.clientDept||'', q))}
        ${td('period',`<span class="list-period">${periodStart} ~ ${periodEnd}</span>`)}
        ${td('duration',`<span class="list-duration">${durStr}</span>`)}
        ${td('dday',`<span class="dday-badge ${ddayCls}">${ddayTxt}</span>`)}
        ${td('open',`<span class="dday-badge ${openCls}">${fmtD(p.open)}</span>`)}
        ${td('phase',`<span class="list-phase">${escapeHtml(curPhase)}</span>`)}
        ${td('tags', (p.tags?.length ? p.tags.map(tid => { const tag = PRESET_TAGS.find(t=>t.id===tid); return tag ? `<span class="tag-badge" style="background:${tag.bg};color:${tag.fg};">${tag.label}</span>` : ''; }).join(' ') : '<span style="color:#ccc;">—</span>'))}
    </tr>`;
}

function _buildListRowEl(p, idx, q, now) {
    const tmp = document.createElement('tbody');
    tmp.innerHTML = _buildListRowHtml(p, idx, q, now);
    return tmp.firstElementChild;
}

// ── Reconcilers ────────────────────────────────────────────────────────────────

function _reconcileGantt(container, filtered) {
    const newIds = new Set(filtered.map(p => p.id));

    for (const [id, entry] of _ganttCache) {
        if (!newIds.has(id)) { entry.el.remove(); _ganttCache.delete(id); }
    }

    [...container.children].forEach(el => { if (!el.dataset.projId) el.remove(); });

    filtered.forEach((p, rowIdx) => {
        const sig = _projSig(p);
        let entry = _ganttCache.get(p.id);
        if (!entry || entry.sig !== sig) {
            const el = _buildGanttRowEl(p, rowIdx);
            if (entry) entry.el.remove();
            entry = { el, sig };
            _ganttCache.set(p.id, entry);
        }
        container.appendChild(entry.el);
    });
}

function _reconcileCards(container, filtered, q, now) {
    const newIds = new Set(filtered.map(p => p.id));

    for (const [id, entry] of _cardCache) {
        if (!newIds.has(id)) { entry.el.remove(); _cardCache.delete(id); }
    }

    [...container.children].forEach(el => { if (!el.dataset.projId) el.remove(); });

    filtered.forEach((p, cardIdx) => {
        const sig = _projSig(p) + '|' + q;
        let entry = _cardCache.get(p.id);
        if (!entry || entry.sig !== sig) {
            const el = _buildCardEl(p, cardIdx, q, now);
            if (entry) entry.el.remove();
            entry = { el, sig };
            _cardCache.set(p.id, entry);
        }
        container.appendChild(entry.el);
    });
}

function _reconcileList(tbody, sorted, q, now) {
    const newIds = new Set(sorted.map(p => p.id));

    for (const [id, entry] of _listCache) {
        if (!newIds.has(id)) { entry.el.remove(); _listCache.delete(id); }
    }

    [...tbody.children].forEach(el => { if (!el.dataset.projId) el.remove(); });

    sorted.forEach((p, idx) => {
        const sig = _projSig(p) + '|' + q + '|' + JSON.stringify(AppState.listColVisible);
        let entry = _listCache.get(p.id);
        if (!entry || entry.sig !== sig) {
            const el = _buildListRowEl(p, idx, q, now);
            if (entry) entry.el.remove();
            entry = { el, sig, idx };
            _listCache.set(p.id, entry);
        } else if (entry.idx !== idx) {
            const noCell = entry.el.querySelector('.list-no-num');
            if (noCell) noCell.textContent = idx + 1;
            entry.idx = idx;
        }
        tbody.appendChild(entry.el);
    });
}

// ── Dashboard render ───────────────────────────────────────────────────────────

function renderDashboard() {
    renderAlertBanner();

    const q = AppState.currentSearch.toLowerCase();

    // 팀 필터 (서버가 이미 연도 필터 완료 → 클라이언트 중복 불필요)
    const teamFiltered = AppState.currentFilter === '전체'
        ? AppState.projects
        : AppState.projects.filter(p => p.team === AppState.currentFilter);

    renderTagFilter(teamFiltered);
    updateTeamFilterCounts();

    const filtered = teamFiltered
        .filter(p => !AppState.currentTagFilter || (p.tags || []).includes(AppState.currentTagFilter))
        .filter(p => !q || [p.name, p.pm, p.team, p.part||'', p.clientDept||'',
            ...(p.phaseDetails||[]).map(pd => pd.name||''),
            ...(p.tags||[]).map(tid => PRESET_TAGS.find(t => t.id === tid)?.label || tid)
        ].some(v => v.toLowerCase().includes(q)))
        .slice().sort((a, b) => new Date(a.open) - new Date(b.open));

    const gc = document.getElementById('gantt-rows');
    if (gc) {
        gc.classList.remove('gantt-comfortable', 'gantt-compact');
        if (AppState.density === 'comfortable') gc.classList.add('gantt-comfortable');
        if (AppState.density === 'compact')     gc.classList.add('gantt-compact');
    }
    const now = new Date();
    const todayMidnight = new Date(now); todayMidnight.setHours(0,0,0,0);
    const ganttSorted = _sortForGantt(filtered, now);

    const statCount   = filtered.length;
    const statOngoing = filtered.filter(p => new Date(p.open) > todayMidnight).length;
    const statDone    = filtered.filter(p => new Date(p.open) <= todayMidnight).length;
    const statEarly   = filtered.filter(p => { const d = new Date(p.open); return d.getFullYear() === AppState.currentYear && d.getMonth() < 6; }).length;
    document.getElementById('detail-count').innerText = `총 ${statCount.toLocaleString()}건`;
    _countUp('stat-count',     statCount,   v => `${Math.round(v).toLocaleString()}건`, statCount   === 0 ? '#94a3b8' : 'var(--primary)');
    _countUp('stat-ongoing',   statOngoing, v => `${Math.round(v).toLocaleString()}건`, statOngoing === 0 ? '#94a3b8' : 'var(--blue)');
    _countUp('stat-done',      statDone,    v => `${Math.round(v).toLocaleString()}건`, statDone    === 0 ? '#94a3b8' : 'var(--emerald)');
    _countUp('stat-early-open', statEarly,  v => `${Math.round(v).toLocaleString()}건`, statEarly   === 0 ? '#94a3b8' : 'var(--emerald)');

    const todayPos = now.getFullYear() === AppState.currentYear ? getDatePos(now) : null;
    let monthHtml = Array.from({length: 12}, (_, i) => {
        const daysInMonth = new Date(AppState.currentYear, i + 1, 0).getDate();
        const ticks = [];
        for (let d = 7; d < daysInMonth; d += 7) {
            const pct = (d / daysInMonth * 100).toFixed(2);
            const isMid = Math.abs(d - Math.round(daysInMonth / 2)) <= 3;
            ticks.push(`<div class="week-tick${isMid ? ' mid' : ''}" style="left:${pct}%"></div>`);
        }
        const isCurrentMonth = now.getFullYear() === AppState.currentYear && now.getMonth() === i;
        return `<div class="month-cell${isCurrentMonth ? ' current-month-col' : ''}"><span class="month-label">${i+1}월</span><div class="week-ticks">${ticks.join('')}</div></div>`;
    }).join('');
    if (todayPos !== null) monthHtml += `<div class="today-line" style="left: ${todayPos}%;"><div class="today-dot"></div></div>`;
    document.getElementById('month-header').innerHTML = monthHtml;

    const emptyHtml = (msg) => `<div class="empty-state">
        <div class="empty-state-icon"></div>
        <div class="empty-state-title">${msg}</div>
        <div class="empty-state-desc">필터 조건을 변경하거나 검색어를 확인해 주세요.</div>
        <button class="empty-state-btn" onclick="setFilter('전체');document.getElementById('search-input').value='';setSearch('');">전체 보기로 돌아가기</button>
    </div>`;

    const ganttContainer = document.getElementById('gantt-rows');
    const cardContainer  = document.getElementById('card-grid');

    if (!filtered.length) {
        const msg = AppState.currentSearch ? `'${AppState.currentSearch}' 검색 결과가 없습니다` : `${AppState.currentFilter} 팀의 프로젝트가 없습니다`;
        _ganttCache.forEach(({el}) => { if (el.parentNode) el.remove(); });
        _cardCache.forEach(({el}) => { if (el.parentNode) el.remove(); });
        ganttContainer.innerHTML = emptyHtml(msg);
        cardContainer.innerHTML  = emptyHtml(msg);
        if (AppState.currentView === 'list') {
            _listCache.forEach(({el}) => { if (el.parentNode) el.remove(); });
            document.getElementById('list-view').innerHTML = emptyHtml(msg);
        }
        return;
    }

    requestAnimationFrame(() => {
        _reconcileGantt(ganttContainer, ganttSorted);
        _reconcileCards(cardContainer, filtered, q, now);
        if (AppState.currentView === 'list') renderListView(filtered, now);
        requestAnimationFrame(() => { autoFitBarFonts(); autoFitCardTitles(); drawDepLines(); });
    });
}

/* ── 목록뷰 렌더 ── */
function renderListView(filtered, now) {
    const q = AppState.currentSearch.toLowerCase();
    const container = document.getElementById('list-view');

    if (!filtered.length) {
        _listCache.forEach(({el}) => { if (el.parentNode) el.remove(); });
        container.innerHTML = '<div class="list-no-data">조회된 프로젝트가 없습니다. 검색어 또는 필터 조건을 확인해 주세요.</div>';
        return;
    }

    let sorted = filtered.slice();
    if (AppState.listSortCol) {
        const col = LIST_COLS.find(c => c.key === AppState.listSortCol);
        if (col?.sortFn) sorted.sort((a,b) => AppState.listSortDir * col.sortFn(a, b));
    }

    const sortClass = key => {
        if (AppState.listSortCol !== key) return '';
        return AppState.listSortDir === 1 ? ' asc' : ' desc';
    };
    const th = (key, label, sortable=true) => {
        if (!AppState.listColVisible[key]) return '';
        const col = LIST_COLS.find(c=>c.key===key);
        const canSort = sortable && col?.sortFn;
        return canSort
            ? `<th class="list-th-sort${sortClass(key)}" onclick="sortListBy('${key}')">${label}</th>`
            : `<th>${label}</th>`;
    };

    const theadHtml = `<tr>
        <th style="width:32px;"><input type="checkbox" id="list-chk-all" onchange="toggleAllListChk(this.checked)" style="cursor:pointer;width:14px;height:14px;accent-color:#ef4444;"></th>
        ${th('no','No',false)}
        ${th('name','프로젝트명')}
        ${th('team','팀명')}
        ${th('part','담당파트')}
        ${th('pm','담당자')}
        ${th('client','의뢰부서')}
        ${th('period','개발기간(시작~종료)',false)}
        ${th('duration','총개발기간',false)}
        ${th('dday','D-Day')}
        ${th('open','적용예정일')}
        ${th('phase','현재단계',false)}
        ${th('tags','태그',false)}
    </tr>`;

    let table = container.querySelector('table.list-table');
    if (!table) {
        table = document.createElement('table');
        table.className = 'list-table';
        container.innerHTML = '';
        container.appendChild(table);
    }

    let thead = table.querySelector('thead');
    if (!thead) { thead = document.createElement('thead'); table.insertBefore(thead, table.firstChild); }
    thead.innerHTML = theadHtml;

    let tbody = table.querySelector('tbody');
    if (!tbody) { tbody = document.createElement('tbody'); table.appendChild(tbody); }

    _reconcileList(tbody, sorted, q, now);
}

function sortListBy(key) {
    if (AppState.listSortCol === key) AppState.listSortDir *= -1;
    else { AppState.listSortCol = key; AppState.listSortDir = 1; }
    renderDashboard();
}

function toggleColPanel() {
    const panel = document.getElementById('col-panel');
    const wrap  = document.getElementById('col-panel-wrap');
    if (panel.classList.contains('open')) {
        panel.classList.remove('open');
        return;
    }
    panel.innerHTML = LIST_COLS.filter(c=>c.key!=='no').map(c=>`
        <label>
            <input type="checkbox" ${AppState.listColVisible[c.key]?'checked':''} onchange="toggleListCol('${c.key}',this.checked)">
            ${c.label}
        </label>`).join('');
    panel.classList.add('open');
    setTimeout(()=>{
        const close = e=>{ if(!wrap.contains(e.target)){ panel.classList.remove('open'); document.removeEventListener('click',close); }};
        document.addEventListener('click', close);
    }, 0);
}

function toggleListCol(key, visible) {
    AppState.listColVisible[key] = visible;
    renderDashboard();
}

function autoFitCardTitles() {
    const els = [...document.querySelectorAll('.card-proj-name')];
    if (!els.length) return;

    // 1단계 — 쓰기: 폰트 크기 초기화
    els.forEach(el => { el.style.fontSize = ''; });

    // 2단계 — 읽기: 초기 scrollHeight / lineHeight 일괄 측정 (reflow 1회)
    const MIN_FS = 11;
    const toShrink = els.map(el => {
        const fs = parseFloat(getComputedStyle(el).fontSize);
        const lh = parseFloat(getComputedStyle(el).lineHeight);
        const fits = el.scrollHeight <= Math.ceil(lh) + 2;
        return { el, fs, fits };
    }).filter(d => !d.fits && d.fs > MIN_FS)
      .map(d => ({ el: d.el, lo: MIN_FS, hi: d.fs }));

    if (!toShrink.length) return;

    // 3단계 — 이진탐색 7회: 쓰기 전부 후 읽기 전부 → reflow 7회 (카드 수와 무관)
    for (let iter = 0; iter < 7; iter++) {
        toShrink.forEach(item => {
            item.mid = (item.lo + item.hi) / 2;
            item.el.style.fontSize = item.mid + 'px';
        });
        toShrink.forEach(item => {
            const lh = parseFloat(getComputedStyle(item.el).lineHeight);
            if (item.el.scrollHeight <= Math.ceil(lh) + 2) item.lo = item.mid;
            else item.hi = item.mid;
        });
    }

    // 4단계 — 쓰기: 최종 폰트 크기 일괄 적용
    toShrink.forEach(item => { item.el.style.fontSize = item.lo + 'px'; });
}

function autoFitBarFonts() {
    const bars = [...document.querySelectorAll('.phase-bar')];
    if (!bars.length) return;

    const maxRem = AppState.density === 'compact' ? 0.9 : 1.0;
    const minRem = 0.44;

    // 1단계 — 쓰기: 스타일 초기화 및 3일 이하 숨김, 후보 수집
    const toFit = [];
    bars.forEach(bar => {
        const days = (bar.dataset.start && bar.dataset.end)
            ? Math.round((new Date(bar.dataset.end) - new Date(bar.dataset.start)) / 86400000) + 1
            : Infinity;
        if (days <= 3) {
            bar.style.fontSize = '0';
            bar.style.padding  = '0';
            return;
        }
        bar.style.fontSize = '';
        bar.style.padding  = '';
        if (AppState.density !== 'comfortable') toFit.push(bar);
    });

    if (!toFit.length) return;

    // 2단계 — 쓰기: 전체를 maxRem으로 설정
    toFit.forEach(bar => { bar.style.fontSize = maxRem + 'rem'; });

    // 3단계 — 읽기: maxRem에서 넘치는 막대 추출 (reflow 1회)
    const needShrink = toFit.filter(bar => bar.clientWidth > 0 && bar.scrollWidth > bar.clientWidth);
    if (!needShrink.length) return;

    // 4단계 — 쓰기: minRem으로 설정
    needShrink.forEach(bar => { bar.style.fontSize = minRem + 'rem'; });

    // 5단계 — 읽기: minRem에서도 넘치면 ellipsis로 두고 이진탐색 대상만 추출 (reflow 1회)
    const bsItems = needShrink
        .filter(bar => bar.scrollWidth <= bar.clientWidth)
        .map(bar => ({ bar, lo: minRem, hi: maxRem }));
    if (!bsItems.length) return;

    // 6단계 — 이진탐색 7회: 쓰기를 전부 먼저, 읽기를 전부 나중에 → reflow 7회 (막대 수와 무관)
    for (let iter = 0; iter < 7; iter++) {
        bsItems.forEach(item => {
            item.mid = (item.lo + item.hi) / 2;
            item.bar.style.fontSize = item.mid + 'rem';
        });
        bsItems.forEach(item => {
            if (item.bar.scrollWidth <= item.bar.clientWidth) item.lo = item.mid;
            else item.hi = item.mid;
        });
    }

    // 7단계 — 쓰기: 최종 폰트 크기 일괄 적용
    bsItems.forEach(item => { item.bar.style.fontSize = item.lo + 'rem'; });
}

// ── 일괄 등록 그리드 ────────────────────────────
