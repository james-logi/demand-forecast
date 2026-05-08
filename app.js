/* ============================================================
   Demand Forecast Studio v2 — Main Application
   ============================================================ */

const STATE = {
  rawSheets: null,
  fileName: '',
  // 시리즈: 수입/수출 각각 금액·건수·전체금액·전체건수
  data: {
    import: null,  // { rows: [{date, year, month, ec_amount, ec_count, total_amount, total_count}] }
    export: null,
  },
  // UI 옵션
  direction: 'both',      // 'import' | 'export' | 'both'
  metric: 'amount',       // 'amount' | 'count' | 'both'
  scope: 'ec',            // 'ec' | 'total'
  currency: 'USD',        // 'KRW' | 'USD' (원본 데이터는 USD 기준)
  theme: 'dark',
  // 예측 옵션
  selectedModels: ['hw'],
  period: 12,
  output: 'point',        // 'point' | 'interval' | 'both'
  ciLevel: 95,
  // 관측 기간 (0~100 percent of total length)
  obsFrom: 0,
  obsTo: 100,
  // 모형 파라미터
  params: {
    maWindow: 12,
    sesAlpha: 0.30,
    holtAlpha: 0.30, holtBeta: 0.10,
    hwAlpha: 0.30, hwBeta: 0.10, hwGamma: 0.30,
    arP: 2, arD: 1, arQ: 2,
    stlAlpha: 0.30,
  },
  // 환율 (USD per KRW) - 1 USD ≈ 1380 KRW
  usdRate: 1380,
  // 결과 캐시
  forecasts: {},
  zoomMode: 'all',
};

/* ============================================================
   모형 카탈로그
   ============================================================ */
const MODELS = {
  // ──── 1) 지수평활 계열 ────
  ses: {
    key: 'ses', name: 'Simple Exp Smoothing', short: 'SES',
    color: '#22d3ee', category: '지수평활',
    enabled: true,
    desc: '과거값에 지수적으로 감소하는 가중치를 부여하는 단순 평활. α 하나로 제어.',
    when: '추세·계절성이 없는 평탄한 데이터',
    pros: '계산 단순, 단일 파라미터',
    cons: '추세·계절성 미반영, 평탄한 예측',
  },
  holt: {
    key: 'holt', name: "Holt's Linear Trend", short: 'HOLT',
    color: '#06b6d4', category: '지수평활',
    enabled: true,
    desc: '레벨(Level)과 추세(Trend) 두 성분을 동시에 평활. SES + 추세선.',
    when: '추세는 있지만 계절성은 없는 데이터',
    pros: '추세 반영 가능',
    cons: '계절성 미반영, 장기 외삽 시 추세 발산 우려',
  },
  hw: {
    key: 'hw', name: 'Holt-Winters', short: 'HW',
    color: '#fbbf24', category: '지수평활',
    enabled: true,
    desc: '레벨·추세·계절성을 모두 평활하는 가법형 모형. 가장 대중적.',
    when: '월별 패턴이 강하고 추세도 있는 시계열',
    pros: '추세+계절성 모두 포착, 비교적 단순',
    cons: '파라미터 3개(α,β,γ) 튜닝 필요',
  },

  // ──── 2) 회귀/ARIMA 계열 ────
  ar: {
    key: 'ar', name: 'AR(p)', short: 'AR',
    color: '#a78bfa', category: 'ARIMA',
    enabled: true,
    desc: '과거 p개 시점의 값으로 현재값을 회귀하는 자기회귀 모형. ARIMA의 핵심 구성 요소.',
    when: '자기상관이 뚜렷한 시계열',
    pros: '구현이 간단하고 ARIMA의 기본',
    cons: '계절성·이동평균 항 없음',
  },
  arima: {
    key: 'arima', name: 'ARIMA', short: 'ARIMA',
    color: '#8b5cf6', category: 'ARIMA',
    enabled: true,
    desc: '자기회귀(AR) + 차분(I) + 이동평균(MA)을 결합한 시계열의 정석.',
    when: '비계절성 시계열의 일반적인 분석',
    pros: '이론적 토대 확립, 다양한 데이터 적용 가능',
    cons: '파라미터 (p,d,q) 선택 필요, 계절성 미반영',
  },
  sarima: {
    key: 'sarima', name: 'SARIMA', short: 'SARIMA',
    color: '#7c3aed', category: 'ARIMA',
    enabled: true,
    desc: 'ARIMA에 계절성 주기를 추가한 모형. 월별·분기별 패턴이 있을 때 강력.',
    when: '강한 계절성 + 추세가 있는 시계열',
    pros: '계절성 패턴 포착, 통계적 신뢰구간 제공',
    cons: '파라미터 7개 (p,d,q)(P,D,Q)m 선택 필요',
  },

  // ──── 3) 분해 계열 ────
  stl: {
    key: 'stl', name: 'STL Decomposition', short: 'STL',
    color: '#f472b6', category: '분해',
    enabled: true,
    desc: 'Loess 기반으로 시계열을 추세·계절성·잔차로 분해 후 각각 외삽.',
    when: '복잡한 계절 패턴, 결측치가 있는 데이터',
    pros: '강건하고 해석이 직관적',
    cons: '추세 외삽은 단순한 방법(나이브 등) 사용',
  },
  prophet: {
    key: 'prophet', name: 'Prophet (NeuralProphet)', short: 'PROPHET',
    color: '#ec4899', category: '분해',
    enabled: false,
    desc: 'Meta(Facebook)의 비즈니스 시계열 특화 모형. 추세+계절성+휴일 효과를 분해.',
    when: '비즈니스 데이터, 결측치/이상치/휴일이 많은 경우',
    pros: '결측치 강건, 휴일 효과 쉽게 반영',
    cons: '브라우저 환경 미지원 (서버 필요)',
  },

  // ──── 4) ML/앙상블 계열 ────
  rf: {
    key: 'rf', name: 'Random Forest', short: 'RF',
    color: '#34d399', category: '머신러닝',
    enabled: true,
    desc: '시계열을 lag/계절성 특징으로 변환하여 다수의 결정나무 앙상블로 회귀.',
    when: '비선형 패턴, 다변량 특징량이 풍부한 경우',
    pros: '오버피팅에 강함, 변수 중요도 제공',
    cons: '외삽 능력 제한적, 추세 학습 어려움',
  },
  xgb: {
    key: 'xgb', name: 'Gradient Boosting', short: 'XGB',
    color: '#10b981', category: '머신러닝',
    enabled: true,
    desc: '경사부스팅(XGBoost/LightGBM 류). lag 특징으로 시계열을 회귀 문제로 변환.',
    when: '복잡한 상호작용, 충분한 학습 데이터',
    pros: '정형 데이터 SOTA, 빠른 학습',
    cons: '시간 외삽 약함, 하이퍼파라미터 다수',
  },

  // ──── 5) 딥러닝 계열 ────
  lstm: {
    key: 'lstm', name: 'LSTM (RNN)', short: 'LSTM',
    color: '#f59e0b', category: '딥러닝',
    enabled: false,
    desc: '시퀀스를 기억하며 학습하는 순환신경망. 장기 의존성 포착.',
    when: '대량 데이터, 비선형 패턴',
    pros: '복잡한 시간 패턴 학습',
    cons: '학습 시간 길고 데이터 많이 필요 (브라우저 미지원)',
  },
  deepar: {
    key: 'deepar', name: 'DeepAR', short: 'DEEPAR',
    color: '#dc2626', category: '딥러닝',
    enabled: false,
    desc: 'Amazon 개발. 다수 시계열의 유사성을 동시 학습하는 확률적 RNN.',
    when: '다수의 관련 시계열, 신제품 수요 예측',
    pros: '확률 분포 출력, 콜드스타트 강건',
    cons: '단일 시계열엔 과한 모형 (브라우저 미지원)',
  },
  tft: {
    key: 'tft', name: 'TFT (Transformer)', short: 'TFT',
    color: '#7c2d12', category: '딥러닝',
    enabled: false,
    desc: '변수별 중요도를 self-attention으로 자동 학습하는 최신 트랜스포머.',
    when: '복잡한 외부 변수가 많은 경우',
    pros: '변수 중요도 해석, SOTA 성능',
    cons: '대량 데이터·GPU 필요 (브라우저 미지원)',
  },

  // ──── 0) 기본 (이전 버전 호환) ────
  ma: {
    key: 'ma', name: '이동평균', short: 'MA',
    color: '#94a3b8', category: '기본',
    enabled: true,
    desc: '최근 N개월 단순 평균을 미래값으로 외삽. 가장 단순한 베이스라인.',
    when: '추세·계절성이 약한 데이터',
    pros: '구현 간단, 노이즈에 강건',
    cons: '추세·계절성 미반영',
  },
  sn: {
    key: 'sn', name: '계절성 단순', short: 'SN',
    color: '#64748b', category: '기본',
    enabled: true,
    desc: '예측 시점의 12개월 전 실측값을 그대로 사용.',
    when: '강한 계절성, 약한 추세',
    pros: '단순하지만 계절성에 효과적',
    cons: '추세 변화 무시',
  },
};

const MODEL_CATEGORIES = ['기본', '지수평활', 'ARIMA', '분해', '머신러닝', '딥러닝'];

/* ============================================================
   예측 모형 구현
   ============================================================ */

// MA
function fitMA(s, periods) {
  const w = STATE.params.maWindow;
  const out = []; const ext = [...s];
  for (let i = 0; i < periods; i++) {
    const v = ext.slice(-w).reduce((a, b) => a + b, 0) / w;
    out.push(v); ext.push(v);
  }
  return out;
}

// SN
function fitSN(s, periods) {
  const out = [];
  for (let h = 0; h < periods; h++) out.push(s[s.length - 12 + (h % 12)]);
  return out;
}

// SES
function fitSES(s, periods) {
  const a = STATE.params.sesAlpha;
  const sm = [s[0]];
  for (let i = 1; i < s.length; i++) sm.push(a * s[i] + (1 - a) * sm[i - 1]);
  return Array(periods).fill(sm[sm.length - 1]);
}

// Holt's Linear Trend
function fitHolt(s, periods) {
  const a = STATE.params.holtAlpha, b = STATE.params.holtBeta;
  const L = [s[0]], T = [s[1] - s[0]];
  for (let i = 1; i < s.length; i++) {
    const pL = L[L.length - 1], pT = T[T.length - 1];
    const nL = a * s[i] + (1 - a) * (pL + pT);
    const nT = b * (nL - pL) + (1 - b) * pT;
    L.push(nL); T.push(nT);
  }
  const lastL = L[L.length - 1], lastT = T[T.length - 1];
  return Array.from({ length: periods }, (_, h) => lastL + (h + 1) * lastT);
}

