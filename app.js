/* ============================================================
   수요예측 시스템 · Demand Forecast Studio
   ============================================================ */

const STATE = {
  rawSheets: null,         // { sheetName: { rows, numericCols } }
  activeSheet: null,
  valueColumn: null,
  series: null,            // [{ date, value, year, month }]
  fileName: '',
  selectedModels: ['hw'],
  period: 12,
  output: 'point',         // 'point' | 'interval' | 'both'
  ciLevel: 95,
  showEnsemble: true,
  params: { maWindow: 12, alpha: 0.30, beta: 0.10, gamma: 0.30 },
  forecast: null,
  hoverIdx: null,
};

const MODELS = {
  ma: {
    key: 'ma', name: '이동평균', short: 'MA',
    color: '#22d3ee',
    desc: '최근 N개월의 단순 평균을 미래 값으로 사용합니다.',
    when: '추세와 계절성이 약하고 데이터가 평탄할 때',
    pros: '계산이 단순하고 노이즈에 강건',
    cons: '추세나 계절성을 반영하지 못함',
  },
  lt: {
    key: 'lt', name: '선형 추세', short: 'LT',
    color: '#a78bfa',
    desc: '전체 기간에 선형 회귀선을 적합시켜 외삽합니다.',
    when: '명확한 장기 성장(또는 감소) 추세가 있을 때',
    pros: '장기 트렌드를 직접적으로 반영',
    cons: '계절성과 변동성을 무시, 외삽 오류 가능성',
  },
  es: {
    key: 'es', name: '지수평활', short: 'ES',
    color: '#f472b6',
    desc: '최근값에 더 큰 가중치(α)를 부여하는 가중 평균입니다.',
    when: '단기 변동에 빠르게 반응해야 할 때',
    pros: '최근 변화 반영, 파라미터 조정 용이',
    cons: '추세·계절성 미반영, 평탄한 예측',
  },
  hw: {
    key: 'hw', name: 'Holt-Winters', short: 'HW',
    color: '#fbbf24',
    desc: '레벨·추세·계절성 세 성분을 함께 평활하는 가법형 모형입니다.',
    when: '월별 패턴이 강하고 추세도 있는 시계열',
    pros: '계절성과 추세를 모두 포착',
    cons: '파라미터 3개(α,β,γ) 튜닝 필요',
  },
  sn: {
    key: 'sn', name: '계절성 단순', short: 'SN',
    color: '#34d399',
    desc: '예측 시점의 1년 전 값을 그대로 사용합니다.',
    when: '강한 계절성, 추세는 약할 때',
    pros: '단순하지만 계절성에 효과적',
    cons: '추세 변화에 둔감',
  },
};

const ENSEMBLE_COLOR = '#ffffff';

/* ============================================================
   1. 예측 모형 함수
   ============================================================ */
function movingAverage(s, periods, win) {
  const w = win || STATE.params.maWindow;
  const out = [];
  const ext = [...s];
  for (let i = 0; i < periods; i++) {
    const slice = ext.slice(-w);
    const v = slice.reduce((a, b) => a + b, 0) / slice.length;
    out.push(v);
    ext.push(v);
  }
  return out;
}
function linearTrend(s, periods) {
  const n = s.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += s[i]; sumXY += i * s[i]; sumXX += i * i;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  const out = [];
  for (let h = 0; h < periods; h++) out.push(slope * (n + h) + intercept);
  return out;
}
function exponentialSmoothing(s, periods, alpha) {
  const a = alpha != null ? alpha : STATE.params.alpha;
  const sm = [s[0]];
  for (let i = 1; i < s.length; i++) sm.push(a * s[i] + (1 - a) * sm[i - 1]);
  return Array(periods).fill(sm[sm.length - 1]);
}
function holtWinters(s, periods, params) {
  const p = params || STATE.params;
  const seasonLen = 12;
  const n = s.length;
  if (n < 2 * seasonLen) return linearTrend(s, periods);
  const initLevel = s.slice(0, seasonLen).reduce((a, b) => a + b, 0) / seasonLen;
  const nextMean = s.slice(seasonLen, 2 * seasonLen).reduce((a, b) => a + b, 0) / seasonLen;
  const initTrend = (nextMean - initLevel) / seasonLen;
  const initSeasonal = s.slice(0, seasonLen).map(v => v - initLevel);
  const L = [initLevel], T = [initTrend], S = [...initSeasonal];
  for (let i = 0; i < n; i++) {
    if (i >= seasonLen) {
      const pL = L[L.length - 1], pT = T[T.length - 1], pS = S[i - seasonLen];
      const nL = p.alpha * (s[i] - pS) + (1 - p.alpha) * (pL + pT);
      const nT = p.beta * (nL - pL) + (1 - p.beta) * pT;
      const nS = p.gamma * (s[i] - nL) + (1 - p.gamma) * pS;
      L.push(nL); T.push(nT); S.push(nS);
    }
  }
  const out = [];
  const lastL = L[L.length - 1], lastT = T[T.length - 1];
  for (let h = 1; h <= periods; h++) {
    const sIdx = S.length - seasonLen + ((h - 1) % seasonLen);
    out.push(lastL + h * lastT + S[sIdx]);
  }
  return out;
}
function seasonalNaive(s, periods) {
  const seasonLen = 12;
  const out = [];
  for (let h = 0; h < periods; h++) {
    out.push(s[s.length - seasonLen + (h % seasonLen)]);
  }
  return out;
}
const MODEL_FN = {
  ma: movingAverage,
  lt: linearTrend,
  es: exponentialSmoothing,
  hw: holtWinters,
  sn: seasonalNaive,
};

/* 백테스트(MAPE) 및 잔차(예측 구간용) */
function backtestMape(series, key, holdout = 12) {
  if (series.length <= holdout + 12) return null;
  const train = series.slice(0, -holdout);
  const test = series.slice(-holdout);
  const pred = MODEL_FN[key](train, holdout);
  let sum = 0, count = 0;
  for (let i = 0; i < holdout; i++) {
    if (test[i] === 0) continue;
    sum += Math.abs((test[i] - pred[i]) / test[i]);
    count++;
  }
  return count > 0 ? (sum / count) * 100 : null;
}
function residualStd(series, key) {
  // 1-step-ahead 예측 잔차의 표준편차 (간이)
  const n = series.length;
  if (n < 24) return Math.std ? 0 : 0;
  const residuals = [];
  for (let i = 12; i < n; i++) {
    const train = series.slice(0, i);
    const pred = MODEL_FN[key](train, 1);
    residuals.push(series[i] - pred[0]);
  }
  if (residuals.length < 2) return 0;
  const mean = residuals.reduce((a, b) => a + b, 0) / residuals.length;
  const variance = residuals.reduce((s, r) => s + (r - mean) ** 2, 0) / (residuals.length - 1);
  return Math.sqrt(variance);
}

/* ============================================================
   2. 전체 예측 계산
   ============================================================ */
function computeForecast() {
  if (!STATE.series || STATE.series.length < 24) return null;
  const values = STATE.series.map(d => d.value);
  const last = STATE.series[STATE.series.length - 1];
  const periods = STATE.period;

  // 미래 라벨
  const futureLabels = [];
  for (let i = 1; i <= periods; i++) {
    const total = last.month + i;
    const y = last.year + Math.floor((total - 1) / 12);
    const m = ((total - 1) % 12) + 1;
    futureLabels.push({ year: y, month: m, date: `${y}-${String(m).padStart(2, '0')}` });
  }

  // 각 모형 예측 + 잔차
  const z = STATE.ciLevel === 95 ? 1.96 : 1.28;
  const predictions = {};
  const accuracies = {};
  const stds = {};
  STATE.selectedModels.forEach(key => {
    predictions[key] = MODEL_FN[key](values, periods);
    accuracies[key] = backtestMape(values, key);
    stds[key] = residualStd(values, key);
  });

  // 앙상블
  if (STATE.showEnsemble && STATE.selectedModels.length >= 2) {
    const ens = [];
    for (let i = 0; i < periods; i++) {
      let s = 0;
      STATE.selectedModels.forEach(k => s += predictions[k][i]);
      ens.push(s / STATE.selectedModels.length);
    }
    predictions.ensemble = ens;
    // 앙상블 잔차: 모형별 std의 평균/sqrt(N)으로 근사 (간이)
    const stdsArr = STATE.selectedModels.map(k => stds[k]);
    stds.ensemble = (stdsArr.reduce((a, b) => a + b, 0) / stdsArr.length) / Math.sqrt(STATE.selectedModels.length);
  }

  // 신뢰구간 적용
  const intervals = {};
  Object.keys(predictions).forEach(k => {
    intervals[k] = predictions[k].map((v, i) => {
      // 시간이 멀어질수록 불확실성 증가 (sqrt(h))
      const margin = z * stds[k] * Math.sqrt(i + 1);
      return { lower: v - margin, upper: v + margin };
    });
  });

  return { values, futureLabels, predictions, accuracies, intervals, stds, last };
}