// Holt-Winters
function fitHW(s, periods) {
  const { hwAlpha: a, hwBeta: b, hwGamma: g } = STATE.params;
  const m = 12, n = s.length;
  if (n < 2 * m) return fitHolt(s, periods);
  const initL = s.slice(0, m).reduce((x, y) => x + y, 0) / m;
  const nextM = s.slice(m, 2 * m).reduce((x, y) => x + y, 0) / m;
  const initT = (nextM - initL) / m;
  const initS = s.slice(0, m).map(v => v - initL);
  const L = [initL], T = [initT], S = [...initS];
  for (let i = 0; i < n; i++) {
    if (i >= m) {
      const pL = L[L.length - 1], pT = T[T.length - 1], pS = S[i - m];
      const nL = a * (s[i] - pS) + (1 - a) * (pL + pT);
      const nT = b * (nL - pL) + (1 - b) * pT;
      const nS = g * (s[i] - nL) + (1 - g) * pS;
      L.push(nL); T.push(nT); S.push(nS);
    }
  }
  const lL = L[L.length - 1], lT = T[T.length - 1];
  const out = [];
  for (let h = 1; h <= periods; h++) {
    const sIdx = S.length - m + ((h - 1) % m);
    out.push(lL + h * lT + S[sIdx]);
  }
  return out;
}

// AR(p) — Yule-Walker 추정의 간이 버전 (최소제곱)
function fitAR(s, periods, p = null) {
  p = p || STATE.params.arP;
  const n = s.length;
  if (n <= p + 5) return fitMA(s, periods);
  // 평균 제거
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const x = s.map(v => v - mean);
  // X (n-p) x p, y (n-p)
  const rows = n - p;
  const X = []; const y = [];
  for (let i = p; i < n; i++) {
    X.push(x.slice(i - p, i).reverse());
    y.push(x[i]);
  }
  // 정규방정식: (X'X)^-1 X'y
  const phi = solveLeastSquares(X, y);
  if (!phi) return fitMA(s, periods);
  const ext = [...x];
  const out = [];
  for (let h = 0; h < periods; h++) {
    let v = 0;
    for (let j = 0; j < p; j++) v += phi[j] * ext[ext.length - 1 - j];
    out.push(v + mean);
    ext.push(v);
  }
  return out;
}

function solveLeastSquares(X, y) {
  // X: m x p, y: m
  const m = X.length, p = X[0].length;
  // Normal eq: A = X'X (pxp), b = X'y (px1)
  const A = Array.from({ length: p }, () => Array(p).fill(0));
  const b = Array(p).fill(0);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < p; j++) {
      b[j] += X[i][j] * y[i];
      for (let k = 0; k < p; k++) A[j][k] += X[i][j] * X[i][k];
    }
  }
  return gaussSolve(A, b);
}
function gaussSolve(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) maxRow = k;
    [M[i], M[maxRow]] = [M[maxRow], M[i]];
    if (Math.abs(M[i][i]) < 1e-12) return null;
    for (let k = i + 1; k < n; k++) {
      const f = M[k][i] / M[i][i];
      for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j];
    }
  }
  const x = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

// ARIMA(p,1,q) — 차분 + AR + MA 잔차의 간이 결합
function fitARIMA(s, periods) {
  const { arP: p, arD: d, arQ: q } = STATE.params;
  // d번 차분
  let diff = [...s];
  const lastVals = [];
  for (let k = 0; k < d; k++) {
    lastVals.push(diff[diff.length - 1]);
    const next = [];
    for (let i = 1; i < diff.length; i++) next.push(diff[i] - diff[i - 1]);
    diff = next;
  }
  // AR 부분 예측
  let arForecast = fitAR(diff, periods, p);
  // MA 항: 최근 잔차의 평균을 첫 시점에만 작게 반영 (안정성 우선)
  if (q > 0 && diff.length > p + q) {
    try {
      const arHist = fitARonHistory(diff, p);
      const resid = diff.slice(p).map((v, i) => v - arHist[i]);
      // 잔차가 너무 크면 무시 (3σ 이상)
      const rMean = resid.reduce((a, b) => a + b, 0) / resid.length;
      const rStd = Math.sqrt(resid.reduce((s, v) => s + (v - rMean) ** 2, 0) / resid.length);
      const recentResid = resid.slice(-q).filter(r => Math.abs(r - rMean) < 3 * rStd);
      const meanResid = recentResid.length > 0
        ? recentResid.reduce((a, b) => a + b, 0) / recentResid.length
        : 0;
      // h=1에만 강하게, 이후 빠르게 감소
      arForecast = arForecast.map((v, i) => v + meanResid * Math.exp(-i * 0.7));
    } catch (e) {}
  }
  // 차분 역변환
  for (let k = d - 1; k >= 0; k--) {
    let cumul = lastVals[k];
    arForecast = arForecast.map(v => { cumul += v; return cumul; });
  }
  return arForecast;
}
function fitARonHistory(s, p) {
  const n = s.length;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const x = s.map(v => v - mean);
  const X = [], y = [];
  for (let i = p; i < n; i++) {
    X.push(x.slice(i - p, i).reverse());
    y.push(x[i]);
  }
  const phi = solveLeastSquares(X, y);
  if (!phi) return s.slice(p);
  return X.map(row => mean + row.reduce((a, b, j) => a + b * phi[j], 0));
}

// SARIMA(p,d,q)(P,D,Q)_m — 계절 차분 + 비계절 ARIMA
function fitSARIMA(s, periods) {
  const m = 12;
  // 계절 차분 D=1
  if (s.length < m + 12) return fitARIMA(s, periods);
  const seasDiff = [];
  for (let i = m; i < s.length; i++) seasDiff.push(s[i] - s[i - m]);
  // 계절 차분된 시리즈는 보통 정상성을 가지므로 ARIMA d=0 적용
  // (원본의 d를 그대로 사용하면 이중 차분이 되어 발산 위험)
  const savedD = STATE.params.arD;
  STATE.params.arD = 0;
  let fcSeasDiff;
  try {
    fcSeasDiff = fitARIMA(seasDiff, periods);
  } finally {
    STATE.params.arD = savedD;
  }
  // 발산 방지: 계절차분 예측이 비현실적으로 크면 클램핑
  const seasMean = seasDiff.reduce((a, b) => a + b, 0) / seasDiff.length;
  const seasStd = Math.sqrt(seasDiff.reduce((s, v) => s + (v - seasMean) ** 2, 0) / seasDiff.length);
  const cap = 3 * seasStd; // ±3σ
  fcSeasDiff = fcSeasDiff.map(v => Math.max(seasMean - cap, Math.min(seasMean + cap, v)));
  // 계절 역변환: 미래 값 = 12개월 전 값 + 예측된 계절차분
  const out = [];
  for (let h = 0; h < periods; h++) {
    const seasonalRef = h < m
      ? s[s.length - m + h]
      : out[h - m];
    out.push(seasonalRef + fcSeasDiff[h]);
  }
  return out;
}

// STL Decomposition (단순화 버전)
function fitSTL(s, periods) {
  const m = 12, n = s.length;
  if (n < 2 * m) return fitHW(s, periods);
  // 1) 추세: 13개월 중심 이동평균
  const trend = [];
  const w = m + 1; // 13
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - Math.floor(w / 2));
    const hi = Math.min(n, i + Math.floor(w / 2) + 1);
    const slice = s.slice(lo, hi);
    trend.push(slice.reduce((a, b) => a + b, 0) / slice.length);
  }
  // 2) 디트렌딩
  const detrended = s.map((v, i) => v - trend[i]);
  // 3) 계절성: 월별 평균
  const seasonal = Array(m).fill(0);
  const counts = Array(m).fill(0);
  detrended.forEach((v, i) => { seasonal[i % m] += v; counts[i % m]++; });
  for (let i = 0; i < m; i++) seasonal[i] /= counts[i];
  // 정규화 (sum=0)
  const sMean = seasonal.reduce((a, b) => a + b, 0) / m;
  for (let i = 0; i < m; i++) seasonal[i] -= sMean;
  // 4) 잔차 (분석용, 예측에는 미사용)
  // 5) 추세 외삽: Holt 적용
  const trendForecast = fitHoltOnTrend(trend, periods);
  // 6) 결합
  const out = [];
  for (let h = 0; h < periods; h++) {
    const sIdx = (n + h) % m;
    out.push(trendForecast[h] + seasonal[sIdx]);
  }
  return out;
}
function fitHoltOnTrend(trend, periods) {
  const a = 0.3, b = 0.1;
  const L = [trend[0]], T = [trend[1] - trend[0]];
  for (let i = 1; i < trend.length; i++) {
    const pL = L[L.length - 1], pT = T[T.length - 1];
    L.push(a * trend[i] + (1 - a) * (pL + pT));
    T.push(b * (L[L.length - 1] - pL) + (1 - b) * pT);
  }
  const lL = L[L.length - 1], lT = T[T.length - 1];
  return Array.from({ length: periods }, (_, h) => lL + (h + 1) * lT);
}

// Random Forest (간이) — bootstrap regression trees
function fitRF(s, periods) {
  const lags = 12;
  const n = s.length;
  if (n < lags + 24) return fitHW(s, periods);
  // 특징량: lag1..lag12 + month
  const X = [], y = [];
  for (let i = lags; i < n; i++) {
    X.push([...s.slice(i - lags, i), i % 12]);
    y.push(s[i]);
  }
  // 트리 다수 학습
  const nTrees = 30;
  const trees = [];
  for (let t = 0; t < nTrees; t++) {
    const sample = [], sampleY = [];
    for (let i = 0; i < X.length; i++) {
      const idx = Math.floor(Math.random() * X.length);
      sample.push(X[idx]); sampleY.push(y[idx]);
    }
    trees.push(buildTree(sample, sampleY, 0, 6));
  }
  // 예측
  const ext = [...s];
  const out = [];
  for (let h = 0; h < periods; h++) {
    const feat = [...ext.slice(-lags), (n + h) % 12];
    const preds = trees.map(t => predictTree(t, feat));
    const v = preds.reduce((a, b) => a + b, 0) / preds.length;
    out.push(v); ext.push(v);
  }
  return out;
}
function buildTree(X, y, depth, maxDepth) {
  if (X.length < 4 || depth >= maxDepth) {
    return { leaf: true, value: y.reduce((a, b) => a + b, 0) / y.length };
  }
  // 변수 무작위 선택
  const nFeat = X[0].length;
  const tryFeats = Array.from({ length: Math.max(2, Math.floor(Math.sqrt(nFeat))) },
    () => Math.floor(Math.random() * nFeat));
  let best = null;
  for (const f of tryFeats) {
    const vals = X.map(row => row[f]).sort((a, b) => a - b);
    const splits = [vals[Math.floor(vals.length / 4)], vals[Math.floor(vals.length / 2)], vals[Math.floor(vals.length * 3 / 4)]];
    for (const split of splits) {
      const leftIdx = [], rightIdx = [];
      X.forEach((row, i) => row[f] <= split ? leftIdx.push(i) : rightIdx.push(i));
      if (leftIdx.length < 2 || rightIdx.length < 2) continue;
      const leftY = leftIdx.map(i => y[i]);
      const rightY = rightIdx.map(i => y[i]);
      const score = variance(y) - (leftY.length * variance(leftY) + rightY.length * variance(rightY)) / y.length;
      if (!best || score > best.score) {
        best = { score, f, split, leftIdx, rightIdx };
      }
    }
  }
  if (!best) return { leaf: true, value: y.reduce((a, b) => a + b, 0) / y.length };
  const leftX = best.leftIdx.map(i => X[i]);
  const leftY = best.leftIdx.map(i => y[i]);
  const rightX = best.rightIdx.map(i => X[i]);
  const rightY = best.rightIdx.map(i => y[i]);
  return {
    leaf: false, f: best.f, split: best.split,
    left: buildTree(leftX, leftY, depth + 1, maxDepth),
    right: buildTree(rightX, rightY, depth + 1, maxDepth),
  };
}
function predictTree(tree, feat) {
  if (tree.leaf) return tree.value;
  return feat[tree.f] <= tree.split ? predictTree(tree.left, feat) : predictTree(tree.right, feat);
}
function variance(arr) {
  if (arr.length < 2) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length;
}