/* ============================================================
   3. SVG 차트 (주식차트 스타일)
   ============================================================ */
function renderChart() {
  const svg = document.getElementById('chart-svg');
  svg.innerHTML = '';
  if (!STATE.forecast) return;

  const W = svg.clientWidth || 1200;
  const H = 480;
  const M = { top: 30, right: 60, bottom: 50, left: 80 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

  // 모든 데이터 포인트 (실측 + 예측)
  const allPoints = [
    ...STATE.series.map(d => ({ ...d, type: 'actual' })),
    ...STATE.forecast.futureLabels.map((d, i) => {
      const point = { ...d, type: 'forecast', idx: i };
      STATE.selectedModels.forEach(k => {
        point[k] = STATE.forecast.predictions[k][i];
        point[k + '_lo'] = STATE.forecast.intervals[k][i].lower;
        point[k + '_hi'] = STATE.forecast.intervals[k][i].upper;
      });
      if (STATE.forecast.predictions.ensemble) {
        point.ensemble = STATE.forecast.predictions.ensemble[i];
        point.ensemble_lo = STATE.forecast.intervals.ensemble[i].lower;
        point.ensemble_hi = STATE.forecast.intervals.ensemble[i].upper;
      }
      return point;
    }),
  ];

  // 줌 적용
  const zoomMode = STATE.zoomMode || 'all';
  let visiblePoints = allPoints;
  if (zoomMode === 'recent') {
    visiblePoints = allPoints.slice(-(24 + STATE.period));
  } else if (zoomMode === 'forecast') {
    visiblePoints = allPoints.slice(-Math.min(12, STATE.series.length) - STATE.period);
  }

  // x, y 스케일
  const xMin = 0;
  const xMax = visiblePoints.length - 1;
  let yMin = Infinity, yMax = -Infinity;
  visiblePoints.forEach(p => {
    if (p.type === 'actual') {
      yMin = Math.min(yMin, p.value);
      yMax = Math.max(yMax, p.value);
    } else {
      STATE.selectedModels.forEach(k => {
        const lo = STATE.output === 'point' ? p[k] : p[k + '_lo'];
        const hi = STATE.output === 'point' ? p[k] : p[k + '_hi'];
        yMin = Math.min(yMin, lo);
        yMax = Math.max(yMax, hi);
      });
      if (p.ensemble != null) {
        const lo = STATE.output === 'point' ? p.ensemble : p.ensemble_lo;
        const hi = STATE.output === 'point' ? p.ensemble : p.ensemble_hi;
        yMin = Math.min(yMin, lo);
        yMax = Math.max(yMax, hi);
      }
    }
  });
  const yPad = (yMax - yMin) * 0.08;
  yMin -= yPad; yMax += yPad;
  if (yMin < 0 && visiblePoints.every(p => p.type === 'forecast' || p.value >= 0)) yMin = 0;

  const xScale = i => M.left + (i / Math.max(xMax, 1)) * innerW;
  const yScale = v => M.top + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

  const ns = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(ns, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    (parent || svg).appendChild(e);
    return e;
  };

  // 그리드 + Y축 라벨
  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const v = yMin + ((yMax - yMin) * i) / yTicks;
    const y = yScale(v);
    el('line', { x1: M.left, x2: W - M.right, y1: y, y2: y, stroke: '#1f2547', 'stroke-dasharray': '2,4', 'stroke-width': 1 });
    el('text', { x: M.left - 8, y: y + 4, fill: '#6b7299', 'font-size': 11, 'text-anchor': 'end', 'font-family': 'JetBrains Mono' }).textContent = formatNum(v);
  }

  // X축 라벨
  const labelStep = Math.max(1, Math.floor(visiblePoints.length / 10));
  visiblePoints.forEach((p, i) => {
    if (i % labelStep === 0 || i === visiblePoints.length - 1) {
      const x = xScale(i);
      el('text', { x, y: H - 15, fill: '#6b7299', 'font-size': 10, 'text-anchor': 'middle', 'font-family': 'JetBrains Mono' }).textContent = p.date;
    }
  });

  // 예측 시작점 (수직 점선)
  const forecastStartIdx = visiblePoints.findIndex(p => p.type === 'forecast');
  if (forecastStartIdx > 0) {
    const x = xScale(forecastStartIdx - 0.5);
    el('line', { x1: x, x2: x, y1: M.top, y2: M.top + innerH, stroke: '#f59e0b', 'stroke-dasharray': '4,4', 'stroke-width': 1.5, opacity: 0.6 });
    el('text', { x: x + 6, y: M.top + 14, fill: '#f59e0b', 'font-size': 10, 'font-weight': 600 }).textContent = '▶ 예측 시작';
    // 예측 영역 음영
    const xEnd = xScale(visiblePoints.length - 1) + 20;
    el('rect', { x, y: M.top, width: xEnd - x, height: innerH, fill: '#f59e0b', opacity: 0.03 });
  }

  // 신뢰구간 영역 (interval/both 모드일 때만)
  if (STATE.output === 'interval' || STATE.output === 'both') {
    const modelsToDraw = [
      ...STATE.selectedModels.map(k => ({ key: k, color: MODELS[k].color })),
    ];
    if (STATE.forecast.predictions.ensemble) {
      modelsToDraw.push({ key: 'ensemble', color: ENSEMBLE_COLOR });
    }
    modelsToDraw.forEach(({ key, color }) => {
      const upper = visiblePoints
        .map((p, i) => p.type === 'forecast' ? `${xScale(i)},${yScale(p[key + '_hi'])}` : null)
        .filter(Boolean);
      const lower = visiblePoints
        .map((p, i) => p.type === 'forecast' ? `${xScale(i)},${yScale(p[key + '_lo'])}` : null)
        .filter(Boolean)
        .reverse();
      if (upper.length > 0) {
        // 첫 점은 마지막 실측에서 시작
        const lastActualIdx = forecastStartIdx - 1;
        if (lastActualIdx >= 0) {
          const lastActual = visiblePoints[lastActualIdx];
          upper.unshift(`${xScale(lastActualIdx)},${yScale(lastActual.value)}`);
          lower.push(`${xScale(lastActualIdx)},${yScale(lastActual.value)}`);
        }
        el('polygon', {
          points: [...upper, ...lower].join(' '),
          fill: color, opacity: 0.10, stroke: 'none',
        });
      }
    });
  }

  // 실측 라인
  const actualPath = visiblePoints
    .filter(p => p.type === 'actual')
    .map((p, i) => {
      const idx = visiblePoints.indexOf(p);
      return `${i === 0 ? 'M' : 'L'} ${xScale(idx)} ${yScale(p.value)}`;
    })
    .join(' ');
  el('path', {
    d: actualPath, stroke: '#e2e8f0', 'stroke-width': 2, fill: 'none', 'stroke-linejoin': 'round'
  });

  // 모형별 예측 라인 (point/both 모드)
  if (STATE.output === 'point' || STATE.output === 'both') {
    const drawModelLine = (key, color, isEnsemble = false) => {
      // 마지막 실측에서 시작
      const lastActualIdx = forecastStartIdx - 1;
      const points = [];
      if (lastActualIdx >= 0) {
        const la = visiblePoints[lastActualIdx];
        points.push(`M ${xScale(lastActualIdx)} ${yScale(la.value)}`);
      }
      visiblePoints.forEach((p, i) => {
        if (p.type === 'forecast') {
          points.push(`L ${xScale(i)} ${yScale(p[key])}`);
        }
      });
      if (points.length > 1) {
        el('path', {
          d: points.join(' '),
          stroke: color,
          'stroke-width': isEnsemble ? 3 : 2,
          'stroke-dasharray': isEnsemble ? '0' : '6,4',
          fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
        });
      }
      // 점
      visiblePoints.forEach((p, i) => {
        if (p.type === 'forecast') {
          el('circle', {
            cx: xScale(i), cy: yScale(p[key]),
            r: isEnsemble ? 4 : 3,
            fill: color, stroke: '#0b1023', 'stroke-width': 1.5,
          });
        }
      });
    };

    STATE.selectedModels.forEach(k => drawModelLine(k, MODELS[k].color));
    if (STATE.forecast.predictions.ensemble) {
      drawModelLine('ensemble', ENSEMBLE_COLOR, true);
    }
  }

  // ===== 인터랙션 (호버 크로스헤어) =====
  const crosshairV = el('line', { x1: 0, x2: 0, y1: M.top, y2: M.top + innerH, stroke: '#00e0c6', 'stroke-width': 1, 'stroke-dasharray': '3,3', opacity: 0 });
  const crosshairH = el('line', { x1: M.left, x2: W - M.right, y1: 0, y2: 0, stroke: '#00e0c6', 'stroke-width': 1, 'stroke-dasharray': '3,3', opacity: 0 });
  const hoverCircles = [];

  const overlay = el('rect', {
    x: M.left, y: M.top, width: innerW, height: innerH,
    fill: 'transparent', cursor: 'crosshair'
  });

  const tooltip = document.getElementById('chart-tooltip');

  overlay.addEventListener('mousemove', (e) => {
    const rect = svg.getBoundingClientRect();
    const scaleX = W / rect.width;
    const mouseX = (e.clientX - rect.left) * scaleX;
    const mouseY = (e.clientY - rect.top) * (H / rect.height);

    // 가장 가까운 인덱스 찾기
    let nearestIdx = 0;
    let minDist = Infinity;
    visiblePoints.forEach((_, i) => {
      const d = Math.abs(xScale(i) - mouseX);
      if (d < minDist) { minDist = d; nearestIdx = i; }
    });

    const p = visiblePoints[nearestIdx];
    const xPos = xScale(nearestIdx);

    crosshairV.setAttribute('x1', xPos);
    crosshairV.setAttribute('x2', xPos);
    crosshairV.setAttribute('opacity', 0.5);
    crosshairH.setAttribute('y1', mouseY);
    crosshairH.setAttribute('y2', mouseY);
    crosshairH.setAttribute('opacity', 0.3);

    // 기존 hover circle 제거
    hoverCircles.forEach(c => c.remove());
    hoverCircles.length = 0;

    // 툴팁 내용
    let html = `<div class="font-bold text-[#00e0c6] text-sm mb-1.5 num">${p.date}</div>`;
    if (p.type === 'actual') {
      html += `<div class="flex items-center justify-between gap-4 py-0.5">
        <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-white"></span>실측</span>
        <span class="num font-semibold">${formatNum(p.value)}</span>
      </div>`;
      const c = el('circle', { cx: xPos, cy: yScale(p.value), r: 5, fill: '#fff', stroke: '#00e0c6', 'stroke-width': 2 });
      hoverCircles.push(c);
    } else {
      STATE.selectedModels.forEach(k => {
        const m = MODELS[k];
        html += `<div class="flex items-center justify-between gap-4 py-0.5">
          <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full" style="background:${m.color}"></span>${m.name}</span>
          <span class="num font-semibold" style="color:${m.color}">${formatNum(p[k])}</span>
        </div>`;
        if (STATE.output !== 'point') {
          html += `<div class="text-[10px] text-[var(--text-2)] num pl-3.5">[${formatNum(p[k+'_lo'])} ~ ${formatNum(p[k+'_hi'])}]</div>`;
        }
        const c = el('circle', { cx: xPos, cy: yScale(p[k]), r: 5, fill: m.color, stroke: '#0b1023', 'stroke-width': 2 });
        hoverCircles.push(c);
      });
      if (p.ensemble != null) {
        html += `<div class="flex items-center justify-between gap-4 py-0.5 mt-1 pt-1.5 border-t border-white/10">
          <span class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-white"></span><b>앙상블</b></span>
          <span class="num font-bold text-white">${formatNum(p.ensemble)}</span>
        </div>`;
        if (STATE.output !== 'point') {
          html += `<div class="text-[10px] text-[var(--text-2)] num pl-3.5">[${formatNum(p.ensemble_lo)} ~ ${formatNum(p.ensemble_hi)}]</div>`;
        }
        const c = el('circle', { cx: xPos, cy: yScale(p.ensemble), r: 6, fill: '#fff', stroke: '#0b1023', 'stroke-width': 2 });
        hoverCircles.push(c);
      }
    }

    tooltip.innerHTML = html;
    tooltip.classList.remove('hidden');
    const tooltipW = tooltip.offsetWidth;
    const containerRect = svg.parentElement.getBoundingClientRect();
    let left = (xPos / W) * containerRect.width + 12;
    if (left + tooltipW > containerRect.width) left = (xPos / W) * containerRect.width - tooltipW - 12;
    tooltip.style.left = left + 'px';
    tooltip.style.top = ((mouseY / H) * containerRect.height - 30) + 'px';
  });

  overlay.addEventListener('mouseleave', () => {
    crosshairV.setAttribute('opacity', 0);
    crosshairH.setAttribute('opacity', 0);
    tooltip.classList.add('hidden');
    hoverCircles.forEach(c => c.remove());
    hoverCircles.length = 0;
  });
}

/* ============================================================
   4. UI 렌더링
   ============================================================ */
function formatNum(n) {
  if (n == null || isNaN(n)) return '-';
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(2) + '조';
  if (abs >= 1e8) return (n / 1e8).toFixed(2) + '억';
  if (abs >= 1e4) return (n / 1e4).toFixed(1) + '만';
  return Math.round(n).toLocaleString();
}

function renderModelGrid() {
  const grid = document.getElementById('model-grid');
  grid.innerHTML = '';
  Object.values(MODELS).forEach(m => {
    const checked = STATE.selectedModels.includes(m.key);
    const div = document.createElement('div');
    div.className = `checkbox-card ${checked ? 'checked' : ''}`;
    div.innerHTML = `
      <div class="flex items-center gap-2">
        <div class="w-3 h-3 rounded-full" style="background:${m.color}"></div>
        <div class="text-xs font-semibold flex-1">${m.name}</div>
        ${checked ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${m.color}" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>` : ''}
      </div>
      <div class="text-[10px] text-[var(--text-2)] mt-1">${m.short}</div>
    `;
    div.onclick = () => {
      if (checked) {
        if (STATE.selectedModels.length > 1) {
          STATE.selectedModels = STATE.selectedModels.filter(k => k !== m.key);
        } else {
          showToast('최소 1개 모형은 선택해야 합니다');
          return;
        }
      } else {
        STATE.selectedModels = [...STATE.selectedModels, m.key];
      }
      update();
    };
    grid.appendChild(div);
  });
}

function renderKPI() {
  const grid = document.getElementById('kpi-grid');
  if (!STATE.forecast) { grid.innerHTML = ''; return; }
  const last12 = STATE.forecast.values.slice(-12).reduce((a, b) => a + b, 0);
  const fcKey = STATE.forecast.predictions.ensemble ? 'ensemble' : STATE.selectedModels[0];
  const periodSum = STATE.forecast.predictions[fcKey].reduce((a, b) => a + b, 0);
  // 동기간 비교를 위한 값
  const samePeriodLastYear = STATE.forecast.values.slice(-STATE.period).reduce((a, b) => a + b, 0);
  const yoy = samePeriodLastYear > 0 ? ((periodSum - samePeriodLastYear) / samePeriodLastYear) * 100 : 0;

  let bestKey = null, bestMape = Infinity;
  Object.entries(STATE.forecast.accuracies).forEach(([k, v]) => {
    if (v != null && v < bestMape) { bestMape = v; bestKey = k; }
  });

  const periodLabel = STATE.period === 3 ? '3개월' : STATE.period === 6 ? '6개월' : STATE.period === 12 ? '12개월' : '24개월';

  grid.innerHTML = `
    ${kpiCard('관측 기간', `${STATE.series.length}개월`, `${STATE.series[0].date} ~ ${STATE.forecast.last.date}`, '#00e0c6')}
    ${kpiCard(`최근 ${STATE.period}M 합계`, formatNum(samePeriodLastYear), '직전 동기간', '#a78bfa')}
    ${kpiCard(`예측 ${periodLabel} 합계`, formatNum(periodSum), '앙상블 기준', '#f472b6')}
    ${kpiCard('전기 대비', `${yoy >= 0 ? '+' : ''}${yoy.toFixed(1)}%`, bestKey ? `최우수: ${MODELS[bestKey].name} (${bestMape.toFixed(1)}%)` : '', yoy >= 0 ? '#10b981' : '#ef4444')}
  `;
}
function kpiCard(label, value, sub, color) {
  return `
    <div class="glass rounded-xl p-4">
      <div class="text-[10px] uppercase tracking-widest text-[var(--text-2)] font-semibold mb-1">${label}</div>
      <div class="text-2xl font-bold num" style="color:${color}">${value}</div>
      <div class="text-[10px] text-[var(--text-2)] mt-1 truncate">${sub}</div>
    </div>
  `;
}

function renderAccuracy() {
  const div = document.getElementById('accuracy-list');
  if (!STATE.forecast) { div.innerHTML = ''; return; }
  const entries = STATE.selectedModels.map(k => ({
    key: k, mape: STATE.forecast.accuracies[k], model: MODELS[k]
  })).sort((a, b) => (a.mape || 999) - (b.mape || 999));

  const maxMape = Math.max(...entries.map(e => e.mape || 0), 20);
  div.innerHTML = entries.map((e, i) => {
    const score = e.mape == null ? 0 : Math.max(0, 100 - e.mape);
    const grade = e.mape == null ? '-' : e.mape < 8 ? '★★★' : e.mape < 12 ? '★★' : e.mape < 18 ? '★' : '·';
    return `
      <div>
        <div class="flex items-center justify-between text-[11px] mb-1">
          <span class="flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full" style="background:${e.model.color}"></span>
            <span class="font-semibold">${i + 1}. ${e.model.name}</span>
            <span class="text-amber-400">${grade}</span>
          </span>
          <span class="num" style="color:${e.model.color}">${e.mape == null ? 'N/A' : e.mape.toFixed(2) + '%'}</span>
        </div>
        <div class="h-1.5 bg-white/5 rounded-full overflow-hidden">
          <div class="h-full rounded-full transition-all" style="width:${(score / 100) * 100}%; background:${e.model.color}"></div>
        </div>
      </div>
    `;
  }).join('');
}

function renderModelExplanations() {
  const div = document.getElementById('model-explain');
  if (!STATE.forecast) { div.innerHTML = ''; return; }

  const periodLabel = STATE.period === 3 ? '3개월' : STATE.period === 6 ? '6개월' : STATE.period === 12 ? '12개월' : '24개월';

  div.innerHTML = STATE.selectedModels.map(k => {
    const m = MODELS[k];
    const fc = STATE.forecast.predictions[k];
    const fcMin = Math.min(...fc), fcMax = Math.max(...fc);
    const fcSum = fc.reduce((a, b) => a + b, 0);
    const fcAvg = fcSum / fc.length;
    const lastVal = STATE.forecast.values[STATE.forecast.values.length - 1];
    const change = ((fcAvg - lastVal) / lastVal) * 100;
    const std = STATE.forecast.stds[k];
    const cv = lastVal > 0 ? (std / lastVal) * 100 : 0;
    const mape = STATE.forecast.accuracies[k];

    let interpretation = '';
    if (k === 'ma') {
      interpretation = `최근 ${STATE.params.maWindow}개월 평균을 ${periodLabel} 동안 일정하게 적용한 결과로, <b style="color:${m.color}">평탄한(flat) 예측선</b>이 형성됩니다. 단기 변동을 평균으로 흡수하므로 노이즈에 강하지만 추세나 계절성은 반영하지 못합니다.`;
    } else if (k === 'lt') {
      const slope = (fc[fc.length-1] - fc[0]) / Math.max(fc.length - 1, 1);
      interpretation = `과거 전체 데이터의 회귀선을 외삽하여 <b style="color:${m.color}">${slope > 0 ? '우상향' : '우하향'}하는 직선</b>을 그립니다. 월간 변화량은 약 ${formatNum(slope)}이며, 추세를 잘 보여주지만 계절적 등락은 반영되지 않습니다.`;
    } else if (k === 'es') {
      interpretation = `α=${STATE.params.alpha.toFixed(2)}로 최근값에 ${(STATE.params.alpha*100).toFixed(0)}% 가중치를 부여한 결과, 가장 최근 관측값 근처에서 <b style="color:${m.color}">평탄한 예측</b>을 생성합니다. α를 높이면 최근 변화에 더 민감해집니다.`;
    } else if (k === 'hw') {
      interpretation = `레벨·추세·계절성을 모두 분해하여 <b style="color:${m.color}">월별 등락 패턴</b>을 예측에 반영합니다. ${periodLabel} 예측에서 최저 ${formatNum(fcMin)} ~ 최고 ${formatNum(fcMax)}로 변동성이 가장 잘 표현됩니다. 파라미터: α=${STATE.params.alpha.toFixed(2)}, β=${STATE.params.beta.toFixed(2)}, γ=${STATE.params.gamma.toFixed(2)}`;
    } else if (k === 'sn') {
      interpretation = `각 미래 월에 대해 <b style="color:${m.color}">정확히 12개월 전의 실측값</b>을 사용합니다. 추세 변화는 무시되지만 강한 계절성 패턴이 있는 경우 매우 효과적입니다.`;
    }

    return `
      <div class="border border-white/5 rounded-xl p-4 hover:border-white/10 transition-all" style="border-left: 3px solid ${m.color}">
        <div class="flex items-start justify-between gap-2 mb-2">
          <div class="flex items-center gap-2">
            <h4 class="font-bold">${m.name}</h4>
            <span class="chip text-[10px]" style="background:${m.color}15; border-color:${m.color}40; color:${m.color}">${m.short}</span>
          </div>
          ${mape != null ? `<span class="text-[10px] num" style="color:${m.color}">MAPE ${mape.toFixed(2)}%</span>` : ''}
        </div>
        <p class="text-xs text-[var(--text-1)] leading-relaxed mb-2">${interpretation}</p>
        <div class="grid grid-cols-3 gap-2 mt-3 text-[10px]">
          <div class="bg-white/3 rounded-md p-2">
            <div class="text-[var(--text-2)] mb-0.5">예측 평균</div>
            <div class="num font-bold" style="color:${m.color}">${formatNum(fcAvg)}</div>
          </div>
          <div class="bg-white/3 rounded-md p-2">
            <div class="text-[var(--text-2)] mb-0.5">변동 폭</div>
            <div class="num font-bold">${formatNum(fcMax - fcMin)}</div>
          </div>
          <div class="bg-white/3 rounded-md p-2">
            <div class="text-[var(--text-2)] mb-0.5">최근 대비</div>
            <div class="num font-bold ${change >= 0 ? 'text-[#10b981]' : 'text-[#ef4444]'}">${change >= 0 ? '+' : ''}${change.toFixed(1)}%</div>
          </div>
        </div>
        <div class="mt-2 text-[10px] text-[var(--text-2)] flex flex-wrap gap-3">
          <span>📊 적합 상황: ${m.when}</span>
        </div>
      </div>
    `;
  }).join('');

  // 앙상블 해설 추가
  if (STATE.forecast.predictions.ensemble) {
    const ens = STATE.forecast.predictions.ensemble;
    const ensAvg = ens.reduce((a, b) => a + b, 0) / ens.length;
    const lastVal = STATE.forecast.values[STATE.forecast.values.length - 1];
    const change = ((ensAvg - lastVal) / lastVal) * 100;

    // 모형 간 편차 (불확실성 지표)
    let dispersion = 0;
    for (let i = 0; i < ens.length; i++) {
      const vals = STATE.selectedModels.map(k => STATE.forecast.predictions[k][i]);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
      dispersion += Math.sqrt(variance);
    }
    dispersion /= ens.length;
    const dispersionPct = (dispersion / ensAvg) * 100;

    div.insertAdjacentHTML('afterbegin', `
      <div class="border border-white/15 rounded-xl p-4" style="background: linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01)); border-left: 3px solid #fff">
        <div class="flex items-center gap-2 mb-2">
          <h4 class="font-bold">앙상블 (${STATE.selectedModels.length}개 모형 평균)</h4>
          <span class="chip text-[10px] bg-white/10 border-white/20">★ 권장</span>
        </div>
        <p class="text-xs text-[var(--text-1)] leading-relaxed">
          선택한 ${STATE.selectedModels.length}개 모형의 단순 평균으로, 개별 모형의 편향을 상쇄하여 <b>가장 안정적인 예측</b>을 제공합니다.
          모형 간 평균 편차는 <b class="num">${formatNum(dispersion)}</b> (평균값 대비 ${dispersionPct.toFixed(1)}%)로,
          ${dispersionPct < 5 ? '<b class="text-[#10b981]">모형들이 서로 일치</b>하여 예측 신뢰도가 높습니다' : dispersionPct < 15 ? '<b class="text-amber-400">모형 간 일부 차이</b>가 있어 시나리오 검토를 권장합니다' : '<b class="text-[#ef4444]">모형 간 큰 차이</b>가 있어 시장 불확실성이 높음을 시사합니다'}.
        </p>
      </div>
    `);
  }
}

function renderForecastTable() {
  const tbl = document.getElementById('forecast-table');
  if (!STATE.forecast) { tbl.innerHTML = ''; return; }

  const headers = ['월', ...STATE.selectedModels.map(k => MODELS[k].name)];
  if (STATE.forecast.predictions.ensemble) headers.push('앙상블');

  let html = '<thead><tr class="text-[var(--text-2)] uppercase tracking-wider text-[10px] border-b border-white/10">';
  headers.forEach((h, i) => {
    const color = i === 0 ? '' : (i === headers.length - 1 && STATE.forecast.predictions.ensemble ? 'color:#fff' : `color:${MODELS[STATE.selectedModels[i-1]].color}`);
    html += `<th class="text-${i === 0 ? 'left' : 'right'} py-2 px-3" style="${color}">${h}</th>`;
  });
  html += '</tr></thead><tbody>';

  STATE.forecast.futureLabels.forEach((lbl, i) => {
    html += `<tr class="border-b border-white/5 hover:bg-white/3"><td class="py-2 px-3 text-left text-[var(--text-1)] font-semibold">${lbl.date}</td>`;
    STATE.selectedModels.forEach(k => {
      const v = STATE.forecast.predictions[k][i];
      const interval = STATE.forecast.intervals[k][i];
      let cell = formatNum(v);
      if (STATE.output !== 'point') {
        cell += `<div class="text-[9px] text-[var(--text-2)]">[${formatNum(interval.lower)} ~ ${formatNum(interval.upper)}]</div>`;
      }
      html += `<td class="text-right py-2 px-3" style="color:${MODELS[k].color}">${cell}</td>`;
    });
    if (STATE.forecast.predictions.ensemble) {
      const v = STATE.forecast.predictions.ensemble[i];
      const interval = STATE.forecast.intervals.ensemble[i];
      let cell = `<b>${formatNum(v)}</b>`;
      if (STATE.output !== 'point') {
        cell += `<div class="text-[9px] text-[var(--text-2)]">[${formatNum(interval.lower)} ~ ${formatNum(interval.upper)}]</div>`;
      }
      html += `<td class="text-right py-2 px-3 text-white">${cell}</td>`;
    }
    html += '</tr>';
  });
  html += '</tbody>';
  tbl.innerHTML = html;

  document.getElementById('table-period-label').textContent = `${STATE.forecast.futureLabels[0].date} ~ ${STATE.forecast.futureLabels[STATE.forecast.futureLabels.length-1].date} · 신뢰수준 ${STATE.ciLevel}%`;
}

function renderSummary() {
  const div = document.getElementById('summary-opinion');
  if (!STATE.forecast) { div.innerHTML = ''; return; }
  const fcKey = STATE.forecast.predictions.ensemble ? 'ensemble' : STATE.selectedModels[0];
  const fcSum = STATE.forecast.predictions[fcKey].reduce((a, b) => a + b, 0);
  const lastSum = STATE.forecast.values.slice(-STATE.period).reduce((a, b) => a + b, 0);
  const yoy = lastSum > 0 ? ((fcSum - lastSum) / lastSum) * 100 : 0;
  const periodLabel = STATE.period === 3 ? '3개월' : STATE.period === 6 ? '6개월' : STATE.period === 12 ? '12개월' : '24개월';

  let opinion = '';
  if (yoy >= 5) opinion = `<b class="text-[#10b981]">강한 성장세(+${yoy.toFixed(1)}%)</b>가 예상됩니다. 수요 증가에 대비한 공급 능력 확충과 재고 관리 강화가 권장됩니다.`;
  else if (yoy >= 0) opinion = `<b class="text-[#10b981]">완만한 성장세(+${yoy.toFixed(1)}%)</b>가 예상됩니다. 현재 운영 수준을 유지하면서 시장 변화 모니터링이 권장됩니다.`;
  else if (yoy >= -5) opinion = `<b class="text-amber-400">소폭 감소(${yoy.toFixed(1)}%)</b>가 예상됩니다. 비용 효율화 및 수요 변동 요인 분석이 필요합니다.`;
  else opinion = `<b class="text-[#ef4444]">큰 폭의 감소(${yoy.toFixed(1)}%)</b>가 예상됩니다. 수요 위축 원인 파악 및 대응 전략 수립이 시급합니다.`;

  let bestKey = null, bestMape = Infinity;
  Object.entries(STATE.forecast.accuracies).forEach(([k, v]) => {
    if (v != null && v < bestMape) { bestMape = v; bestKey = k; }
  });

  div.innerHTML = `
    <p>📊 <b>분석 변수:</b> ${STATE.valueColumn} · <b>분석 기간:</b> ${STATE.series[0].date} ~ ${STATE.forecast.last.date}</p>
    <p>🎯 향후 <b class="text-[#00e0c6]">${periodLabel}</b> 예측 합계는 <b class="text-white">${formatNum(fcSum)}</b>로, 직전 동기간(${formatNum(lastSum)}) 대비 ${opinion}</p>
    ${bestKey ? `<p>🏆 백테스트 결과 <b style="color:${MODELS[bestKey].color}">${MODELS[bestKey].name}</b> 모형이 가장 정확했습니다 (MAPE ${bestMape.toFixed(2)}%).</p>` : ''}
    ${STATE.selectedModels.length > 1 && STATE.showEnsemble ? `<p>🤝 ${STATE.selectedModels.length}개 모형의 앙상블 예측을 채택하여 단일 모형 대비 안정성이 향상되었습니다.</p>` : ''}
    ${STATE.output !== 'point' ? `<p>📐 ${STATE.ciLevel}% 신뢰수준에서의 예상 범위가 함께 제공됩니다. 의사결정 시 상한·하한 시나리오를 모두 고려하시기 바랍니다.</p>` : ''}
  `;
}

function renderToolbar() {
  document.getElementById('tb-status').innerHTML = STATE.series
    ? `<span class="chip-dot bg-emerald-400"></span>${STATE.fileName || '데이터'} (${STATE.series.length}개월)`
    : `<span class="chip-dot bg-amber-400 pulse-dot"></span>데이터 없음`;

  const periodEl = document.getElementById('tb-period');
  const modelEl = document.getElementById('tb-models');
  if (STATE.series) {
    periodEl.classList.remove('hidden');
    modelEl.classList.remove('hidden');
    periodEl.querySelector('span:last-child').textContent = `예측 ${STATE.period}개월`;
    const names = STATE.selectedModels.map(k => MODELS[k].short).join('+');
    modelEl.querySelector('span:last-child').textContent = `${names}${STATE.showEnsemble && STATE.selectedModels.length > 1 ? '+ENS' : ''}`;
  } else {
    periodEl.classList.add('hidden');
    modelEl.classList.add('hidden');
  }
}

function renderLegend() {
  const legend = document.getElementById('chart-legend');
  let html = `<span class="flex items-center gap-1.5"><span class="w-3 h-0.5 bg-white"></span>실측</span>`;
  STATE.selectedModels.forEach(k => {
    const m = MODELS[k];
    html += `<span class="flex items-center gap-1.5"><span class="w-3 h-0.5" style="background:${m.color}"></span>${m.name}</span>`;
  });
  if (STATE.forecast?.predictions.ensemble) {
    html += `<span class="flex items-center gap-1.5"><span class="w-3 h-0.5 bg-white" style="height:2px"></span><b>앙상블</b></span>`;
  }
  if (STATE.output !== 'point') {
    html += `<span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-sm bg-cyan-400/20 border border-cyan-400/40"></span>${STATE.ciLevel}% 신뢰구간</span>`;
  }
  legend.innerHTML = html;
}