// Gradient Boosting (간이)
function fitXGB(s, periods) {
  const lags = 12;
  const n = s.length;
  if (n < lags + 24) return fitHW(s, periods);
  const X = [], y = [];
  for (let i = lags; i < n; i++) {
    X.push([...s.slice(i - lags, i), i % 12]);
    y.push(s[i]);
  }
  // 초기 예측: 평균
  const initPred = y.reduce((a, b) => a + b, 0) / y.length;
  const trees = [];
  let curPred = Array(y.length).fill(initPred);
  const lr = 0.1;
  const nRounds = 50;
  for (let r = 0; r < nRounds; r++) {
    const resid = y.map((v, i) => v - curPred[i]);
    const tree = buildTree(X, resid, 0, 4);
    trees.push(tree);
    curPred = curPred.map((v, i) => v + lr * predictTree(tree, X[i]));
  }
  // 예측
  const ext = [...s];
  const out = [];
  for (let h = 0; h < periods; h++) {
    const feat = [...ext.slice(-lags), (n + h) % 12];
    let v = initPred;
    trees.forEach(t => v += lr * predictTree(t, feat));
    out.push(v); ext.push(v);
  }
  return out;
}

const MODEL_FN = {
  ma: fitMA, sn: fitSN,
  ses: fitSES, holt: fitHolt, hw: fitHW,
  ar: fitAR, arima: fitARIMA, sarima: fitSARIMA,
  stl: fitSTL,
  rf: fitRF, xgb: fitXGB,
};

/* ============================================================
   백테스트 / 잔차
   ============================================================ */
function backtestMape(series, key, holdout = 12) {
  if (series.length <= holdout + 12) return null;
  if (!MODEL_FN[key]) return null;
  try {
    const train = series.slice(0, -holdout);
    const test = series.slice(-holdout);
    const pred = MODEL_FN[key](train, holdout);
    let sum = 0, n = 0;
    for (let i = 0; i < holdout; i++) {
      if (test[i] === 0) continue;
      sum += Math.abs((test[i] - pred[i]) / test[i]);
      n++;
    }
    return n > 0 ? (sum / n) * 100 : null;
  } catch (e) { return null; }
}
function residualStd(series, key) {
  const n = series.length;
  if (n < 24 || !MODEL_FN[key]) return 0;
  const residuals = [];
  // 1-step-ahead 잔차 (최근 12개월만 효율을 위해)
  const startFrom = Math.max(12, n - 24);
  for (let i = startFrom; i < n; i++) {
    try {
      const pred = MODEL_FN[key](series.slice(0, i), 1);
      residuals.push(series[i] - pred[0]);
    } catch (e) {}
  }
  if (residuals.length < 2) return 0;
  const mean = residuals.reduce((a, b) => a + b, 0) / residuals.length;
  const v = residuals.reduce((s, r) => s + (r - mean) ** 2, 0) / (residuals.length - 1);
  return Math.sqrt(v);
}

/* ============================================================
   시리즈 추출 헬퍼
   ============================================================ */
function getSeries(direction, scope, metric) {
  // direction: 'import'|'export', scope: 'ec'|'total', metric: 'amount'|'count'
  const data = STATE.data[direction];
  if (!data) return null;
  const colMap = {
    ec_amount: 'ec_amount', ec_count: 'ec_count',
    total_amount: 'total_amount', total_count: 'total_count'
  };
  const col = colMap[`${scope}_${metric}`];
  return data.rows.map(r => ({
    date: r.date, year: r.year, month: r.month,
    value: r[col],
  }));
}
function getActiveSeries() {
  // 현재 UI 옵션에 따라 활성 시리즈 목록 반환
  const directions = STATE.direction === 'both' ? ['import', 'export'] : [STATE.direction];
  const metrics = STATE.metric === 'both' ? ['amount', 'count'] : [STATE.metric];
  const list = [];
  directions.forEach(d => {
    metrics.forEach(m => {
      const series = getSeries(d, STATE.scope, m);
      if (series) {
        list.push({
          id: `${d}_${m}`,
          direction: d,
          metric: m,
          label: `${d === 'import' ? '수입' : '수출'} ${m === 'amount' ? '금액' : '건수'}`,
          series,
          unit: m === 'amount' ? STATE.currency : 'count',
          color: getSeriesColor(d, m),
        });
      }
    });
  });
  return list;
}
function getSeriesColor(direction, metric) {
  // 수입=cyan/teal 계열, 수출=pink/rose 계열, 금액=진한, 건수=연한
  if (direction === 'import') return metric === 'amount' ? '#06b6d4' : '#67e8f9';
  return metric === 'amount' ? '#ec4899' : '#fda4af';
}
function getActiveTrainSeries(series) {
  // 관측 기간 슬라이더 적용
  const n = series.length;
  const fromIdx = Math.floor((STATE.obsFrom / 100) * n);
  const toIdx = Math.ceil((STATE.obsTo / 100) * n);
  return series.slice(fromIdx, toIdx);
}

/* ============================================================
   예측 계산 (모든 활성 시리즈 × 선택 모형)
   ============================================================ */
function computeAllForecasts() {
  const activeList = getActiveSeries();
  if (activeList.length === 0) return null;

  const result = {};
  const periods = STATE.period;
  const z = STATE.ciLevel === 99 ? 2.576 : STATE.ciLevel === 95 ? 1.96 : 1.28;

  activeList.forEach(item => {
    const fullSeries = item.series;
    const trainSeries = getActiveTrainSeries(fullSeries);
    if (trainSeries.length < 24) {
      result[item.id] = { ...item, error: '데이터 부족 (최소 24개월 필요)' };
      return;
    }
    const trainValues = trainSeries.map(d => d.value);

    // 미래 라벨 (전체 시리즈의 마지막 시점 기준)
    const lastDate = trainSeries[trainSeries.length - 1];
    const futureLabels = [];
    for (let i = 1; i <= periods; i++) {
      const total = lastDate.month + i;
      const y = lastDate.year + Math.floor((total - 1) / 12);
      const mo = ((total - 1) % 12) + 1;
      futureLabels.push({ year: y, month: mo, date: `${y}-${String(mo).padStart(2, '0')}` });
    }

    // 모형별 예측
    const predictions = {};
    const accuracies = {};
    const stds = {};
    // 양수 시리즈 검출 (학습 데이터가 모두 ≥0이면 예측도 음수가 되지 않도록 가드)
    const isNonNegative = trainValues.every(v => v >= 0);
    const clampNN = arr => isNonNegative ? arr.map(v => Math.max(0, v)) : arr;

    STATE.selectedModels.forEach(k => {
      if (!MODELS[k] || !MODELS[k].enabled) return;
      try {
        predictions[k] = clampNN(MODEL_FN[k](trainValues, periods));
        accuracies[k] = backtestMape(trainValues, k);
        stds[k] = residualStd(trainValues, k);
      } catch (e) {
        console.warn(`Model ${k} failed for ${item.id}:`, e);
      }
    });

    // 앙상블
    const validKeys = Object.keys(predictions);
    if (validKeys.length >= 2) {
      const ens = [];
      for (let i = 0; i < periods; i++) {
        let s = 0;
        validKeys.forEach(k => s += predictions[k][i]);
        ens.push(s / validKeys.length);
      }
      predictions.ensemble = clampNN(ens);
      const stdAvg = validKeys.map(k => stds[k]).reduce((a, b) => a + b, 0) / validKeys.length;
      stds.ensemble = stdAvg / Math.sqrt(validKeys.length);
    }

    // 신뢰구간 (양수 시리즈는 lower bound도 0으로 클램핑)
    const intervals = {};
    Object.keys(predictions).forEach(k => {
      intervals[k] = predictions[k].map((v, i) => {
        const margin = z * (stds[k] || 0) * Math.sqrt(i + 1);
        const lower = v - margin;
        const upper = v + margin;
        return {
          lower: isNonNegative ? Math.max(0, lower) : lower,
          upper,
        };
      });
    });

    result[item.id] = {
      ...item,
      trainSeries, trainValues, fullSeries,
      futureLabels, predictions, intervals, accuracies, stds,
      lastDate,
    };
  });

  return result;
}

/* ============================================================
   포맷터
   ============================================================ */
function formatValue(n, unit) {
  if (n == null || isNaN(n)) return '-';
  if (unit === 'count') return formatCount(n);
  return formatMoney(n);
}
// 원본 데이터의 통화 단위는 USD(미달러)입니다.
// BANDTrass 무역통계는 USD 기준으로 제공됨.
// STATE.currency는 "표시 단위 선택"으로, KRW 선택 시 환율을 곱해 원화로 환산합니다.
function formatMoney(n) {
  const cur = STATE.currency;
  if (cur === 'KRW') {
    // 원본 USD → KRW로 환산 표시
    n = n * STATE.usdRate;
    if (Math.abs(n) >= 1e12) return (n / 1e12).toFixed(2) + '조원';
    if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + '억원';
    if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(1) + '만원';
    return Math.round(n).toLocaleString() + '원';
  } else {
    // 원본이 이미 USD이므로 변환 없이 표시
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n).toLocaleString();
  }
}
function formatCount(n) {
  if (Math.abs(n) >= 1e8) return (n / 1e8).toFixed(2) + '억건';
  if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(1) + '만건';
  return Math.round(n).toLocaleString() + '건';
}

/* ============================================================
   UI 렌더링
   ============================================================ */