function update() {
  STATE.forecast = computeForecast();
  renderModelGrid();
  renderToolbar();
  renderKPI();
  renderChart();
  renderLegend();
  renderAccuracy();
  renderModelExplanations();
  renderForecastTable();
  renderSummary();

  document.getElementById('btn-export').disabled = !STATE.forecast;

  const sub = document.getElementById('chart-subtitle');
  const periodLabel = STATE.period === 3 ? '3개월' : STATE.period === 6 ? '6개월' : STATE.period === 12 ? '12개월' : '24개월';
  sub.textContent = `${STATE.valueColumn || ''} · 향후 ${periodLabel} · ${STATE.output === 'point' ? '점 예측' : STATE.output === 'interval' ? '예상 범위' : '점 예측 + 신뢰구간'}`;
}

/* ============================================================
   5. 파일 업로드 처리
   ============================================================ */
async function handleFile(file) {
  if (!file) return;
  STATE.fileName = file.name;

  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const result = {};

    wb.SheetNames.forEach(name => {
      const ws = wb.Sheets[name];
      const json = XLSX.utils.sheet_to_json(ws, { defval: null });
      if (json.length === 0) return;
      const cols = Object.keys(json[0]);
      const yearCol = cols.find(c => /연도|year/i.test(c));
      const monthCol = cols.find(c => /월|month/i.test(c));
      if (!yearCol || !monthCol) return;
      const numericCols = cols.filter(c => c !== yearCol && c !== monthCol &&
        json.some(r => typeof r[c] === 'number'));
      const rows = json
        .filter(r => r[yearCol] != null && r[monthCol] != null)
        .map(r => {
          const obj = {
            year: Number(r[yearCol]),
            month: Number(r[monthCol]),
            date: `${r[yearCol]}-${String(r[monthCol]).padStart(2, '0')}`,
          };
          numericCols.forEach(c => obj[c] = Number(r[c]) || 0);
          return obj;
        })
        .sort((a, b) => (a.year - b.year) * 12 + (a.month - b.month));
      if (rows.length > 0) result[name] = { rows, numericCols };
    });

    if (Object.keys(result).length === 0) {
      showToast('유효한 데이터를 찾을 수 없습니다. 시트에 \'연도\', \'월\' 컬럼이 있어야 합니다.');
      return;
    }

    STATE.rawSheets = result;
    STATE.activeSheet = Object.keys(result)[0];
    STATE.valueColumn = result[STATE.activeSheet].numericCols[0];
    STATE.series = result[STATE.activeSheet].rows.map(r => ({
      year: r.year, month: r.month, date: r.date, value: r[STATE.valueColumn]
    }));

    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');

    populateSheetSelector();
    update();
    showToast(`${file.name} 업로드 완료 · ${STATE.series.length}개월 데이터`);
  } catch (e) {
    console.error(e);
    showToast('파일 처리 중 오류: ' + e.message);
  }
}