function renderModelGrid() {
  const grid = document.getElementById('model-grid');
  grid.innerHTML = '';
  Object.values(MODELS).forEach(m => {
    const checked = STATE.selectedModels.includes(m.key);
    const disabled = !m.enabled;
    const div = document.createElement('div');
    div.className = `model-card ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}`;
    div.style.setProperty('--m-color', m.color);
    div.innerHTML = `
      <div class="model-info-btn" data-key="${m.key}">i</div>
      <div class="model-tooltip">
        <span class="tt-tag">${m.category}</span>
        <h5>${m.name}${disabled ? ' <span style="color:#f59e0b;">(준비중)</span>' : ''}</h5>
        <div>${m.desc}</div>
        <ul>
          <li><b>적합:</b> ${m.when}</li>
          <li><b>장점:</b> ${m.pros}</li>
          <li><b>단점:</b> ${m.cons}</li>
        </ul>
      </div>
      <div class="model-card-head">
        <div class="model-dot" style="background:${m.color}"></div>
        <div class="model-name">${m.name}${checked ? `
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="${m.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        ` : ''}</div>
      </div>
      <div style="display:flex; align-items:center; gap:6px;">
        <span class="model-cat">${m.category}</span>
        <span class="model-short">${m.short}</span>
      </div>
    `;
    if (!disabled) {
      div.onclick = (e) => {
        if (e.target.closest('.model-info-btn') || e.target.closest('.model-tooltip')) return;
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
    } else {
      div.onclick = () => showToast(`${m.name}: ${m.cons}`);
    }
    grid.appendChild(div);
  });
}

function renderAdvParams() {
  const grid = document.getElementById('adv-grid');
  const items = [];
  if (STATE.selectedModels.includes('ma')) items.push({ id: 'maWindow', label: '이동평균 윈도우', min: 3, max: 24, step: 1, fmt: v => Math.round(v) });
  if (STATE.selectedModels.includes('ses')) items.push({ id: 'sesAlpha', label: 'SES α', min: 0.05, max: 0.95, step: 0.05, fmt: v => v.toFixed(2) });
  if (STATE.selectedModels.includes('holt')) {
    items.push({ id: 'holtAlpha', label: "Holt α", min: 0.05, max: 0.95, step: 0.05, fmt: v => v.toFixed(2) });
    items.push({ id: 'holtBeta', label: "Holt β", min: 0.01, max: 0.50, step: 0.01, fmt: v => v.toFixed(2) });
  }
  if (STATE.selectedModels.includes('hw')) {
    items.push({ id: 'hwAlpha', label: 'HW α', min: 0.05, max: 0.95, step: 0.05, fmt: v => v.toFixed(2) });
    items.push({ id: 'hwBeta', label: 'HW β', min: 0.01, max: 0.50, step: 0.01, fmt: v => v.toFixed(2) });
    items.push({ id: 'hwGamma', label: 'HW γ', min: 0.05, max: 0.95, step: 0.05, fmt: v => v.toFixed(2) });
  }
  if (STATE.selectedModels.includes('ar') || STATE.selectedModels.includes('arima') || STATE.selectedModels.includes('sarima')) {
    items.push({ id: 'arP', label: 'ARIMA p', min: 1, max: 5, step: 1, fmt: v => Math.round(v) });
    items.push({ id: 'arD', label: 'ARIMA d', min: 0, max: 2, step: 1, fmt: v => Math.round(v) });
    items.push({ id: 'arQ', label: 'ARIMA q', min: 0, max: 5, step: 1, fmt: v => Math.round(v) });
  }

  grid.innerHTML = items.length === 0
    ? '<div class="text-xs text-muted">선택한 모형이 없거나 조정 가능한 파라미터가 없습니다.</div>'
    : items.map(it => `
      <div class="adv-item">
        <div class="adv-head">
          <span>${it.label}</span>
          <span class="hl num" id="lbl-${it.id}">${it.fmt(STATE.params[it.id])}</span>
        </div>
        <input type="range" id="param-${it.id}" min="${it.min}" max="${it.max}" step="${it.step}" value="${STATE.params[it.id]}" />
      </div>
    `).join('');

  items.forEach(it => {
    const slider = document.getElementById(`param-${it.id}`);
    const lbl = document.getElementById(`lbl-${it.id}`);
    slider.oninput = () => {
      STATE.params[it.id] = parseFloat(slider.value);
      lbl.textContent = it.fmt(STATE.params[it.id]);
    };
    slider.onchange = () => update();
  });
}

function renderKPI() {
  const grid = document.getElementById('kpi-grid');
  if (!STATE.forecasts || Object.keys(STATE.forecasts).length === 0) {
    grid.innerHTML = ''; return;
  }
  const items = Object.values(STATE.forecasts).filter(f => !f.error);
  if (items.length === 0) { grid.innerHTML = ''; return; }

  const periodLabel = `${STATE.period}M`;
  const cards = [];

  items.forEach(item => {
    const fcKey = item.predictions.ensemble ? 'ensemble' : Object.keys(item.predictions)[0];
    if (!fcKey) return;
    const fcSum = item.predictions[fcKey].reduce((a, b) => a + b, 0);
    const lastSum = item.trainValues.slice(-STATE.period).reduce((a, b) => a + b, 0);
    const yoy = lastSum > 0 ? ((fcSum - lastSum) / lastSum) * 100 : 0;

    cards.push(`
      <div class="kpi-card">
        <div class="kpi-label">
          <span class="model-dot" style="background:${item.color}"></span>
          ${item.label} 예측 ${periodLabel}
        </div>
        <div class="kpi-value num" style="color:${item.color}">${formatValue(fcSum, item.unit)}</div>
        <div class="kpi-sub">최근 ${periodLabel}: ${formatValue(lastSum, item.unit)} <span style="color:${yoy >= 0 ? 'var(--pos)' : 'var(--neg)'}">${yoy >= 0 ? '+' : ''}${yoy.toFixed(1)}%</span></div>
      </div>
    `);
  });

  grid.innerHTML = cards.join('');
}

/* ============================================================
   차트 렌더링 (다중 시리즈)
   ============================================================ */
function renderChart() {
  const svg = document.getElementById('chart-svg');
  svg.innerHTML = '';
  const items = STATE.forecasts ? Object.values(STATE.forecasts).filter(f => !f.error) : [];
  if (items.length === 0) {
    svg.innerHTML = `<text x="50%" y="50%" text-anchor="middle" fill="var(--text-2)" font-size="13">데이터를 업로드하거나 샘플을 불러오세요</text>`;
    return;
  }

  const W = svg.clientWidth || 1200;
  const H = 480;
  const M = { top: 30, right: 80, bottom: 50, left: 80 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

  // 시리즈가 다른 단위(금액 vs 건수)면 dual-axis, 같은 단위면 단일 축
  const hasAmount = items.some(i => i.metric === 'amount');
  const hasCount = items.some(i => i.metric === 'count');
  const dualAxis = hasAmount && hasCount;

  // X축 데이터 통합 (가장 긴 시리즈 기준)
  const longest = items.reduce((a, b) => a.fullSeries.length > b.fullSeries.length ? a : b);
  const allDates = [...longest.fullSeries.map(d => d.date), ...longest.futureLabels.map(f => f.date)];

  // 줌 적용
  let visibleDates = allDates;
  if (STATE.zoomMode === 'recent') {
    visibleDates = allDates.slice(-(24 + STATE.period));
  } else if (STATE.zoomMode === 'forecast') {
    visibleDates = allDates.slice(-Math.min(12, longest.fullSeries.length) - STATE.period);
  }
  const visStartIdx = allDates.indexOf(visibleDates[0]);

  // 각 시리즈에 대해 Y스케일 계산
  const yRanges = { amount: [Infinity, -Infinity], count: [Infinity, -Infinity] };
  items.forEach(item => {
    const range = yRanges[item.metric];
    item.fullSeries.forEach((d, i) => {
      const absIdx = i - (item.fullSeries.length - longest.fullSeries.length);
      if (absIdx >= visStartIdx) {
        range[0] = Math.min(range[0], d.value);
        range[1] = Math.max(range[1], d.value);
      }
    });
    Object.keys(item.predictions).forEach(k => {
      item.predictions[k].forEach((v, i) => {
        const lo = STATE.output === 'point' ? v : item.intervals[k][i].lower;
        const hi = STATE.output === 'point' ? v : item.intervals[k][i].upper;
        range[0] = Math.min(range[0], lo);
        range[1] = Math.max(range[1], hi);
      });
    });
  });
  ['amount', 'count'].forEach(m => {
    if (yRanges[m][0] === Infinity) return;
    const pad = (yRanges[m][1] - yRanges[m][0]) * 0.08;
    yRanges[m][0] -= pad;
    yRanges[m][1] += pad;
    if (yRanges[m][0] < 0) yRanges[m][0] = 0;
  });

  const N = visibleDates.length;
  const xScale = i => M.left + (i / Math.max(N - 1, 1)) * innerW;
  const yScale = (v, metric) => {
    const [lo, hi] = yRanges[metric];
    return M.top + innerH - ((v - lo) / (hi - lo)) * innerH;
  };

  const ns = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs) => {
    const e = document.createElementNS(ns, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    svg.appendChild(e);
    return e;
  };

  // 그리드
  const yTicks = 5;
  const primMetric = hasAmount ? 'amount' : 'count';
  for (let i = 0; i <= yTicks; i++) {
    const v = yRanges[primMetric][0] + ((yRanges[primMetric][1] - yRanges[primMetric][0]) * i) / yTicks;
    const y = yScale(v, primMetric);
    el('line', { x1: M.left, x2: W - M.right, y1: y, y2: y, stroke: 'var(--line)', 'stroke-dasharray': '2,4', 'stroke-width': 1 });
    el('text', { x: M.left - 8, y: y + 4, fill: 'var(--text-2)', 'font-size': 10, 'text-anchor': 'end', 'font-family': 'JetBrains Mono' })
      .textContent = formatValue(v, primMetric === 'amount' ? STATE.currency : 'count');
  }
  // 우측 축 (dual)
  if (dualAxis) {
    const secMetric = primMetric === 'amount' ? 'count' : 'amount';
    for (let i = 0; i <= yTicks; i++) {
      const v = yRanges[secMetric][0] + ((yRanges[secMetric][1] - yRanges[secMetric][0]) * i) / yTicks;
      const y = yScale(v, secMetric);
      el('text', { x: W - M.right + 8, y: y + 4, fill: 'var(--text-2)', 'font-size': 10, 'text-anchor': 'start', 'font-family': 'JetBrains Mono' })
        .textContent = formatValue(v, secMetric === 'amount' ? STATE.currency : 'count');
    }
  }

  // X축 라벨
  const labelStep = Math.max(1, Math.floor(N / 10));
  visibleDates.forEach((d, i) => {
    if (i % labelStep === 0 || i === N - 1) {
      el('text', { x: xScale(i), y: H - 15, fill: 'var(--text-2)', 'font-size': 10, 'text-anchor': 'middle', 'font-family': 'JetBrains Mono' })
        .textContent = d;
    }
  });

  // 예측 시작점
  const forecastStart = longest.fullSeries.length;
  if (forecastStart >= visStartIdx) {
    const fIdx = forecastStart - visStartIdx;
    if (fIdx > 0 && fIdx <= N) {
      const x = xScale(fIdx - 0.5);
      el('line', { x1: x, x2: x, y1: M.top, y2: M.top + innerH, stroke: 'var(--warn)', 'stroke-dasharray': '4,4', 'stroke-width': 1.5, opacity: 0.6 });
      el('text', { x: x + 6, y: M.top + 14, fill: 'var(--warn)', 'font-size': 10, 'font-weight': 600 }).textContent = '▶ 예측 시작';
      el('rect', { x, y: M.top, width: xScale(N - 1) - x, height: innerH, fill: 'var(--warn)', opacity: 0.04 });
    }
  }

  // 각 시리즈 그리기
  items.forEach((item, itemIdx) => {
    // 정렬 - 전체 시리즈에서 visible 범위 인덱스 매핑
    const seriesStartOffset = longest.fullSeries.length - item.fullSeries.length;

    // 실측 라인
    let path = '';
    let started = false;
    item.fullSeries.forEach((d, i) => {
      const absIdx = i + seriesStartOffset;
      const visIdx = absIdx - visStartIdx;
      if (visIdx < 0 || visIdx >= N) return;
      const x = xScale(visIdx), y = yScale(d.value, item.metric);
      path += `${started ? 'L' : 'M'} ${x} ${y} `;
      started = true;
    });
    if (path) {
      el('path', { d: path, stroke: item.color, 'stroke-width': 2, fill: 'none', 'stroke-linejoin': 'round', opacity: 0.9 });
    }

    // 예측 라인 (모형별)
    Object.keys(item.predictions).forEach(modelKey => {
      const isEnsemble = modelKey === 'ensemble';
      const baseColor = isEnsemble ? item.color : MODELS[modelKey]?.color || item.color;

      // 신뢰구간 (interval/both)
      if (STATE.output === 'interval' || STATE.output === 'both') {
        const upper = [], lower = [];
        item.predictions[modelKey].forEach((v, i) => {
          const visIdx = forecastStart - visStartIdx + i;
          if (visIdx < 0 || visIdx >= N) return;
          const intv = item.intervals[modelKey][i];
          upper.push(`${xScale(visIdx)},${yScale(intv.upper, item.metric)}`);
          lower.push(`${xScale(visIdx)},${yScale(intv.lower, item.metric)}`);
        });
        if (upper.length > 0) {
          // 폴리곤 점 순서:
          //   [마지막실측, upper(좌→우), lower(우→좌), 마지막실측] 으로 시계방향 폐곡선 형성
          const lastVisIdx = forecastStart - 1 - visStartIdx;
          const polyPoints = [];
          if (lastVisIdx >= 0 && lastVisIdx < N) {
            const lastVal = item.fullSeries[item.fullSeries.length - 1].value;
            const startPoint = `${xScale(lastVisIdx)},${yScale(lastVal, item.metric)}`;
            polyPoints.push(startPoint);
            polyPoints.push(...upper);
            polyPoints.push(...[...lower].reverse());
          } else {
            polyPoints.push(...upper);
            polyPoints.push(...[...lower].reverse());
          }
          el('polygon', {
            points: polyPoints.join(' '),
            fill: baseColor, opacity: isEnsemble ? 0.12 : 0.07, stroke: 'none',
          });
        }
      }

      // 점 예측 라인
      if (STATE.output === 'point' || STATE.output === 'both') {
        const lastVisIdx = forecastStart - 1 - visStartIdx;
        let p = '';
        if (lastVisIdx >= 0 && lastVisIdx < N) {
          const lastVal = item.fullSeries[item.fullSeries.length - 1].value;
          p = `M ${xScale(lastVisIdx)} ${yScale(lastVal, item.metric)} `;
        }
        item.predictions[modelKey].forEach((v, i) => {
          const visIdx = forecastStart - visStartIdx + i;
          if (visIdx < 0 || visIdx >= N) return;
          p += `${p ? 'L' : 'M'} ${xScale(visIdx)} ${yScale(v, item.metric)} `;
        });
        if (p) {
          el('path', {
            d: p, stroke: baseColor,
            'stroke-width': isEnsemble ? 2.5 : 1.8,
            'stroke-dasharray': isEnsemble ? '0' : '5,3',
            fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
            opacity: isEnsemble ? 0.95 : 0.75,
          });
        }
        // 점
        item.predictions[modelKey].forEach((v, i) => {
          const visIdx = forecastStart - visStartIdx + i;
          if (visIdx < 0 || visIdx >= N) return;
          el('circle', {
            cx: xScale(visIdx), cy: yScale(v, item.metric),
            r: isEnsemble ? 3 : 2.5, fill: baseColor,
            stroke: 'var(--bg-1)', 'stroke-width': 1.2,
          });
        });
      }
    });
  });

  // 호버 인터랙션
  const crosshairV = el('line', { x1: 0, x2: 0, y1: M.top, y2: M.top + innerH, stroke: 'var(--accent)', 'stroke-width': 1, 'stroke-dasharray': '3,3', opacity: 0 });
  const overlay = el('rect', { x: M.left, y: M.top, width: innerW, height: innerH, fill: 'transparent', cursor: 'crosshair' });
  const hoverDots = [];
  const tooltip = document.getElementById('chart-tooltip');

  overlay.addEventListener('mousemove', (e) => {
    const rect = svg.getBoundingClientRect();
    const sx = W / rect.width;
    const mx = (e.clientX - rect.left) * sx;
    const my = (e.clientY - rect.top) * (H / rect.height);

    let nIdx = 0, mDist = Infinity;
    for (let i = 0; i < N; i++) {
      const d = Math.abs(xScale(i) - mx);
      if (d < mDist) { mDist = d; nIdx = i; }
    }
    const xPos = xScale(nIdx);
    crosshairV.setAttribute('x1', xPos);
    crosshairV.setAttribute('x2', xPos);
    crosshairV.setAttribute('opacity', 0.5);
    hoverDots.forEach(d => d.remove());
    hoverDots.length = 0;

    const dateLabel = visibleDates[nIdx];
    const isForecast = nIdx + visStartIdx >= forecastStart;
    let html = `<div style="font-weight:700;color:var(--accent);margin-bottom:6px;font-family:'JetBrains Mono',monospace;font-size:13px;">${dateLabel}${isForecast ? ' <span style="color:var(--warn);font-size:10px;">예측</span>' : ''}</div>`;

    items.forEach(item => {
      const seriesStartOffset = longest.fullSeries.length - item.fullSeries.length;
      const localIdx = nIdx + visStartIdx - seriesStartOffset;
      let val = null, label = item.label, color = item.color;

      if (!isForecast) {
        // 실측
        if (localIdx >= 0 && localIdx < item.fullSeries.length) {
          val = item.fullSeries[localIdx].value;
          html += `<div style="display:flex;justify-content:space-between;gap:12px;margin:2px 0;">
            <span style="display:flex;align-items:center;gap:6px;"><span class="model-dot" style="background:${color}"></span>${label}</span>
            <span class="num" style="font-weight:700;color:${color}">${formatValue(val, item.unit)}</span>
          </div>`;
          const c = document.createElementNS(ns, 'circle');
          c.setAttribute('cx', xPos); c.setAttribute('cy', yScale(val, item.metric));
          c.setAttribute('r', 5); c.setAttribute('fill', color);
          c.setAttribute('stroke', 'var(--bg-1)'); c.setAttribute('stroke-width', 2);
          svg.appendChild(c); hoverDots.push(c);
        }
      } else {
        // 예측
        const fcIdx = nIdx + visStartIdx - forecastStart;
        if (fcIdx < 0 || fcIdx >= STATE.period) return;
        // 시리즈별로 모형 합치 표시
        Object.keys(item.predictions).forEach(modelKey => {
          const v = item.predictions[modelKey][fcIdx];
          const intv = item.intervals[modelKey][fcIdx];
          const mColor = modelKey === 'ensemble' ? color : (MODELS[modelKey]?.color || color);
          const mName = modelKey === 'ensemble' ? '앙상블' : MODELS[modelKey]?.short || modelKey;
          html += `<div style="display:flex;justify-content:space-between;gap:12px;margin:2px 0;font-size:11px;">
            <span style="display:flex;align-items:center;gap:6px;"><span class="model-dot" style="background:${mColor};width:8px;height:8px;"></span>${label} · ${mName}</span>
            <span class="num" style="font-weight:600;color:${mColor}">${formatValue(v, item.unit)}</span>
          </div>`;
          if (STATE.output !== 'point') {
            html += `<div style="font-size:9px;color:var(--text-2);text-align:right;font-family:'JetBrains Mono',monospace;margin-bottom:2px;">[${formatValue(intv.lower, item.unit)} ~ ${formatValue(intv.upper, item.unit)}]</div>`;
          }
          const c = document.createElementNS(ns, 'circle');
          c.setAttribute('cx', xPos); c.setAttribute('cy', yScale(v, item.metric));
          c.setAttribute('r', 4); c.setAttribute('fill', mColor);
          c.setAttribute('stroke', 'var(--bg-1)'); c.setAttribute('stroke-width', 1.5);
          svg.appendChild(c); hoverDots.push(c);
        });
      }
    });

    tooltip.innerHTML = html;
    tooltip.classList.remove('hidden');
    const cRect = svg.parentElement.getBoundingClientRect();
    const tw = tooltip.offsetWidth;
    let left = (xPos / W) * cRect.width + 14;
    if (left + tw > cRect.width - 8) left = (xPos / W) * cRect.width - tw - 14;
    tooltip.style.left = Math.max(8, left) + 'px';
    tooltip.style.top = Math.max(0, (my / H) * cRect.height - 30) + 'px';
  });

  overlay.addEventListener('mouseleave', () => {
    crosshairV.setAttribute('opacity', 0);
    tooltip.classList.add('hidden');
    hoverDots.forEach(d => d.remove());
    hoverDots.length = 0;
  });
}

function renderChartLegend() {
  const legend = document.getElementById('chart-legend');
  if (!STATE.forecasts) { legend.innerHTML = ''; return; }
  const items = Object.values(STATE.forecasts).filter(f => !f.error);
  let html = '';
  items.forEach(item => {
    html += `<span class="legend-item"><span class="legend-line" style="background:${item.color}"></span><b>${item.label}</b> (실측)</span>`;
  });
  STATE.selectedModels.forEach(k => {
    if (!MODELS[k] || !MODELS[k].enabled) return;
    html += `<span class="legend-item" style="color:${MODELS[k].color}"><span class="legend-line dashed" style="color:${MODELS[k].color}"></span>${MODELS[k].short}</span>`;
  });
  if (STATE.selectedModels.length >= 2) {
    html += `<span class="legend-item">★ 앙상블 (시리즈별 색)</span>`;
  }
  if (STATE.output !== 'point') {
    html += `<span class="legend-item"><span class="legend-area" style="background:var(--accent);opacity:0.15;border:1px solid var(--accent);"></span>${STATE.ciLevel}% 신뢰구간</span>`;
  }
  legend.innerHTML = html;
}

function renderAccuracy() {
  const div = document.getElementById('accuracy-list');
  if (!STATE.forecasts) { div.innerHTML = ''; return; }
  const items = Object.values(STATE.forecasts).filter(f => !f.error);
  if (items.length === 0) { div.innerHTML = ''; return; }

  // 시리즈별 모형별 MAPE 평균
  const mapeAvg = {};
  STATE.selectedModels.forEach(k => {
    const vals = items.map(it => it.accuracies[k]).filter(v => v != null);
    mapeAvg[k] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  });

  const sorted = Object.entries(mapeAvg).sort((a, b) => (a[1] || 999) - (b[1] || 999));
  div.innerHTML = sorted.map(([k, mape], i) => {
    if (!MODELS[k]) return '';
    const m = MODELS[k];
    const score = mape == null ? 0 : Math.max(0, 100 - mape);
    const grade = mape == null ? '-' : mape < 8 ? '★★★' : mape < 12 ? '★★' : mape < 18 ? '★' : '·';
    return `
      <div class="acc-item">
        <div class="acc-row">
          <span><span class="model-dot" style="background:${m.color};display:inline-block;margin-right:6px;"></span><b>${i + 1}. ${m.name}</b> <span style="color:var(--warn)">${grade}</span></span>
          <span class="num" style="color:${m.color}">${mape == null ? 'N/A' : mape.toFixed(2) + '%'}</span>
        </div>
        <div class="acc-bar"><div class="acc-bar-fill" style="width:${score}%;background:${m.color}"></div></div>
      </div>
    `;
  }).join('');
}

function renderModelExplain() {
  const div = document.getElementById('model-explain');
  if (!STATE.forecasts) { div.innerHTML = ''; return; }
  const items = Object.values(STATE.forecasts).filter(f => !f.error);
  if (items.length === 0) { div.innerHTML = ''; return; }

  const periodLabel = `${STATE.period}개월`;

  // 첫 번째 시리즈를 기준으로 해설 (또는 합계)
  const refItem = items[0];

  div.innerHTML = STATE.selectedModels.map(k => {
    if (!MODELS[k] || !MODELS[k].enabled) return '';
    const m = MODELS[k];
    if (!refItem.predictions[k]) return '';
    const fc = refItem.predictions[k];
    const fcAvg = fc.reduce((a, b) => a + b, 0) / fc.length;
    const fcMin = Math.min(...fc), fcMax = Math.max(...fc);
    const lastVal = refItem.trainValues[refItem.trainValues.length - 1];
    const change = ((fcAvg - lastVal) / lastVal) * 100;
    const mape = refItem.accuracies[k];

    let interpretation = m.desc;
    if (k === 'ma') interpretation = `최근 ${STATE.params.maWindow}개월 평균 기반 평탄한 예측. 추세·계절성 미반영.`;
    else if (k === 'sn') interpretation = `예측 시점의 12개월 전 실측값 사용. 강한 계절성에 효과적.`;
    else if (k === 'ses') interpretation = `α=${STATE.params.sesAlpha.toFixed(2)}로 최근값에 가중. 평탄한 예측.`;
    else if (k === 'holt') interpretation = `α=${STATE.params.holtAlpha.toFixed(2)}, β=${STATE.params.holtBeta.toFixed(2)}로 추세를 반영한 직선 외삽.`;
    else if (k === 'hw') interpretation = `α=${STATE.params.hwAlpha.toFixed(2)}, β=${STATE.params.hwBeta.toFixed(2)}, γ=${STATE.params.hwGamma.toFixed(2)}로 레벨·추세·계절성 모두 평활.`;
    else if (k === 'ar') interpretation = `과거 ${STATE.params.arP}개 시점값으로 자기회귀. 자기상관이 뚜렷할 때 효과적.`;
    else if (k === 'arima') interpretation = `ARIMA(${STATE.params.arP},${STATE.params.arD},${STATE.params.arQ}). 비계절 시계열의 정석.`;
    else if (k === 'sarima') interpretation = `SARIMA(${STATE.params.arP},${STATE.params.arD},${STATE.params.arQ})(0,1,0)₁₂. 계절차분 + 비계절 ARIMA.`;
    else if (k === 'stl') interpretation = `Loess 기반 추세·계절·잔차 분해 후 추세는 Holt로 외삽, 계절성은 반복.`;
    else if (k === 'rf') interpretation = `30개 결정나무 앙상블. lag(1~12)+월 특징량 사용. 비선형 패턴 포착.`;
    else if (k === 'xgb') interpretation = `Gradient Boosting 50라운드. 잔차를 순차적으로 보정.`;

    return `
      <div class="explain-card" style="--m-color:${m.color}">
        <div class="explain-head">
          <div class="explain-name">${m.name}</div>
          <div style="display:flex;gap:6px;align-items:center;">
            <span class="explain-tag">${m.short}</span>
            ${mape != null ? `<span class="text-xs num" style="color:${m.color}">MAPE ${mape.toFixed(2)}%</span>` : ''}
          </div>
        </div>
        <div class="explain-text">${interpretation}</div>
        <div class="explain-stats">
          <div class="explain-stat"><div class="explain-stat-label">예측 평균</div><div class="explain-stat-value" style="color:${m.color}">${formatValue(fcAvg, refItem.unit)}</div></div>
          <div class="explain-stat"><div class="explain-stat-label">변동 폭</div><div class="explain-stat-value">${formatValue(fcMax - fcMin, refItem.unit)}</div></div>
          <div class="explain-stat"><div class="explain-stat-label">최근 대비</div><div class="explain-stat-value" style="color:${change >= 0 ? 'var(--pos)' : 'var(--neg)'}">${change >= 0 ? '+' : ''}${change.toFixed(1)}%</div></div>
        </div>
      </div>
    `;
  }).join('');

  // 앙상블 카드 추가
  if (refItem.predictions.ensemble) {
    const ens = refItem.predictions.ensemble;
    const ensAvg = ens.reduce((a, b) => a + b, 0) / ens.length;
    const lastVal = refItem.trainValues[refItem.trainValues.length - 1];
    const change = ((ensAvg - lastVal) / lastVal) * 100;
    let dispersion = 0;
    for (let i = 0; i < ens.length; i++) {
      const vals = STATE.selectedModels.filter(k => refItem.predictions[k]).map(k => refItem.predictions[k][i]);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      dispersion += Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
    }
    dispersion /= ens.length;
    const dispPct = (dispersion / Math.abs(ensAvg)) * 100;

    div.insertAdjacentHTML('afterbegin', `
      <div class="explain-card" style="--m-color:#fff;border-left-color:var(--text-0);background:linear-gradient(135deg, var(--hover-bg), transparent);">
        <div class="explain-head">
          <div class="explain-name">앙상블 (${Object.keys(refItem.predictions).filter(k => k !== 'ensemble').length}개 모형 평균)</div>
          <span class="explain-tag" style="background:var(--hover-bg);color:var(--text-0);">★ 권장</span>
        </div>
        <div class="explain-text">선택한 모형의 단순 평균으로 개별 모형 편향을 상쇄합니다. 모형 간 평균 편차는 <b class="num">${formatValue(dispersion, refItem.unit)}</b> (평균값 대비 ${dispPct.toFixed(1)}%)로,
          ${dispPct < 5 ? '<b style="color:var(--pos)">모형들이 일치</b>하여 신뢰도가 높습니다.' : dispPct < 15 ? '<b style="color:var(--warn)">일부 차이</b>가 있어 시나리오 검토를 권장합니다.' : '<b style="color:var(--neg)">큰 차이</b>가 있어 불확실성이 높음을 시사합니다.'}
        </div>
        <div class="explain-stats">
          <div class="explain-stat"><div class="explain-stat-label">앙상블 평균</div><div class="explain-stat-value">${formatValue(ensAvg, refItem.unit)}</div></div>
          <div class="explain-stat"><div class="explain-stat-label">모형간 편차</div><div class="explain-stat-value">${dispPct.toFixed(1)}%</div></div>
          <div class="explain-stat"><div class="explain-stat-label">최근 대비</div><div class="explain-stat-value" style="color:${change >= 0 ? 'var(--pos)' : 'var(--neg)'}">${change >= 0 ? '+' : ''}${change.toFixed(1)}%</div></div>
        </div>
      </div>
    `);
  }
}

function renderForecastTable() {
  const tbl = document.getElementById('forecast-table');
  if (!STATE.forecasts) { tbl.innerHTML = ''; return; }
  const items = Object.values(STATE.forecasts).filter(f => !f.error);
  if (items.length === 0) { tbl.innerHTML = ''; return; }

  const refItem = items[0];
  const labels = refItem.futureLabels;

  // 헤더: 월 + (시리즈별로 모형들)
  const cols = [];
  items.forEach(item => {
    STATE.selectedModels.forEach(k => {
      if (!MODELS[k] || !MODELS[k].enabled) return;
      if (!item.predictions[k]) return;
      cols.push({
        item, key: k, label: `${item.label.split(' ')[0][0]}.${MODELS[k].short}`,
        full: `${item.label} (${MODELS[k].name})`,
        color: MODELS[k].color, unit: item.unit,
      });
    });
    if (item.predictions.ensemble) {
      cols.push({
        item, key: 'ensemble', label: `${item.label.split(' ')[0][0]}.ENS`,
        full: `${item.label} (앙상블)`,
        color: item.color, unit: item.unit, isEnsemble: true,
      });
    }
  });

  let html = '<thead><tr><th>월</th>';
  cols.forEach(c => {
    html += `<th title="${c.full}" style="color:${c.color}">${c.label}</th>`;
  });
  html += '</tr></thead><tbody>';

  labels.forEach((lbl, i) => {
    html += `<tr><td>${lbl.date}</td>`;
    cols.forEach(c => {
      const v = c.item.predictions[c.key][i];
      const intv = c.item.intervals[c.key][i];
      let cell = formatValue(v, c.unit);
      if (STATE.output !== 'point') {
        cell += `<div class="tbl-interval">[${formatValue(intv.lower, c.unit)} ~ ${formatValue(intv.upper, c.unit)}]</div>`;
      }
      const style = c.isEnsemble ? `color:${c.color};font-weight:700` : `color:${c.color}`;
      html += `<td style="${style}">${cell}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody>';
  tbl.innerHTML = html;

  document.getElementById('table-period-label').textContent =
    `${labels[0].date} ~ ${labels[labels.length - 1].date} · 신뢰수준 ${STATE.ciLevel}% · 통화 ${STATE.currency}${STATE.currency === 'KRW' ? ` (1$ = ${STATE.usdRate}원 환산)` : ' (원본 단위)'}`;
}

function renderSummaryOpinion() {
  const div = document.getElementById('summary-opinion');
  if (!STATE.forecasts) { div.innerHTML = ''; return; }
  const items = Object.values(STATE.forecasts).filter(f => !f.error);
  if (items.length === 0) { div.innerHTML = ''; return; }

  const periodLabel = `${STATE.period}개월`;
  let html = '';
  items.forEach(item => {
    const fcKey = item.predictions.ensemble ? 'ensemble' : Object.keys(item.predictions)[0];
    if (!fcKey) return;
    const fcSum = item.predictions[fcKey].reduce((a, b) => a + b, 0);
    const lastSum = item.trainValues.slice(-STATE.period).reduce((a, b) => a + b, 0);
    const yoy = lastSum > 0 ? ((fcSum - lastSum) / lastSum) * 100 : 0;
    let opinion;
    if (yoy >= 5) opinion = `<b style="color:var(--pos)">강한 성장(+${yoy.toFixed(1)}%)</b>이 예상됩니다.`;
    else if (yoy >= 0) opinion = `<b style="color:var(--pos)">완만한 성장(+${yoy.toFixed(1)}%)</b>이 예상됩니다.`;
    else if (yoy >= -5) opinion = `<b style="color:var(--warn)">소폭 감소(${yoy.toFixed(1)}%)</b>가 예상됩니다.`;
    else opinion = `<b style="color:var(--neg)">큰 폭 감소(${yoy.toFixed(1)}%)</b>가 예상됩니다.`;
    html += `<p>📊 <b style="color:${item.color}">${item.label}</b>: 향후 ${periodLabel} 예측 합계 <b class="num">${formatValue(fcSum, item.unit)}</b> · 직전 동기간 ${formatValue(lastSum, item.unit)} 대비 ${opinion}</p>`;
  });

  // 최우수 모형
  const allMape = {};
  STATE.selectedModels.forEach(k => {
    const vals = items.map(it => it.accuracies[k]).filter(v => v != null);
    if (vals.length > 0) allMape[k] = vals.reduce((a, b) => a + b, 0) / vals.length;
  });
  let bestK = null, bestM = Infinity;
  Object.entries(allMape).forEach(([k, v]) => { if (v < bestM) { bestM = v; bestK = k; } });
  if (bestK) html += `<p>🏆 평균 MAPE 기준 <b style="color:${MODELS[bestK].color}">${MODELS[bestK].name}</b> 모형이 가장 정확합니다 (${bestM.toFixed(2)}%).</p>`;

  if (STATE.selectedModels.length >= 2) {
    html += `<p>🤝 ${STATE.selectedModels.length}개 모형의 앙상블이 적용되어 단일 모형 대비 안정성이 향상되었습니다.</p>`;
  }
  if (STATE.output !== 'point') {
    html += `<p>📐 ${STATE.ciLevel}% 신뢰구간이 함께 산출되었습니다. 의사결정 시 상한·하한 시나리오를 모두 고려하시기 바랍니다.</p>`;
  }
  div.innerHTML = html;
}

function renderToolbar() {
  const status = document.getElementById('tb-status');
  if (STATE.data.import || STATE.data.export) {
    const n = (STATE.data.import || STATE.data.export).rows.length;
    status.innerHTML = `<span class="pill-dot pos"></span>${STATE.fileName} (${n}개월)`;
  } else {
    status.innerHTML = `<span class="pill-dot warn pulse"></span>데이터 없음`;
  }
  const periodEl = document.getElementById('tb-period');
  const modelEl = document.getElementById('tb-models');
  if (STATE.forecasts && Object.keys(STATE.forecasts).length > 0) {
    periodEl.classList.remove('hidden');
    modelEl.classList.remove('hidden');
    periodEl.querySelector('span:last-child').textContent = `예측 ${STATE.period}M`;
    modelEl.querySelector('span:last-child').textContent =
      STATE.selectedModels.map(k => MODELS[k]?.short || k).join('+') +
      (STATE.selectedModels.length >= 2 ? '+ENS' : '');
  } else {
    periodEl.classList.add('hidden');
    modelEl.classList.add('hidden');
  }

  // 차트 부제목
  const sub = document.getElementById('chart-subtitle');
  const dirLabel = STATE.direction === 'both' ? '수입+수출' : STATE.direction === 'import' ? '수입' : '수출';
  const metLabel = STATE.metric === 'both' ? '금액+건수' : STATE.metric === 'amount' ? '금액' : '건수';
  const scopeLabel = STATE.scope === 'ec' ? '전자상거래' : '전체';
  sub.textContent = `${scopeLabel} · ${dirLabel} · ${metLabel} · 향후 ${STATE.period}개월`;
}

function renderObsRangeLabel() {
  const data = STATE.data.import || STATE.data.export;
  if (!data) return;
  const n = data.rows.length;
  const fromIdx = Math.floor((STATE.obsFrom / 100) * n);
  const toIdx = Math.min(n - 1, Math.ceil((STATE.obsTo / 100) * n) - 1);
  const lbl = document.getElementById('obs-range-label');
  if (data.rows[fromIdx] && data.rows[toIdx]) {
    lbl.textContent = `${data.rows[fromIdx].date} ~ ${data.rows[toIdx].date} (${toIdx - fromIdx + 1}M)`;
  }
  // 듀얼 레인지 fill
  const fill = document.getElementById('obs-fill');
  fill.style.left = STATE.obsFrom + '%';
  fill.style.right = (100 - STATE.obsTo) + '%';
}

/* ============================================================
   업데이트 진입점
   ============================================================ */
function update() {
  if (!STATE.data.import && !STATE.data.export) return;
  STATE.forecasts = computeAllForecasts();
  renderModelGrid();
  renderAdvParams();
  renderToolbar();
  renderObsRangeLabel();
  renderKPI();
  renderChart();
  renderChartLegend();
  renderAccuracy();
  renderModelExplain();
  renderForecastTable();
  renderSummaryOpinion();
  document.getElementById('btn-export').disabled = !STATE.forecasts || Object.keys(STATE.forecasts).length === 0;
}

/* ============================================================
   파일 업로드
   ============================================================ */
async function handleFile(file) {
  if (!file) return;
  STATE.fileName = file.name;
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });

    const data = { import: null, export: null };
    wb.SheetNames.forEach(name => {
      const ws = wb.Sheets[name];
      const json = XLSX.utils.sheet_to_json(ws, { defval: null });
      if (json.length === 0) return;
      const cols = Object.keys(json[0]);
      const yearCol = cols.find(c => /연도|year/i.test(c));
      const monthCol = cols.find(c => /월|month/i.test(c));
      if (!yearCol || !monthCol) return;

      const direction = /수입|import/i.test(name) ? 'import' :
                       /수출|export/i.test(name) ? 'export' : null;
      if (!direction) return;

      // 컬럼 매칭
      const ecAmtCol = cols.find(c => /(전자상거래|ec|ecommerce).*?(금액|amount)/i.test(c));
      const ecCntCol = cols.find(c => /(전자상거래|ec|ecommerce).*?(건수|count)/i.test(c));
      const totAmtCol = cols.find(c => /(전체|total).*?(금액|amount)/i.test(c));
      const totCntCol = cols.find(c => /(전체|total).*?(건수|count)/i.test(c));

      const rows = json
        .filter(r => r[yearCol] != null && r[monthCol] != null)
        .map(r => ({
          year: Number(r[yearCol]), month: Number(r[monthCol]),
          date: `${r[yearCol]}-${String(r[monthCol]).padStart(2, '0')}`,
          ec_amount: ecAmtCol ? Number(r[ecAmtCol]) || 0 : 0,
          ec_count: ecCntCol ? Number(r[ecCntCol]) || 0 : 0,
          total_amount: totAmtCol ? Number(r[totAmtCol]) || 0 : 0,
          total_count: totCntCol ? Number(r[totCntCol]) || 0 : 0,
        }))
        .sort((a, b) => (a.year - b.year) * 12 + (a.month - b.month));

      if (rows.length > 0) data[direction] = { rows };
    });

    if (!data.import && !data.export) {
      showToast('수입/수출 시트를 찾을 수 없습니다. 시트명에 "수입" 또는 "수출"이 포함되어야 합니다.');
      return;
    }

    STATE.data = data;
    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    update();
    showToast(`${file.name} 로드 완료`);
  } catch (e) {
    console.error(e);
    showToast('파일 처리 오류: ' + e.message);
  }
}