function populateSheetSelector() {
  const ss = document.getElementById('sel-sheet');
  ss.innerHTML = Object.keys(STATE.rawSheets).map(s => `<option value="${s}">${s}</option>`).join('');
  ss.value = STATE.activeSheet;

  const sc = document.getElementById('sel-column');
  sc.innerHTML = STATE.rawSheets[STATE.activeSheet].numericCols
    .map(c => `<option value="${c}">${c}</option>`).join('');
  sc.value = STATE.valueColumn;

  const info = document.getElementById('data-info');
  info.textContent = `${STATE.series.length}개월 · ${STATE.series[0].date} ~ ${STATE.series[STATE.series.length-1].date}`;
}

/* ============================================================
   6. 샘플 데이터 (전자상거래 무역)
   ============================================================ */
function loadSample() {
  // 실제 BANDTrass 데이터 패턴을 모방한 샘플 (수입 금액)
  const baseImp = [
    84577963,79079212,90110217,91329654,91411413,70842890,71252529,66935324,74712550,82986383,75211247,96283067,
    81363841,60361822,59816932,69042164,73152848,55984816,57108247,56851103,69183184,79263028,73489820,72746977,
    66672927,66106076,65751908,72316472,80194170,67996321,67566443,66828054,79008780,86997960,77983193,87751062,
    96815773,86571641,108260841,108025378,118169998,96104070,97867908,99080927,114989232,116614050,103253077,89996040,
    132064906,108569117,127925257,128987149,135029927,121146164,123568010,134174611,143497625,156486181,142893994,133715435,
    154048148,133988023,170867989,158213569,166614499,158641263,153807550,154867272,165947080,184147391,159973820,148756770,
    170478057,164773604,178898057,193001275,200120961,191706488,182037193,164541316,193706094,206055557,201823064,135104595,
    178553574,196502557,237196834,222931488,225929611,202828286,237569812,211881472,231290499,238989859,241586114,261283108,
    240156403,228054822,245193879,243430655,249815935,231400706,225751829,224174466,231767725,236739495,244875127,237939901,
    222349728,227005586,233066345,201817820,207840562,181776147,197181822,206168988,222841502,224074193,223731701,202161790,
    233090812,189076620,209568664,202498648,202989061,207120906,224458272,220389066,236432466,231630515,241898188,231557272,
    192746635,231876209
  ];
  const baseExp = [
    2204019,2678639,2918878,3035281,2830370,2712353,3016501,3072664,2833542,2859013,3660280,5001969,
    4825637,4161753,5605127,5894290,7268823,9252054,11290107,11050687,9853842,9962010,10728823,10737646,
    9907620,7728824,9525193,9908068,11149149,11129875,12072725,12036620,12244569,11823170,11181083,10153011,
    7822088,5950005,8126437,7880892,7773907,8212894,9005810,9281862,9293562,9999028,10593290,11108470,
    9846437,8388247,11109007,11017194,12252293,11717816,12110727,12211884,11974568,11998908,11907022,10733628,
    11906094,9979495,12998088,12942823,15053389,15527427,16942946,17128486,16941869,17876055,18712574,17275667,
    19057706,17073893,28428434,30700554,38143174,38625568,40681727,40891893,40955486,42064024,38779015,33648403,
    50884089,55410810,71988893,77569316,84048937,75500907,82131393,76700517,84411812,87015812,86028086,86729101,
    74775528,69175985,82489307,82034731,82373057,77620056,80093017,79129987,76857283,76317930,77770537,67100345,
    72149994,67568879,76916815,75091611,80164840,83126571,82898816,84541812,89010625,85893572,84899938,78394703,
    100456625,89614247,107014810,108253566,114395815,108910823,116716028,115957247,116967893,123091494,135289008,135768966,
    117149873,140314112
  ];
  const dates = [];
  let y = 2014, m = 1;
  for (let i = 0; i < baseImp.length; i++) {
    dates.push({ year: y, month: m, date: `${y}-${String(m).padStart(2, '0')}` });
    m++; if (m > 12) { m = 1; y++; }
  }
  const impRows = dates.map((d, i) => ({ ...d, '전자상거래 수입 금액': baseImp[i] }));
  const expRows = dates.map((d, i) => ({ ...d, '전자상거래 수출 금액': baseExp[i] }));
  STATE.fileName = '전자상거래무역_샘플.xlsx';
  STATE.rawSheets = {
    '전자상거래 수입': { rows: impRows, numericCols: ['전자상거래 수입 금액'] },
    '전자상거래 수출': { rows: expRows, numericCols: ['전자상거래 수출 금액'] },
  };
  STATE.activeSheet = '전자상거래 수입';
  STATE.valueColumn = '전자상거래 수입 금액';
  STATE.series = impRows.map(r => ({ year: r.year, month: r.month, date: r.date, value: r['전자상거래 수입 금액'] }));

  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  populateSheetSelector();
  update();
  showToast('샘플 데이터 로드 완료 (BANDTrass 전자상거래 통계)');
}

/* ============================================================
   7. Word 문서 출력
   ============================================================ */
async function exportWord() {
  if (!STATE.forecast) return;
  showToast('Word 문서 생성 중...');

  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType, LevelFormat, PageBreak
  } = docx;

  const today = new Date().toISOString().slice(0, 10);
  const periodLabel = STATE.period === 3 ? '3개월' : STATE.period === 6 ? '6개월' : STATE.period === 12 ? '12개월' : '24개월';
  const fcKey = STATE.forecast.predictions.ensemble ? 'ensemble' : STATE.selectedModels[0];
  const fcSum = STATE.forecast.predictions[fcKey].reduce((a, b) => a + b, 0);
  const lastSum = STATE.forecast.values.slice(-STATE.period).reduce((a, b) => a + b, 0);
  const yoy = lastSum > 0 ? ((fcSum - lastSum) / lastSum) * 100 : 0;
  let bestKey = null, bestMape = Infinity;
  Object.entries(STATE.forecast.accuracies).forEach(([k, v]) => {
    if (v != null && v < bestMape) { bestMape = v; bestKey = k; }
  });

  const border = { style: BorderStyle.SINGLE, size: 4, color: "94A3B8" };
  const borders = { top: border, bottom: border, left: border, right: border };

  const cell = (text, opts = {}) => new TableCell({
    borders,
    width: { size: opts.width || 1500, type: WidthType.DXA },
    shading: opts.header ? { fill: "0F172A", type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({
      alignment: opts.align || AlignmentType.LEFT,
      children: [new TextRun({
        text, bold: opts.bold || opts.header,
        color: opts.header ? "FFFFFF" : (opts.color || "1E293B"),
        size: 18, font: "맑은 고딕",
      })],
    })],
  });
  const para = (text, opts = {}) => new Paragraph({
    alignment: opts.align || AlignmentType.JUSTIFIED,
    spacing: { before: 60, after: 60, line: 320 },
    children: [new TextRun({ text, size: opts.size || 22, bold: opts.bold, color: opts.color || "1E293B", font: "맑은 고딕" })],
  });
  const heading = (text, level = HeadingLevel.HEADING_1) => new Paragraph({
    heading: level,
    spacing: { before: 280, after: 120 },
    children: [new TextRun({ text, bold: true, color: "0F172A", size: level === HeadingLevel.HEADING_1 ? 32 : 26, font: "맑은 고딕" })],
    border: level === HeadingLevel.HEADING_1
      ? { bottom: { style: BorderStyle.SINGLE, size: 12, color: "06B6D4", space: 4 } }
      : undefined,
  });
  const bullet = (text) => new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { before: 40, after: 40 },
    children: [new TextRun({ text, size: 22, color: "1E293B", font: "맑은 고딕" })],
  });

  // 모델별 해설 섹션
  const modelExplainParas = [];
  STATE.selectedModels.forEach(k => {
    const m = MODELS[k];
    const fc = STATE.forecast.predictions[k];
    const fcAvg = fc.reduce((a, b) => a + b, 0) / fc.length;
    const lastVal = STATE.forecast.values[STATE.forecast.values.length - 1];
    const change = ((fcAvg - lastVal) / lastVal) * 100;
    const mape = STATE.forecast.accuracies[k];

    modelExplainParas.push(heading(m.name + ' (' + m.short + ')', HeadingLevel.HEADING_2));
    modelExplainParas.push(para(`설명: ${m.desc}`));
    modelExplainParas.push(para(`적합 상황: ${m.when}. 장점: ${m.pros}. 단점: ${m.cons}.`));
    modelExplainParas.push(para(`이번 ${periodLabel} 예측에서 평균값은 ${formatNum(fcAvg)}로, 최근값(${formatNum(lastVal)}) 대비 ${change >= 0 ? '+' : ''}${change.toFixed(1)}% 변화가 예상됩니다.${mape != null ? ' 백테스트 MAPE: ' + mape.toFixed(2) + '%.' : ''}`));
  });

  // 예측표 행
  const tableHeaders = ['월', ...STATE.selectedModels.map(k => MODELS[k].name)];
  if (STATE.forecast.predictions.ensemble) tableHeaders.push('앙상블');
  const headerRow = new TableRow({
    children: tableHeaders.map((h, i) =>
      cell(h, { header: true, align: AlignmentType.CENTER, width: i === 0 ? 1100 : 1300 })
    ),
  });
  const dataRows = STATE.forecast.futureLabels.map((lbl, i) => {
    const cells = [cell(lbl.date, { align: AlignmentType.CENTER, width: 1100, bold: true })];
    STATE.selectedModels.forEach(k => {
      cells.push(cell(formatNum(STATE.forecast.predictions[k][i]), { align: AlignmentType.RIGHT, width: 1300 }));
    });
    if (STATE.forecast.predictions.ensemble) {
      cells.push(cell(formatNum(STATE.forecast.predictions.ensemble[i]), { align: AlignmentType.RIGHT, width: 1300, bold: true, color: "0891B2" }));
    }
    return new TableRow({ children: cells });
  });
  const colW = [1100, ...Array(tableHeaders.length - 1).fill(1300)];

  // MAPE 표
  const sortedAcc = STATE.selectedModels.map(k => ({ k, mape: STATE.forecast.accuracies[k] }))
    .sort((a, b) => (a.mape || 999) - (b.mape || 999));
  const mapeRows = [
    new TableRow({ children: [
      cell('순위', { header: true, align: AlignmentType.CENTER, width: 1000 }),
      cell('모형명', { header: true, align: AlignmentType.CENTER, width: 2400 }),
      cell('MAPE', { header: true, align: AlignmentType.CENTER, width: 2200 }),
      cell('평가', { header: true, align: AlignmentType.CENTER, width: 3300 }),
    ]}),
    ...sortedAcc.map((e, i) => {
      const v = e.mape;
      const evalText = v == null ? '-' : v < 8 ? '매우 우수' : v < 12 ? '우수' : v < 18 ? '보통' : '개선 필요';
      const evalColor = v == null ? "1E293B" : v < 8 ? "059669" : v < 12 ? "0891B2" : v < 18 ? "D97706" : "DC2626";
      return new TableRow({ children: [
        cell(`${i + 1}위`, { align: AlignmentType.CENTER, width: 1000, bold: i === 0 }),
        cell(MODELS[e.k].name, { align: AlignmentType.LEFT, width: 2400, bold: i === 0 }),
        cell(v == null ? '-' : v.toFixed(2) + '%', { align: AlignmentType.RIGHT, width: 2200 }),
        cell(evalText, { align: AlignmentType.CENTER, width: 3300, color: evalColor, bold: true }),
      ]});
    })
  ];

  let opinion;
  if (yoy >= 5) opinion = `예측 결과 향후 ${periodLabel}간 강한 성장세(+${yoy.toFixed(1)}%)가 예상됩니다. 수요 증가에 대비한 공급망 확충 및 재고 관리 강화가 권장됩니다.`;
  else if (yoy >= 0) opinion = `예측 결과 향후 ${periodLabel}간 완만한 성장세(+${yoy.toFixed(1)}%)가 예상됩니다. 현재 운영 수준을 유지하면서 시장 변화 모니터링이 권장됩니다.`;
  else if (yoy >= -5) opinion = `예측 결과 향후 ${periodLabel}간 소폭 감소(${yoy.toFixed(1)}%)가 예상됩니다. 비용 효율화 및 수요 변동 요인 분석이 필요합니다.`;
  else opinion = `예측 결과 향후 ${periodLabel}간 큰 폭의 감소(${yoy.toFixed(1)}%)가 예상됩니다. 수요 위축 원인 파악 및 대응 전략 수립이 시급합니다.`;

  const children = [
    // 표지
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { before: 1200, after: 200 },
      children: [new TextRun({ text: '수요예측 분석 보고서', bold: true, size: 56, color: "0F172A", font: "맑은 고딕" })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 1000 },
      children: [new TextRun({ text: 'Demand Forecast Analysis Report', size: 28, color: "06B6D4", font: "Arial" })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 200 },
      children: [new TextRun({ text: STATE.valueColumn, size: 32, bold: true, color: "1E293B", font: "맑은 고딕" })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { before: 1600 },
      children: [new TextRun({ text: `생성일: ${today}`, size: 22, color: "64748B", font: "맑은 고딕" })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `원본 파일: ${STATE.fileName}`, size: 22, color: "64748B", font: "맑은 고딕" })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `예측 기간: ${periodLabel} · 신뢰수준 ${STATE.ciLevel}%`, size: 22, color: "64748B", font: "맑은 고딕" })],
    }),
    new Paragraph({ children: [new PageBreak()] }),

    heading('1. 분석 개요'),
    para(`본 보고서는 ${STATE.fileName} 파일의 ${STATE.valueColumn} 데이터(${STATE.series[0].date} ~ ${STATE.forecast.last.date}, 총 ${STATE.series.length}개월)를 기반으로 ${STATE.selectedModels.length}개의 시계열 예측 모형${STATE.forecast.predictions.ensemble ? '과 앙상블' : ''}을 적용하여 향후 ${periodLabel}의 수요를 예측한 결과입니다.`),
    para(''),
    heading('1.1 핵심 결과', HeadingLevel.HEADING_2),
    bullet(`최근 ${periodLabel} 합계: ${formatNum(lastSum)}`),
    bullet(`향후 ${periodLabel} 예측 합계: ${formatNum(fcSum)}`),
    bullet(`전기 대비 변화율: ${yoy >= 0 ? '+' : ''}${yoy.toFixed(2)}%`),
    bestKey ? bullet(`최우수 모형: ${MODELS[bestKey].name} (MAPE ${bestMape.toFixed(2)}%)`) : para(''),
    para(opinion, { bold: true }),
    new Paragraph({ children: [new PageBreak()] }),

    heading('2. 모형별 상세 분석'),
    ...modelExplainParas,
    new Paragraph({ children: [new PageBreak()] }),

    heading('3. 모형별 정확도 (백테스트 MAPE)'),
    new Table({ width: { size: 8900, type: WidthType.DXA }, columnWidths: [1000, 2400, 2200, 3300], rows: mapeRows }),
    para(''),
    para('* MAPE: 데이터의 마지막 12개월을 hold-out으로 두고 예측한 후 실제값과 비교한 평균 절대 백분율 오차로, 값이 작을수록 정확합니다.', { size: 18, color: "64748B" }),

    heading('4. 향후 ' + periodLabel + ' 예측값'),
    new Table({ width: { size: 8900, type: WidthType.DXA }, columnWidths: colW, rows: [headerRow, ...dataRows] }),

    heading('5. 분석 의견 및 권고사항'),
    para(opinion),
    bullet('단일 모형의 예측치만 신뢰하기보다는 앙상블 결과 또는 모형별 예측 범위를 함께 검토하여 의사결정의 견고성을 확보하시기 바랍니다.'),
    bullet('정책 변화, 환율, 국제 정세 등 외부 충격은 본 모형에 반영되지 않으므로 분기별 데이터 갱신과 모형 재학습을 권장합니다.'),
    bullet('백테스트 MAPE가 큰 모형은 데이터 패턴과 부합하지 않는 것이므로 해당 결과의 가중치를 낮추거나 제외하는 것이 좋습니다.'),
    STATE.output !== 'point' ? bullet(`${STATE.ciLevel}% 신뢰구간이 함께 산출되었습니다. 의사결정 시 상한·하한 시나리오를 모두 고려하시기 바랍니다.`) : para(''),

    new Paragraph({
      spacing: { before: 600, after: 100 },
      border: { top: { style: BorderStyle.SINGLE, size: 6, color: "CBD5E1", space: 6 } },
      children: [new TextRun({ text: '본 보고서는 Demand Forecast Studio에 의해 자동 생성되었습니다.', size: 18, color: "64748B", italics: true, font: "맑은 고딕" })],
    }),
  ];

  const doc = new Document({
    styles: { default: { document: { run: { font: "맑은 고딕", size: 22 } } } },
    numbering: { config: [{
      reference: "bullets",
      levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
    }]},
    sections: [{
      properties: { page: {
        size: { width: 11906, height: 16838 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      }},
      children,
    }],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `수요예측_보고서_${STATE.valueColumn}_${today}.docx`);
  showToast('Word 보고서 다운로드 완료');
}

/* ============================================================
   8. 토스트
   ============================================================ */
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3000);
}