/* ============================================================
   샘플 로드
   ============================================================ */
async function loadSample() {
  showToast('샘플 데이터 로드 중...');
  // 샘플 데이터는 별도 sample.js에서 가져옴
  if (!window.SAMPLE_DATA) {
    showToast('샘플 데이터가 없습니다');
    return;
  }
  STATE.fileName = '전자상거래무역_샘플.xlsx';
  STATE.data = window.SAMPLE_DATA;
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  update();
  showToast('샘플 데이터 로드 완료 (BANDTrass 전자상거래 통계)');
}

/* ============================================================
   모형 카탈로그 모달
   ============================================================ */
function showModelCatalog() {
  const div = document.getElementById('modal-content');
  let html = '';
  MODEL_CATEGORIES.forEach(cat => {
    const models = Object.values(MODELS).filter(m => m.category === cat);
    if (models.length === 0) return;
    html += `<div class="cat-section">
      <div class="cat-title">${cat}</div>
      <div class="cat-grid">
        ${models.map(m => `
          <div class="cat-card ${m.enabled ? '' : 'coming-soon'}">
            <h6 style="color:${m.color}">${m.name} <span style="font-size:9px;color:var(--text-2);font-weight:400;">${m.short}</span></h6>
            <p>${m.desc}</p>
            <p style="margin-top:6px;font-size:10px;"><b style="color:var(--text-0);">적합:</b> ${m.when}<br/><b style="color:var(--pos);">장점:</b> ${m.pros}<br/><b style="color:var(--neg);">단점:</b> ${m.cons}</p>
          </div>
        `).join('')}
      </div>
    </div>`;
  });
  div.innerHTML = html;
  document.getElementById('model-modal').classList.remove('hidden');
}

/* ============================================================
   Word 출력
   ============================================================ */
async function exportWord() {
  if (!STATE.forecasts) return;
  showToast('Word 문서 생성 중...');
  const items = Object.values(STATE.forecasts).filter(f => !f.error);
  if (items.length === 0) { showToast('내보낼 예측 데이터가 없습니다'); return; }

  const {
    Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
    AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType, LevelFormat, PageBreak
  } = docx;

  const today = new Date().toISOString().slice(0, 10);
  const periodLabel = `${STATE.period}개월`;
  const border = { style: BorderStyle.SINGLE, size: 4, color: "94A3B8" };
  const borders = { top: border, bottom: border, left: border, right: border };
  const cell = (text, opts = {}) => new TableCell({
    borders, width: { size: opts.width || 1500, type: WidthType.DXA },
    shading: opts.header ? { fill: "0F172A", type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    children: [new Paragraph({
      alignment: opts.align || AlignmentType.LEFT,
      children: [new TextRun({ text, bold: opts.bold || opts.header,
        color: opts.header ? "FFFFFF" : (opts.color || "1E293B"),
        size: 18, font: "맑은 고딕" })],
    })],
  });
  const para = (text, opts = {}) => new Paragraph({
    alignment: opts.align || AlignmentType.JUSTIFIED,
    spacing: { before: 60, after: 60, line: 320 },
    children: [new TextRun({ text, size: opts.size || 22, bold: opts.bold,
      color: opts.color || "1E293B", font: "맑은 고딕" })],
  });
  const heading = (text, level = HeadingLevel.HEADING_1) => new Paragraph({
    heading: level,
    spacing: { before: 280, after: 120 },
    children: [new TextRun({ text, bold: true, color: "0F172A",
      size: level === HeadingLevel.HEADING_1 ? 32 : 26, font: "맑은 고딕" })],
    border: level === HeadingLevel.HEADING_1
      ? { bottom: { style: BorderStyle.SINGLE, size: 12, color: "06B6D4", space: 4 } }
      : undefined,
  });
  const bullet = (text) => new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { before: 40, after: 40 },
    children: [new TextRun({ text, size: 22, color: "1E293B", font: "맑은 고딕" })],
  });

  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { before: 1200, after: 200 },
      children: [new TextRun({ text: '수요예측 분석 보고서', bold: true, size: 56, color: "0F172A", font: "맑은 고딕" })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { after: 800 },
      children: [new TextRun({ text: 'Demand Forecast Analysis Report v2', size: 28, color: "06B6D4", font: "Arial" })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `생성일: ${today} · 통화: ${STATE.currency}${STATE.currency === 'KRW' ? ` (1$=${STATE.usdRate}원 환산)` : ' (원본 USD)'} · 예측기간: ${periodLabel}`, size: 22, color: "64748B", font: "맑은 고딕" })],
    }),
    new Paragraph({ children: [new PageBreak()] }),

    heading('1. 분석 개요'),
    para(`본 보고서는 ${STATE.fileName} 파일을 기반으로 ${items.length}개 시리즈(${items.map(i => i.label).join(', ')})에 대해 ${STATE.selectedModels.length}개 시계열 모형을 적용하여 향후 ${periodLabel}의 수요를 예측한 결과입니다.`),
  ];

  // 시리즈별 핵심 결과
  children.push(heading('2. 시리즈별 예측 결과', HeadingLevel.HEADING_1));
  items.forEach(item => {
    const fcKey = item.predictions.ensemble ? 'ensemble' : Object.keys(item.predictions)[0];
    if (!fcKey) return;
    const fcSum = item.predictions[fcKey].reduce((a, b) => a + b, 0);
    const lastSum = item.trainValues.slice(-STATE.period).reduce((a, b) => a + b, 0);
    const yoy = lastSum > 0 ? ((fcSum - lastSum) / lastSum) * 100 : 0;

    children.push(heading(item.label, HeadingLevel.HEADING_2));
    children.push(bullet(`최근 ${periodLabel} 합계: ${formatValue(lastSum, item.unit)}`));
    children.push(bullet(`향후 ${periodLabel} 예측 합계: ${formatValue(fcSum, item.unit)}`));
    children.push(bullet(`전기 대비 변화: ${yoy >= 0 ? '+' : ''}${yoy.toFixed(2)}%`));
  });

  // 모형 정확도
  children.push(heading('3. 모형별 평균 정확도'));
  const mapeAvg = {};
  STATE.selectedModels.forEach(k => {
    const vals = items.map(it => it.accuracies[k]).filter(v => v != null);
    if (vals.length > 0) mapeAvg[k] = vals.reduce((a, b) => a + b, 0) / vals.length;
  });
  const sorted = Object.entries(mapeAvg).sort((a, b) => a[1] - b[1]);
  const mapeRows = [
    new TableRow({ children: [
      cell('순위', { header: true, align: AlignmentType.CENTER, width: 1000 }),
      cell('모형', { header: true, align: AlignmentType.CENTER, width: 2400 }),
      cell('카테고리', { header: true, align: AlignmentType.CENTER, width: 2200 }),
      cell('평균 MAPE', { header: true, align: AlignmentType.CENTER, width: 3300 }),
    ]}),
    ...sorted.map(([k, v], i) => new TableRow({ children: [
      cell(`${i + 1}위`, { align: AlignmentType.CENTER, width: 1000, bold: i === 0 }),
      cell(MODELS[k].name, { align: AlignmentType.LEFT, width: 2400, bold: i === 0 }),
      cell(MODELS[k].category, { align: AlignmentType.CENTER, width: 2200 }),
      cell(v.toFixed(2) + '%', { align: AlignmentType.RIGHT, width: 3300 }),
    ]})),
  ];
  children.push(new Table({ width: { size: 8900, type: WidthType.DXA },
    columnWidths: [1000, 2400, 2200, 3300], rows: mapeRows }));

  // 시리즈별 예측표
  items.forEach(item => {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(heading(`4. ${item.label} 상세 예측표`));

    const cols = [...STATE.selectedModels.filter(k => item.predictions[k]).map(k => MODELS[k].name)];
    if (item.predictions.ensemble) cols.push('앙상블');

    const headerRow = new TableRow({ children: [
      cell('월', { header: true, align: AlignmentType.CENTER, width: 1100 }),
      ...cols.map(c => cell(c, { header: true, align: AlignmentType.CENTER, width: 1300 })),
    ]});
    const dataRows = item.futureLabels.map((lbl, i) => {
      const cells = [cell(lbl.date, { align: AlignmentType.CENTER, width: 1100, bold: true })];
      STATE.selectedModels.filter(k => item.predictions[k]).forEach(k => {
        cells.push(cell(formatValue(item.predictions[k][i], item.unit), { align: AlignmentType.RIGHT, width: 1300 }));
      });
      if (item.predictions.ensemble) {
        cells.push(cell(formatValue(item.predictions.ensemble[i], item.unit), { align: AlignmentType.RIGHT, width: 1300, bold: true, color: "0891B2" }));
      }
      return new TableRow({ children: cells });
    });
    const colW = [1100, ...Array(cols.length).fill(1300)];
    children.push(new Table({ width: { size: 8900, type: WidthType.DXA }, columnWidths: colW, rows: [headerRow, ...dataRows] }));
  });

  // 권고사항
  children.push(heading('5. 권고사항'));
  children.push(bullet('단일 모형보다 앙상블 또는 모형별 예측 범위를 함께 검토하여 의사결정의 견고성을 확보하시기 바랍니다.'));
  children.push(bullet('정책 변화·환율·국제 정세 등 외부 충격은 본 모형에 반영되지 않으므로 분기별 데이터 갱신을 권장합니다.'));
  children.push(bullet('백테스트 MAPE가 큰 모형은 데이터 패턴과 부합하지 않으므로 가중치를 낮추거나 제외하는 것이 좋습니다.'));
  if (STATE.output !== 'point') children.push(bullet(`${STATE.ciLevel}% 신뢰구간이 함께 산출되었습니다. 의사결정 시 상한·하한 시나리오를 모두 고려하시기 바랍니다.`));

  children.push(new Paragraph({
    spacing: { before: 600, after: 100 },
    border: { top: { style: BorderStyle.SINGLE, size: 6, color: "CBD5E1", space: 6 } },
    children: [new TextRun({ text: '본 보고서는 Demand Forecast Studio v2에 의해 자동 생성되었습니다. 데이터 출처: BANDTrass 무역통계.', size: 18, color: "64748B", italics: true, font: "맑은 고딕" })],
  }));

  const doc = new Document({
    styles: { default: { document: { run: { font: "맑은 고딕", size: 22 } } } },
    numbering: { config: [{ reference: "bullets", levels: [{
      level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 720, hanging: 360 } } } }]}]},
    sections: [{
      properties: { page: {
        size: { width: 11906, height: 16838 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } }},
      children,
    }],
  });
  const blob = await Packer.toBlob(doc);
  saveAs(blob, `수요예측_보고서_${today}.docx`);
  showToast('Word 보고서 다운로드 완료');
}