/* ============================================================
   9. 이벤트 바인딩
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('file-input');
  document.getElementById('btn-upload').onclick = () => fileInput.click();
  document.getElementById('dropzone').onclick = () => fileInput.click();
  fileInput.onchange = (e) => handleFile(e.target.files[0]);

  const dz = document.getElementById('dropzone');
  dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('glow'); };
  dz.ondragleave = () => dz.classList.remove('glow');
  dz.ondrop = (e) => {
    e.preventDefault();
    dz.classList.remove('glow');
    handleFile(e.dataTransfer.files[0]);
  };

  document.getElementById('btn-sample').onclick = loadSample;
  document.getElementById('btn-try-sample').onclick = loadSample;
  document.getElementById('btn-export').onclick = exportWord;

  document.getElementById('sel-sheet').onchange = (e) => {
    STATE.activeSheet = e.target.value;
    STATE.valueColumn = STATE.rawSheets[STATE.activeSheet].numericCols[0];
    STATE.series = STATE.rawSheets[STATE.activeSheet].rows.map(r => ({
      year: r.year, month: r.month, date: r.date, value: r[STATE.valueColumn]
    }));
    populateSheetSelector();
    update();
  };
  document.getElementById('sel-column').onchange = (e) => {
    STATE.valueColumn = e.target.value;
    STATE.series = STATE.rawSheets[STATE.activeSheet].rows.map(r => ({
      year: r.year, month: r.month, date: r.date, value: r[STATE.valueColumn]
    }));
    update();
  };

  // 세그먼트 버튼들
  document.querySelectorAll('[data-period]').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('[data-period]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.period = parseInt(btn.dataset.period);
      update();
    };
  });
  document.querySelectorAll('[data-output]').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('[data-output]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.output = btn.dataset.output;
      update();
    };
  });
  document.querySelectorAll('[data-ci]').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('[data-ci]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.ciLevel = parseInt(btn.dataset.ci);
      update();
    };
  });

  document.getElementById('chk-ensemble').onchange = (e) => {
    STATE.showEnsemble = e.target.checked;
    update();
  };

  // 파라미터 슬라이더
  const bind = (id, label, key, fmt) => {
    const slider = document.getElementById(id);
    const lbl = document.getElementById(label);
    slider.oninput = () => {
      STATE.params[key] = parseFloat(slider.value);
      lbl.textContent = fmt(STATE.params[key]);
      if (STATE.series) update();
    };
  };
  bind('param-ma', 'lbl-ma', 'maWindow', v => Math.round(v));
  bind('param-alpha', 'lbl-alpha', 'alpha', v => v.toFixed(2));
  bind('param-beta', 'lbl-beta', 'beta', v => v.toFixed(2));
  bind('param-gamma', 'lbl-gamma', 'gamma', v => v.toFixed(2));

  // 줌 버튼
  document.getElementById('zoom-reset').onclick = () => { STATE.zoomMode = 'all'; renderChart(); };
  document.getElementById('zoom-recent').onclick = () => { STATE.zoomMode = 'recent'; renderChart(); };
  document.getElementById('zoom-forecast').onclick = () => { STATE.zoomMode = 'forecast'; renderChart(); };

  // 윈도우 리사이즈 시 차트 다시 그리기
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (STATE.forecast) renderChart(); }, 100);
  });
});