/* ============================================================
   토스트
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
   테마 토글
   ============================================================ */
function toggleTheme() {
  STATE.theme = STATE.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', STATE.theme);
  document.getElementById('theme-dark-icon').classList.toggle('hidden', STATE.theme === 'light');
  document.getElementById('theme-light-icon').classList.toggle('hidden', STATE.theme === 'dark');
  localStorage.setItem('theme', STATE.theme);
  if (STATE.forecasts) renderChart();
}

/* ============================================================
   초기화
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  // 테마 복원
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme) {
    STATE.theme = savedTheme;
    document.documentElement.setAttribute('data-theme', STATE.theme);
    if (STATE.theme === 'light') {
      document.getElementById('theme-dark-icon').classList.add('hidden');
      document.getElementById('theme-light-icon').classList.remove('hidden');
    }
  }

  document.getElementById('btn-theme').onclick = toggleTheme;

  // 통화
  document.querySelectorAll('[data-cur]').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('[data-cur]').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      STATE.currency = b.dataset.cur;
      if (STATE.data.import || STATE.data.export) update();
    };
  });

  const fileInput = document.getElementById('file-input');
  document.getElementById('btn-upload').onclick = () => fileInput.click();
  fileInput.onchange = e => handleFile(e.target.files[0]);
  document.getElementById('dropzone').onclick = () => fileInput.click();
  const dz = document.getElementById('dropzone');
  dz.ondragover = e => { e.preventDefault(); dz.style.borderColor = 'var(--accent)'; };
  dz.ondragleave = () => dz.style.borderColor = '';
  dz.ondrop = e => { e.preventDefault(); dz.style.borderColor = ''; handleFile(e.dataTransfer.files[0]); };

  document.getElementById('btn-sample').onclick = loadSample;
  document.getElementById('btn-try-sample').onclick = loadSample;
  document.getElementById('btn-export').onclick = exportWord;
  document.getElementById('btn-model-help').onclick = showModelCatalog;
  document.getElementById('modal-close').onclick = () =>
    document.getElementById('model-modal').classList.add('hidden');
  document.querySelector('.modal-backdrop').onclick = () =>
    document.getElementById('model-modal').classList.add('hidden');

  // 세그먼트 버튼
  const bindSeg = (attr, key, isInt = false) => {
    document.querySelectorAll(`[data-${attr}]`).forEach(b => {
      b.onclick = () => {
        document.querySelectorAll(`[data-${attr}]`).forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        STATE[key] = isInt ? parseInt(b.dataset[attr]) : b.dataset[attr];
        if (key === 'period') document.getElementById('period-out').textContent = STATE.period;
        if (STATE.data.import || STATE.data.export) update();
      };
    });
  };
  bindSeg('direction', 'direction');
  bindSeg('metric', 'metric');
  bindSeg('scope', 'scope');
  bindSeg('output', 'output');
  bindSeg('ci', 'ciLevel', true);
  bindSeg('period', 'period', true);
  bindSeg('zoom', 'zoomMode');

  // 예측 기간 슬라이더
  const ps = document.getElementById('period-slider');
  ps.oninput = () => {
    STATE.period = parseInt(ps.value);
    document.getElementById('period-out').textContent = STATE.period;
    document.querySelectorAll('[data-period]').forEach(b => b.classList.toggle('active', parseInt(b.dataset.period) === STATE.period));
  };
  ps.onchange = () => { if (STATE.data.import || STATE.data.export) update(); };

  // 관측 기간 듀얼 슬라이더
  const obsFrom = document.getElementById('obs-from');
  const obsTo = document.getElementById('obs-to');
  const updateObs = () => {
    let from = parseInt(obsFrom.value), to = parseInt(obsTo.value);
    if (from > to - 5) { from = to - 5; obsFrom.value = from; }
    STATE.obsFrom = from; STATE.obsTo = to;
    renderObsRangeLabel();
  };
  obsFrom.oninput = updateObs;
  obsTo.oninput = updateObs;
  obsFrom.onchange = obsTo.onchange = () => { if (STATE.data.import || STATE.data.export) update(); };

  // 줌
  document.querySelectorAll('[data-zoom]').forEach(b => {
    b.onclick = () => { STATE.zoomMode = b.dataset.zoom; if (STATE.forecasts) renderChart(); };
  });

  window.addEventListener('resize', () => {
    if (STATE.forecasts) setTimeout(renderChart, 100);
  });
});
