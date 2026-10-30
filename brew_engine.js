/**
 * brew_engine.js
 * BrewMap 3D Coffee Brewing Studio engine (v1.655)
 * - 사용자 인증(마스터 / 지인 모드) 및 권한 관리 안전성 강화
 * - 1줄 2개 배치 조작창 (막대 슬라이더 + 직접 숫자 입력 + 🔒 잠금 시스템)
 * - 7단계 중량 × 4개 추출 모드 실시간 물 투입량 계산
 * - 두 가지 분쇄 설정 방식(등록 모델 / 일반 5단계)
 * - 참고용 예상 TDS/EY, 사용자 실측 TDS/EY 및 SCA 골든컵 차트 분리 표시
 * - 투명 드리퍼·커피층 팽창/배수 개념형 3D 추출 애니메이션, ASMR 및 음성 안내
 * - 앱 내부 저장 + 단일 기본 엑셀(.csv) 자동 강제 저장 및 백업·복원 시스템
 */

// ============================================================================
// 1. 전역 상태 및 변수 관리
// ============================================================================
let isMaster = false;
let currentUserName = "오찬욱";
let currentDripper = "bluebottle";
let currentWeightIdx = 3; // 기본 30g
let currentModeKey = "standard";
let currentDripperLabel = "Blue Bottle Dripper (블루보틀 드리퍼)";
let currentBaristaPresetId = null;
let currentBaristaPreset = null;
let prePresetDripper = null;
let prePresetDripperLabel = null;
let recipeType = null;
let wizardState = { dripper: false, bean: false, recipe: false, grind: false };
let presetLockedFields = new Set();
let brewCompletionPromptShown = false;
let currentBrewSessionId = null;
let latestTastingRecord = null;
let tastingSkipped = false;
let tastingAutoSaveTimer = null;
let currentOverallRating = null;
let brewOutroAnimReq = null;
let recommendedSettingsLocked = false;
let uploadMode = "default";

// 세팅 고정(잠금) 상태 객체
const lockStates = {
  dose: false,
  water: false,
  temp: false,
  time: false,
  grinder: false
};
let isAllLocked = false;

// ============================================================================
// 2. 앱 초기화 및 인증 (Auth) 로직 (안전성 보완)
// ============================================================================
window.addEventListener("DOMContentLoaded", () => {
  try {
    // 1) URL 파라미터(?name=이름) 체크
    const params = new URLSearchParams(window.location.search);
    const invitedName = params.get("name");
    if (invitedName && invitedName.trim() !== "") {
      currentUserName = invitedName.trim();
      const guestBanner = document.getElementById("url-guest-banner");
      const guestTitle = document.getElementById("url-guest-title");
      const manualZone = document.getElementById("manual-guest-zone");
      if (guestBanner) guestBanner.style.display = "block";
      if (guestTitle) guestTitle.textContent = `${currentUserName} 님, 환영합니다!`;
      const nameInput = document.getElementById("guest-name-input");
      if (nameInput) nameInput.value = currentUserName;
      if (manualZone) manualZone.style.display = "none";
    }

    // 2) 셀렉트 박스 데이터 채우기 (coffee_recipes.js 로드 확인 후 실행)
    if (typeof window.COFFEE_GRINDERS !== "undefined") {
      populateGrinderSelect();
    }
    onGrinderModeChange();
    initMasterSession();
    initWizard();
    if (typeof window.ORIGIN_DB !== "undefined") {
      populateOriginSelect();
      populatePresetSelect();
    }

    // 3) 초기 다이얼 연동
    applyOriginMatrix();
    updateFlavorChart();
    renderOverallRatingStars();
    renderRecipeBoard();
    renderTastingHistorySummary();
  } catch (err) {
    console.error("초기화 중 오류 발생:", err);
  }
});

function showMasterInput() {
  const btnShow = document.getElementById("btn-show-master");
  const codeZone = document.getElementById("master-code-zone");
  const codeInput = document.getElementById("master-code-input");
  if (btnShow) btnShow.style.display = "none";
  if (codeZone) codeZone.style.display = "block";
  if (codeInput) codeInput.focus();
}

function enterWithUrlName() {
  completeLogin(false, currentUserName);
}

function loginGuestManual() {
  const nameInput = document.getElementById("guest-name-input");
  const inputVal = nameInput ? nameInput.value.trim() : "";
  if (!inputVal) {
    alert("방문자 성함을 입력해 주세요.");
    if (nameInput) nameInput.focus();
    return;
  }
  completeLogin(false, inputVal);
}

function loginMaster() {
  const codeInput = document.getElementById("master-code-input");
  const code = codeInput ? codeInput.value.trim() : "";
  // 마스터 보안 코드 (7777)
  const _realMasterKey = String.fromCharCode(55, 55, 55, 55);
  if (code !== _realMasterKey) {
    alert("마스터 입장 코드가 올바르지 않습니다.");
    if (codeInput) {
      codeInput.value = "";
      codeInput.focus();
    }
    return;
  }
  completeLogin(true, "오찬욱");
}

function completeLogin(masterFlag, nameStr, persistMaster = true) {
  isMaster = masterFlag;
  if (masterFlag && persistMaster) saveMasterSession();
  currentUserName = isMaster ? "오찬욱" : nameStr;

  const authOverlay = document.getElementById("authOverlay");
  const mainContainer = document.getElementById("mainContainer");
  if (authOverlay) authOverlay.style.display = "none";
  if (mainContainer) mainContainer.style.display = "block";

  const roleBadge = document.getElementById("user-role-badge");
  const headerTitle = document.getElementById("header-barista-title");
  const subTitle = document.getElementById("welcome-subtitle");
  const boardTitle = document.getElementById("recipe-board-title");
  const fileInfo = document.getElementById("excel-file-info");
  const inviteBtn = document.getElementById("btn-invite-link");

  if (isMaster) {
    if (roleBadge) {
      roleBadge.textContent = "👑 마스터 모드";
      roleBadge.className = "role-badge badge-master";
    }
    if (headerTitle) headerTitle.textContent = "BrewMap";
    if (subTitle) subTitle.textContent = "3D Coffee Brewing Studio · 모든 사용자의 레시피를 관리하고 지인 초대 링크를 발급할 수 있습니다.";
    if (inviteBtn) inviteBtn.style.display = "inline-block";
    if (boardTitle) boardTitle.textContent = "👑 마스터 통합 레시피 보관함 (전체 사용자 열람)";
    if (fileInfo) fileInfo.textContent = "저장 시 [마스터_오찬욱_기본레시피.csv] 단일 파일에 누적 강제 저장됩니다.";
  } else {
    if (roleBadge) {
      roleBadge.textContent = `☕ ${currentUserName} 바리스타`;
      roleBadge.className = "role-badge badge-guest";
    }
    if (headerTitle) headerTitle.textContent = "BrewMap";
    if (subTitle) subTitle.textContent = `${currentUserName} 님, 환영합니다! 나만의 브루잉 레시피를 설정하고 기록해 보세요.`;
    if (inviteBtn) inviteBtn.style.display = "none";
    if (boardTitle) boardTitle.textContent = `📔 ${currentUserName} 님의 전용 레시피 보관함`;
    if (fileInfo) fileInfo.textContent = `저장 시 [개별링크_${currentUserName}_기본레시피.csv] 단일 파일에 누적 강제 저장됩니다.`;
  }

  applyOriginMatrix();
  renderRecipeBoard();
  renderTastingHistorySummary();
}

function createInviteLink() {
  const friendName = prompt("초대할 지인의 성함을 입력해 주세요:");
  if (!friendName || !friendName.trim()) return;
  const baseUrl = window.location.origin + window.location.pathname;
  const inviteUrl = `${baseUrl}?name=${encodeURIComponent(friendName.trim())}`;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(inviteUrl);
  }
  prompt(`아래 개별 초대 링크가 생성되었습니다! 복사해서 지인께 전달해 주세요:\n(접속 시 첫 화면에 "${friendName.trim()} 님, 환영합니다!"가 표시됩니다)`, inviteUrl);
}

// ============================================================================
// 3. 셀렉트 박스 및 UI 동적 채우기
// ============================================================================
function populateOriginSelect() {
  const selectEl = document.getElementById("origin-select");
  if (!selectEl) return;
  selectEl.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "원두 종류를 선택하세요";
  placeholder.disabled = true;
  placeholder.selected = true;
  selectEl.appendChild(placeholder);

  const db = window.ORIGIN_DB || {};
  Object.keys(db).forEach(key => {
    const bean = db[key];
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = bean.name;
    selectEl.appendChild(opt);
  });
}

function populateGrinderSelect() {
  const selectEl = document.getElementById("grinder-select");
  if (!selectEl) return;
  selectEl.innerHTML = "";
  const grinders = [...(window.COFFEE_GRINDERS || [])].sort((a, b) => {
    const order = { pharmacy: 0, home: 1 };
    const pa = Object.prototype.hasOwnProperty.call(order, a.profile) ? order[a.profile] : 2;
    const pb = Object.prototype.hasOwnProperty.call(order, b.profile) ? order[b.profile] : 2;
    return pa - pb || a.name.localeCompare(b.name, "ko");
  });
  grinders.forEach(g => {
    const opt = document.createElement("option");
    opt.value = g.id;
    const prefix = g.profile === "pharmacy" ? "① 약국 · " : (g.profile === "home" ? "② 가정 · " : "③ 기타 · ");
    opt.textContent = prefix + g.name;
    if (g.id === "feima_600n") opt.selected = true;
    selectEl.appendChild(opt);
  });
  onGrinderChange();
}

function populatePresetSelect() {
  const selectEl = document.getElementById("preset-select");
  if (!selectEl) return;

  const presets = window.BARISTA_PRESETS || [];
  presets.forEach(p => {
    const exists = Array.from(selectEl.options).some(opt => opt.value === p.id);
    if (!exists) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `🧑‍🍳 [바리스타 프리셋] ${p.baristaName} — ${p.recipeName} (${p.coffeeDose}g:${p.waterAmount}g)`;
      selectEl.appendChild(opt);
    }
  });
}

// ============================================================================
// 4. 조작 패널 관리 (직접 입력, 막대 슬라이더, 🔒 잠금 시스템)
// ============================================================================
function applyStandardLockUI(field, locked) {
  const box = document.getElementById("box-" + field);
  const btn = document.getElementById("lock-" + field);
  const input = document.getElementById(field + "-num");
  const slider = document.getElementById(field);
  const minusBtn = document.getElementById("minus-" + field);
  const plusBtn = document.getElementById("plus-" + field);
  const presetLocked = presetLockedFields.has(field);
  const effectiveLocked = locked || presetLocked;
  if (box) box.classList.toggle("is-locked", effectiveLocked);
  if (btn) {
    btn.textContent = presetLocked ? "🔒 바리스타 지정" : (effectiveLocked ? "🔒 잠김" : "🔓 고정");
    btn.classList.toggle("locked", effectiveLocked);
    btn.disabled = presetLocked;
  }
  [input, slider, minusBtn, plusBtn].forEach(el => { if (el) el.disabled = effectiveLocked; });
}

function applyGrinderLockUI() {
  const box = document.getElementById("box-grinder");
  const btn = document.getElementById("lock-grinder");
  const locked = lockStates.grinder || isAllLocked || presetLockedFields.has("grinder");
  if (box) box.classList.toggle("is-locked", locked);
  if (btn) {
    btn.textContent = presetLockedFields.has("grinder") ? "🔒 바리스타 지정" : (locked ? "🔒 잠김" : "🔓 고정");
    btn.classList.toggle("locked", locked);
    btn.disabled = presetLockedFields.has("grinder");
  }
  const controls = [
    ...document.querySelectorAll('input[name="grinder-mode"]'),
    ...document.querySelectorAll('input[name="general-grind-level"]'),
    document.getElementById("grinder-select"),
    document.getElementById("grinder-dial-num"),
    document.getElementById("minus-grinder"),
    document.getElementById("plus-grinder")
  ];
  controls.forEach(el => { if (el) el.disabled = locked; });
}

function toggleLock(field) {
  if (isAllLocked || presetLockedFields.has(field)) return;
  if (field === "grinder") {
    lockStates.grinder = !lockStates.grinder;
    applyGrinderLockUI();
    return;
  }
  lockStates[field] = !lockStates[field];
  applyStandardLockUI(field, lockStates[field]);
}

function toggleLockAll() {
  isAllLocked = !isAllLocked;
  ["btn-lock-all", "btn-lock-all-bottom"].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.textContent = isAllLocked ? "🔒 전체 세팅 잠김 해제" : "🔓 전체 세팅 고정하기";
      btn.classList.toggle("locked", isAllLocked);
      btn.setAttribute("aria-pressed", String(isAllLocked));
    }
  });
  ["dose", "water", "temp", "time"].forEach(field => {
    lockStates[field] = isAllLocked;
    applyStandardLockUI(field, isAllLocked);
  });
  lockStates.grinder = isAllLocked;
  applyGrinderLockUI();
}

function getSelectedGrinderMode() {
  const selected = document.querySelector('input[name="grinder-mode"]:checked');
  return selected ? selected.value : "registered";
}

function getSelectedGeneralGrindLevel() {
  const selected = document.querySelector('input[name="general-grind-level"]:checked');
  return selected ? Number(selected.value) : 3;
}

function getGeneralGrindLabel(level) {
  return ({ 1: "매우 굵게", 2: "굵게", 3: "중간", 4: "곱게", 5: "매우 곱게" })[Number(level)] || "중간";
}

function updateGrinderSummary() {
  const mode = getSelectedGrinderMode();
  const badge = document.getElementById("kpi-grinder-badge");
  const value = document.getElementById("kpi-grinder-val");
  const sub = document.getElementById("kpi-grinder-sub");
  if (!value || !sub) return;
  if (mode === "registered") {
    const selectEl = document.getElementById("grinder-select");
    const input = document.getElementById("grinder-dial-num");
    const option = selectEl && selectEl.options[selectEl.selectedIndex];
    value.textContent = option ? option.textContent : "등록 그라인더";
    sub.textContent = `현재 눈금: ${input ? input.value : "미입력"} · 모델 고유 기준`;
    if (badge) badge.textContent = "모델별 설정";
  } else {
    const level = getSelectedGeneralGrindLevel();
    value.textContent = `일반 분쇄도 ${level}단계`;
    sub.textContent = getGeneralGrindLabel(level) + " · 그라인더 모델을 모를 경우";
    if (badge) badge.textContent = "간편 설정";
  }
}

function onGrinderModeChange() {
  const mode = getSelectedGrinderMode();
  if (wizardState && wizardState.recipe) wizardState.grind = true;
  const registered = document.getElementById("grinder-registered-controls");
  const general = document.getElementById("general-grind-controls");
  if (registered) registered.hidden = mode !== "registered";
  if (general) general.hidden = mode !== "general";
  applyGrinderLockUI();
  updateGrinderSummary();
  if (wizardState && document.getElementById("wizard-step-4")) refreshWizard();
}

function onGeneralGrindLevelChange() {
  wizardState.grind = true;
  updateGrinderSummary();
  refreshWizard();
  updateDial();
}

function stepControl(field, delta) {
  if (lockStates[field] || isAllLocked || presetLockedFields.has(field)) return;
  const input = document.getElementById(field + "-num");
  const slider = document.getElementById(field);
  if (!input) return;

  let val = parseFloat(input.value) + delta;
  const min = parseFloat(input.min) || 0;
  const max = parseFloat(input.max) || 1000;
  if (val < min) val = min;
  if (val > max) val = max;

  input.value = val;
  if (slider) slider.value = val;
  updateDial();
}

function onSliderInput(field) {
  if (lockStates[field] || isAllLocked || presetLockedFields.has(field)) return;
  const slider = document.getElementById(field);
  const input = document.getElementById(field + "-num");
  if (slider && input) {
    input.value = slider.value;
  }
  updateDial();
}

function onDirectInput(field) {
  if (lockStates[field] || isAllLocked || presetLockedFields.has(field)) return;
  const input = document.getElementById(field + "-num");
  const slider = document.getElementById(field);
  if (input && slider) {
    let val = parseFloat(input.value);
    if (isNaN(val)) val = parseFloat(slider.value) || 0;
    slider.value = val;
  }
  updateDial();
}

function stepGrinderDial(direction) {
  if (lockStates.grinder || isAllLocked || presetLockedFields.has("grinder")) return;
  const input = document.getElementById("grinder-dial-num");
  const selectEl = document.getElementById("grinder-select");
  if (!input || !selectEl) return;
  const info = window.getGrinderDisplayInfo ? window.getGrinderDisplayInfo(selectEl.value) : {};
  const step = Number(info.adjustmentStep) || 1;
  const min = Number.isFinite(Number(info.dialMin)) ? Number(info.dialMin) : 0;
  const max = Number.isFinite(Number(info.dialMax)) ? Number(info.dialMax) : 9999;
  let val = (parseFloat(input.value) || 0) + (direction < 0 ? -step : step);
  val = Math.max(min, Math.min(max, val));
  input.value = Number(val.toFixed(3));
  updateGrinderSummary();
}

function onGrinderDialDirectInput() {
  if (lockStates.grinder || isAllLocked || presetLockedFields.has("grinder")) return;
  const input = document.getElementById("grinder-dial-num");
  const selectEl = document.getElementById("grinder-select");
  const info = selectEl && window.getGrinderDisplayInfo ? window.getGrinderDisplayInfo(selectEl.value) : {};
  if (input && input.value !== "") {
    const min = Number.isFinite(Number(info.dialMin)) ? Number(info.dialMin) : 0;
    const max = Number.isFinite(Number(info.dialMax)) ? Number(info.dialMax) : 9999;
    input.value = Math.max(min, Math.min(max, Number(input.value)));
  }
  updateGrinderSummary();
}

function onGrinderChange() {
  const selectEl = document.getElementById("grinder-select");
  if (!selectEl) return;
  const grinderId = selectEl.value;
  const info = window.getGrinderDisplayInfo ? window.getGrinderDisplayInfo(grinderId) : { startVal: 4.5, unit: "눈금", badgeText: "실사용", shortSummary: "" };

  const dialInput = document.getElementById("grinder-dial-num");
  const unitTxt = document.getElementById("grinder-unit-txt");
  const summaryTxt = document.getElementById("grinder-summary-txt");
  const sourceLink = document.getElementById("grinder-source-link");

  if (dialInput) {
    dialInput.value = info.startVal ?? info.standardPourOverSetting ?? "";
    dialInput.min = info.dialMin ?? 0;
    dialInput.max = info.dialMax ?? 9999;
    dialInput.step = info.adjustmentStep ?? 1;
  }
  if (unitTxt) unitTxt.textContent = info.unitLabel || "눈금";
  if (summaryTxt) summaryTxt.textContent = `${info.badgeText || "참고 시작값"} (${info.shortSummary || "해당 모델 기준"})`;

  if (sourceLink) {
    if (info.sourceUrls && info.sourceUrls.length > 0) {
      sourceLink.href = info.sourceUrls[0];
      sourceLink.style.display = "inline";
    } else {
      sourceLink.style.display = "none";
    }
  }
  updateGrinderSummary();
  if (wizardState && wizardState.recipe) wizardState.grind = true;
  if (document.getElementById("wizard-step-4") && wizardState?.recipe) refreshWizard();
}

// ============================================================================
// 5. 드리퍼 · 원두 · 중량 · 모드 선택 핸들러
// ============================================================================
function selectDripper(dripperKey, fromPreset = false) {
  if (presetLockedFields.has("dripper") && !fromPreset) return;
  const d = (window.DRIPPERS || {})[dripperKey];
  if (!d) return;
  currentDripper = dripperKey;
  currentDripperLabel = d.fullName || d.name;
  document.documentElement.style.setProperty("--theme-color", d.themeColor);
  document.documentElement.style.setProperty("--theme-dark", d.themeDark);
  document.documentElement.style.setProperty("--theme-soft", d.themeSoft);
  const logoBadge = document.getElementById("logo-badge");
  if (logoBadge && logoBadge.tagName !== "IMG") logoBadge.textContent = d.badge;
  ["bluebottle", "hario", "kalita"].forEach(k => {
    const card = document.getElementById("card-" + k);
    if (card) card.classList.toggle("active", k === dripperKey);
    if (card) card.disabled = presetLockedFields.has("dripper") && !fromPreset;
  });
  wizardState.dripper = true;
  refreshWizard();
  if (!fromPreset && currentBaristaPresetId) clearBaristaPreset(false);
  if (!currentBaristaPresetId) applyOriginMatrix();
}

function selectWeightPreset(idx) {
  if (presetLockedFields.has("dose") || isAllLocked || lockStates.dose) return;
  currentWeightIdx = idx;
  const weights = window.WEIGHTS || [15, 20, 25, 30, 35, 40, 50];
  for (let i = 0; i < weights.length; i++) {
    const btn = document.getElementById("wbtn-" + i);
    if (btn) btn.classList.toggle("active", i === idx);
  }
  applyOriginMatrix();
}

function selectBrewMode(modeKey) {
  if (presetLockedFields.has("mode") || currentBaristaPresetId || isAllLocked) return;
  currentModeKey = modeKey;
  ["strong", "standard", "light", "bypass"].forEach(m => {
    const btn = document.getElementById("mbtn-" + m);
    if (btn) btn.classList.toggle("active", m === modeKey);
  });
  applyOriginMatrix();
}

function onOriginChange() {
  const originSel = document.getElementById("origin-select");
  if (!originSel || !originSel.value || !(window.ORIGIN_DB || {})[originSel.value]) return;
  wizardState.bean = true;
  if (recommendedSettingsLocked && isAllLocked) toggleLockAll();
  recommendedSettingsLocked = false;
  // 원두를 바꾸면 이전 레시피 유형/바리스타 잠금을 해제하고 다시 선택하도록 합니다.
  if (currentBaristaPresetId) clearBaristaPreset(false);
  currentBaristaPresetId = null;
  currentBaristaPreset = null;
  recipeType = null;
  wizardState.recipe = false;
  wizardState.grind = false;
  document.querySelectorAll('input[name="recipe-type"]').forEach(el => { el.checked = false; });
  const generalOptions = document.getElementById("general-recipe-options");
  const baristaOptions = document.getElementById("barista-recipe-options");
  if (generalOptions) generalOptions.hidden = true;
  if (baristaOptions) baristaOptions.hidden = true;
  const presetSel = document.getElementById("preset-select");
  if (presetSel) presetSel.value = "common_mode";
  refreshWizard();
  applyOriginMatrix();
  openOriginRecommendation();
}

function openOriginRecommendation() {
  const originKey = document.getElementById("origin-select")?.value || "";
  const origin = (window.ORIGIN_DB || {})[originKey];
  const modal = document.getElementById("origin-recommend-modal");
  if (!origin || !modal) return;
  const title = document.getElementById("origin-recommend-title");
  const desc = document.getElementById("origin-recommend-description");
  if (title) title.textContent = `${origin.name} · 권장 레시피`;
  if (desc) desc.textContent = `${origin.roastLevel || origin.roast || "선택 원두"} 특성에 맞춘 출발 설정을 적용할 수 있습니다. 원두 중량을 먼저 입력해 주세요.`;
  const dose = document.getElementById("recommend-dose");
  if (dose) dose.value = String(Number(document.getElementById("dose-num")?.value) || 20);
  const ratio = Number(origin.defaultRatio || origin.ratio || 16);
  const ratioOption = [14,16,18].reduce((best, value) => Math.abs(value-ratio) < Math.abs(best-ratio) ? value : best, 16);
  const ratioSel = document.getElementById("recommend-ratio");
  if (ratioSel) ratioSel.value = String(ratioOption);
  const temp = document.getElementById("recommend-temp");
  if (temp) temp.value = Number(origin.recommendedTemperature?.startC || origin.temp || 94).toFixed(1);
  const recommendGrinder = document.getElementById("recommend-grinder");
  const mainGrinder = document.getElementById("grinder-select");
  if (recommendGrinder && mainGrinder) {
    recommendGrinder.innerHTML = mainGrinder.innerHTML;
    recommendGrinder.value = mainGrinder.value;
  }
  updateRecommendationPreview();
  modal.classList.add("open");
}

function closeOriginRecommendation() {
  document.getElementById("origin-recommend-modal")?.classList.remove("open");
}

function updateRecommendationPreview() {
  const preview = document.getElementById("recommend-preview");
  if (!preview) return;
  const origin = (window.ORIGIN_DB || {})[document.getElementById("origin-select")?.value || ""];
  const dose = Number(document.getElementById("recommend-dose")?.value) || 20;
  const ratio = Number(document.getElementById("recommend-ratio")?.value) || 16;
  const temp = Number(document.getElementById("recommend-temp")?.value) || Number(origin?.temp) || 94;
  const grinderId = document.getElementById("recommend-grinder")?.value || "";
  const grinder = (window.COFFEE_GRINDERS || []).find(item => item.id === grinderId);
  const info = window.getGrinderDisplayInfo ? window.getGrinderDisplayInfo(grinderId) : {};
  const startVal = info.startVal ?? info.standardPourOverSetting ?? "모델 기준 시작값 없음";
  preview.textContent = `원두 ${dose}g · 권장 비율 1:${ratio} · 권장 수온 ${temp.toFixed(1)}°C · 그라인더 ${grinder?.name || "미선택"} · 모델 시작 기준 ${startVal}${info.unitLabel ? ` ${info.unitLabel}` : ""}. 그라인더 시작값은 모델 기준 참고치입니다.`;
}

function chooseManualBeanSetup() {
  closeOriginRecommendation();
  if (recommendedSettingsLocked && isAllLocked) toggleLockAll();
  recommendedSettingsLocked = false;
  applyOriginMatrix();
}

function applyOriginRecommendation() {
  const origin = (window.ORIGIN_DB || {})[document.getElementById("origin-select")?.value || ""];
  if (!origin) return;
  const doseInput = document.getElementById("recommend-dose");
  const dose = Number(doseInput?.value);
  if (!Number.isFinite(dose) || dose < 10 || dose > 60) {
    alert("원두 중량은 10~60g 범위에서 입력해 주세요.");
    doseInput?.focus();
    return;
  }
  const ratio = Number(document.getElementById("recommend-ratio")?.value) || 16;
  const modeKey = ratio <= 14 ? "strong" : (ratio >= 18 ? "light" : "standard");
  const temp = Number(document.getElementById("recommend-temp")?.value) || Number(origin.recommendedTemperature?.startC || origin.temp || 94);
  if (!Number.isFinite(temp) || temp < 80 || temp > 100) { alert("추출 수온은 80~100°C 범위에서 입력해 주세요."); return; }
  const weights = window.WEIGHTS || [15,20,25,30,35,40,50];
  currentWeightIdx = weights.reduce((best, value, idx) => Math.abs(value-dose) < Math.abs(weights[best]-dose) ? idx : best, 0);
  currentModeKey = modeKey;
  const setVal = (id, value) => { const el=document.getElementById(id); if(el) el.value=String(value); };
  setVal("dose-num", dose); setVal("dose", dose);
  const waterResult = window.calculateBrewModeWater ? window.calculateBrewModeWater(dose, modeKey) : { totalInputWaterG: Math.round(dose*ratio) };
  setVal("water-num", waterResult.totalInputWaterG); setVal("water", waterResult.totalInputWaterG);
  setVal("temp-num", temp.toFixed(1)); setVal("temp", temp);
  const timeValues = origin.times || [150,170,190,210,225,240,265];
  const targetTime = Number(timeValues[currentWeightIdx]) || 210;
  setVal("time-num", targetTime); setVal("time", targetTime);
  document.querySelectorAll("#weight-btns-wrap button").forEach((btn, idx) => btn.classList.toggle("active", idx === currentWeightIdx));
  ["strong","standard","light","bypass"].forEach(key => document.getElementById(`mbtn-${key}`)?.classList.toggle("active", key === modeKey));
  const generalRadio = document.querySelector('input[name="recipe-type"][value="general"]');
  const baristaRadio = document.querySelector('input[name="recipe-type"][value="barista"]');
  if (generalRadio) generalRadio.checked = true;
  if (baristaRadio) baristaRadio.checked = false;
  const generalOptions = document.getElementById("general-recipe-options");
  const baristaOptions = document.getElementById("barista-recipe-options");
  if (generalOptions) generalOptions.hidden = false;
  if (baristaOptions) baristaOptions.hidden = true;
  recipeType = "general";
  currentBaristaPresetId = null;
  currentBaristaPreset = null;
  wizardState.recipe = true;
  wizardState.grind = true;
  const grinderId = document.getElementById("recommend-grinder")?.value || "";
  const mainGrinder = document.getElementById("grinder-select");
  if (mainGrinder && grinderId && Array.from(mainGrinder.options).some(o => o.value === grinderId)) mainGrinder.value = grinderId;
  const registeredRadio = document.querySelector('input[name="grinder-mode"][value="registered"]');
  if (registeredRadio) registeredRadio.checked = true;
  if (mainGrinder) onGrinderChange();
  // 추천 적용 상태는 전체 잠금으로 고정하며, 사용자는 전체 잠금 해제 후 개인 취향에 맞게 조절할 수 있습니다.
  isAllLocked = false;
  Object.keys(lockStates).forEach(key => lockStates[key] = false);
  toggleLockAll();
  recommendedSettingsLocked = true;
  const diagTitle = document.getElementById("diag-title");
  const diagDesc = document.getElementById("diag-desc");
  if (diagTitle) diagTitle.textContent = `[${origin.name}] 권장 시작 설정`;
  if (diagDesc) diagDesc.textContent = `원두 ${dose}g · 1:${ratio} · ${temp.toFixed(1)}°C · ${targetTime}초. 권장 설정이 적용되어 잠겼습니다. 전체 잠금을 해제하면 개인 취향으로 변경할 수 있습니다.`;
  closeOriginRecommendation();
  refreshWizard();
  updateDial();
}

function initWizard() {
  const typeInputs = document.querySelectorAll('input[name="recipe-type"]');
  typeInputs.forEach(input => input.checked = false);
  const weight = document.getElementById("weight-selector-group");
  const mode = document.getElementById("mode-selector-group");
  const preset = document.getElementById("preset-select");
  if (preset) preset.value = "common_mode";
  if (weight) weight.classList.add("is-disabled");
  if (mode) mode.classList.add("is-disabled");
  document.querySelectorAll("#mainContainer .panel").forEach(panel => panel.classList.add("wizard-settings-disabled"));
  refreshWizard();
}

function refreshWizard() {
  const s1 = document.getElementById("wizard-step-1");
  const s2 = document.getElementById("wizard-step-2");
  const s3 = document.getElementById("wizard-step-3");
  const s4 = document.getElementById("wizard-step-4");
  // 선택 단계는 항상 보여주고, 이전 단계가 완료되지 않은 입력만 비활성화한다.
  [s1,s2,s3,s4].forEach(el => { if (el) el.hidden = false; });
  const currentStep = !wizardState.dripper ? 1 : (!wizardState.bean ? 2 : (!wizardState.recipe ? 3 : 4));
  [[s1,wizardState.dripper,1],[s2,wizardState.bean,2],[s3,wizardState.recipe,3],[s4,wizardState.grind,4]].forEach(([el,done,step]) => {
    if (!el) return;
    el.classList.toggle("is-complete", !!done);
    el.classList.toggle("is-current", currentStep === step);
    el.classList.toggle("is-disabled", step === 2 ? !wizardState.dripper : ((step === 3 || step === 4) ? (step === 3 ? !wizardState.bean : !wizardState.recipe) : false));
  });
  const originSelect = document.getElementById("origin-select");
  if (originSelect) originSelect.disabled = !wizardState.dripper;
  document.querySelectorAll('#wizard-step-3 input[name="recipe-type"]').forEach(el => { el.disabled = !wizardState.bean; });
  const dLabel = document.getElementById("wizard-dripper-selected");
  const bLabel = document.getElementById("wizard-bean-selected");
  const rLabel = document.getElementById("wizard-recipe-selected");
  const gLabel = document.getElementById("wizard-grind-selected");
  const bean = originSelect && window.ORIGIN_DB ? window.ORIGIN_DB[originSelect.value] : null;
  if (dLabel) { dLabel.textContent = wizardState.dripper ? `선택됨: ${currentDripperLabel}` : "드리퍼를 선택하면 다음 단계가 열립니다."; dLabel.classList.toggle("visible", true); }
  if (bLabel) { bLabel.textContent = wizardState.bean && bean ? `선택됨: ${bean.name}` : "드리퍼를 먼저 선택해 주세요."; bLabel.classList.toggle("visible", true); }
  if (rLabel) {
    const msg = currentBaristaPreset ? `선택됨: ${currentBaristaPreset.baristaName} · ${currentBaristaPreset.recipeName}` : (recipeType === "general" ? "선택됨: 일반 모드" : (recipeType === "barista" ? "바리스타 프리셋을 선택해 주세요." : "원두 선택 후 레시피를 선택할 수 있습니다."));
    rLabel.textContent = msg; rLabel.classList.toggle("visible", true);
  }
  if (gLabel) { gLabel.textContent = wizardState.grind ? `선택됨: ${getSelectedGrinderMode() === "registered" ? "등록 그라인더 · " + (document.getElementById("grinder-select")?.selectedOptions?.[0]?.textContent || "모델") : "일반 분쇄도 " + getSelectedGeneralGrindLevel() + "단계"}` : (wizardState.recipe ? "분쇄 방식을 선택하거나 기본 그라인더를 확인해 주세요." : "레시피 선택 후 분쇄 설정이 활성화됩니다." ); gLabel.classList.toggle("visible", true); }
  // 분쇄 메뉴는 화면에 항상 표시하되, 레시피 선택 후 입력할 수 있게 한다.
  const grinderBox = document.getElementById("box-grinder");
  if (grinderBox) {
    if (wizardState.recipe) applyGrinderLockUI();
    else grinderBox.querySelectorAll("input,select,button").forEach(el => { if (!el.classList.contains("help-mini")) el.disabled = true; });
  }
  const ready = wizardState.dripper && wizardState.bean && wizardState.recipe;
  const settings = document.querySelectorAll("#mainContainer .panel");
  settings.forEach(panel => panel.classList.toggle("wizard-settings-disabled", !ready));
  const kpi = document.querySelector(".kpi-grid");
  if (kpi) kpi.classList.toggle("wizard-settings-disabled", !ready);
}

function clearBaristaPreset(updateUi = true) {
  currentBaristaPresetId = null;
  currentBaristaPreset = null;
  presetLockedFields.clear();
  currentModeKey = "standard";
  if (prePresetDripper && (window.DRIPPERS || {})[prePresetDripper]) {
    const restoreKey = prePresetDripper;
    prePresetDripper = null;
    const restoreLabel = prePresetDripperLabel;
    prePresetDripperLabel = null;
    selectDripper(restoreKey, true);
    if (restoreLabel) currentDripperLabel = restoreLabel;
  }
  ["bluebottle", "hario", "kalita"].forEach(k => {
    const tab = document.getElementById("card-" + k);
    if (tab) tab.disabled = false;
  });
  ["dose", "water", "temp", "time"].forEach(field => applyStandardLockUI(field, lockStates[field] || isAllLocked));
  document.querySelectorAll("#weight-btns-wrap button").forEach(btn => {
    btn.disabled = isAllLocked || lockStates.dose;
  });
  document.querySelectorAll("#mode-selector-group button").forEach(btn => {
    btn.disabled = isAllLocked;
  });
  applyGrinderLockUI();
  if (updateUi) {
    const general = document.querySelector('input[name="recipe-type"][value="general"]');
    const barista = document.querySelector('input[name="recipe-type"][value="barista"]');
    if (general) general.checked = true;
    if (barista) barista.checked = false;
    const baristaOptions = document.getElementById("barista-recipe-options");
    const generalOptions = document.getElementById("general-recipe-options");
    if (baristaOptions) baristaOptions.hidden = true;
    if (generalOptions) generalOptions.hidden = false;
  }
  const summary = document.getElementById("barista-preset-summary");
  if (summary) summary.hidden = true;
}

function selectRecipeType(type) {
  if (recommendedSettingsLocked && isAllLocked) toggleLockAll();
  recommendedSettingsLocked = false;
  if (!wizardState.dripper || !wizardState.bean) {
    alert("먼저 드리퍼와 원두를 선택해 주세요.");
    return;
  }
  if (currentBaristaPresetId) clearBaristaPreset(false);
  else presetLockedFields.clear();
  recipeType = type;
  const generalOptions = document.getElementById("general-recipe-options");
  const baristaOptions = document.getElementById("barista-recipe-options");
  if (generalOptions) generalOptions.hidden = type !== "general";
  if (baristaOptions) baristaOptions.hidden = type !== "barista";
  const weight = document.getElementById("weight-selector-group");
  const mode = document.getElementById("mode-selector-group");
  if (weight) weight.classList.toggle("is-disabled", type !== "general");
  if (mode) mode.classList.toggle("is-disabled", type !== "general");
  document.querySelectorAll("#weight-btns-wrap button").forEach(btn => {
    btn.disabled = type !== "general" || isAllLocked || lockStates.dose;
  });
  document.querySelectorAll("#mode-selector-group button").forEach(btn => {
    btn.disabled = type !== "general" || isAllLocked;
  });
  if (type === "general") {
    const profileCard = document.getElementById("barista-preset-summary");
    if (profileCard) profileCard.hidden = true;
    const presetSel = document.getElementById("preset-select");
    if (presetSel) presetSel.value = "common_mode";
    currentModeKey = "standard";
    const standard = document.getElementById("mbtn-standard");
    if (standard) standard.classList.add("active");
    ["strong", "light", "bypass"].forEach(m => document.getElementById("mbtn-"+m)?.classList.remove("active"));
    wizardState.recipe = true;
    wizardState.grind = true; // 등록 그라인더(기본 선택)가 이미 선택되어 있으므로 4단계 설정 완료 처리
    applyOriginMatrix();
  } else {
    wizardState.recipe = false;
    wizardState.grind = false;
    const presetSel = document.getElementById("preset-select");
    if (presetSel) presetSel.value = "common_mode";
  }
  refreshWizard();
}

const BARISTA_PROFILE_INFO = {
  hoffmann_1cup_v60: { description: "추출 변수를 이해하고 재현성 있는 한 잔을 만드는 교육형 브루잉 접근입니다.", focus: "V60 1인분, 블루밍 후 단계별 푸어와 가벼운 스월" },
  kasuya_4_6_method: { description: "2016 월드 브루어스 컵 우승으로 널리 알려진 4:6 메서드입니다.", focus: "초반 물 배분으로 산미·단맛의 인상을 조절하고, 후반 푸어로 농도감을 다루는 방식" },
  hedrick_v60_4pour: { description: "분쇄 입도, 물줄기, 교반과 추출 효율을 실험적으로 다루는 브루잉 접근입니다.", focus: "여러 번의 푸어와 스월을 활용하는 V60 4-pour" },
  scott_rao_v60: { description: "균일한 베드와 일관된 추출을 중시하는 스페셜티 커피 교육자의 레시피입니다.", focus: "블루밍, 낮은 교반의 메인 푸어, 스핀을 통한 베드 정돈" },
  george_peng_wbrc_2025: { description: "2025 World Brewers Cup 우승 레시피를 참고한 특수 도구 조건부 프리셋입니다.", focus: "Solo Dripper와 Melodrip, 마지막 단계의 낮은 수온을 활용" },
  park_junseong_kbrc_2026_switch: { description: "2026 코리아 브루어스컵 시연 기반으로 정리된 Hario Switch 하이브리드 프리셋입니다.", focus: "스위치 밸브를 활용한 여과와 침지 단계 조합" }
};

function getBaristaProfileInfo(preset) {
  return BARISTA_PROFILE_INFO[preset?.id] || { description: "해당 바리스타 프리셋의 원본 레시피를 기준으로 구성했습니다.", focus: preset?.grindGuidance || "원본 푸어 일정 준수" };
}

function getBaristaYoutubeUrl(preset) {
  const direct = (preset?.sourceUrls || []).find(url => /youtube\.com\/watch|youtu\.be\//i.test(url));
  if (direct) return direct;
  const query = `${preset?.baristaName || "coffee brewer"} ${preset?.recipeName || "pour over recipe"}`;
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

function onPresetSelectChange() {
  const presetSel = document.getElementById("preset-select");
  const val = presetSel ? presetSel.value : "common_mode";
  if (!val || val === "common_mode") {
    if (currentBaristaPresetId) clearBaristaPreset(false);
    currentBaristaPresetId = null;
    currentBaristaPreset = null;
    recipeType = "barista";
    wizardState.recipe = false;
    wizardState.grind = false;
    const generalOptions = document.getElementById("general-recipe-options");
    const baristaOptions = document.getElementById("barista-recipe-options");
    if (generalOptions) generalOptions.hidden = true;
    if (baristaOptions) baristaOptions.hidden = false;
    const profileCard = document.getElementById("barista-preset-summary");
    if (profileCard) profileCard.hidden = true;
    refreshWizard();
    return;
  }
  const preset = (window.BARISTA_PRESETS || []).find(p => p.id === val);
  if (!preset) return;
  // 공식 원본 용량과 비율을 그대로 적용하며 임의로 현재 도징량에 맞춰 환산하지 않습니다.
  const scaled = window.getBaristaPresetWithScaling ? window.getBaristaPresetWithScaling(val, preset.coffeeDose) : null;
  if (!scaled) return;
  const active = scaled.activeRecipe;
  if (!currentBaristaPresetId) {
    prePresetDripper = currentDripper;
    prePresetDripperLabel = currentDripperLabel;
  }
  currentBaristaPresetId = val;
  currentBaristaPreset = preset;
  currentModeKey = "barista";
  recipeType = "barista";
  wizardState.recipe = true;
  wizardState.grind = true; // 프리셋 적용 시 현재 선택된 분쇄 방식이 유지됨
  presetLockedFields = new Set(["dripper", "dose", "water", "temp", "time", "mode"]);

  // 프리셋의 드리퍼가 기본 3종이면 그대로 선택. 특수 장비는 허위로 기본 드리퍼에 치환하지 않고 이름을 따로 명시합니다.
  if ((window.DRIPPERS || {})[preset.dripper]) {
    currentDripper = preset.dripper;
    currentDripperLabel = (window.DRIPPERS[preset.dripper].fullName || window.DRIPPERS[preset.dripper].name);
    const d = window.DRIPPERS[preset.dripper];
    document.documentElement.style.setProperty("--theme-color", d.themeColor);
    document.documentElement.style.setProperty("--theme-dark", d.themeDark);
    document.documentElement.style.setProperty("--theme-soft", d.themeSoft);
    ["bluebottle","hario","kalita"].forEach(k => {
      const tab = document.getElementById("card-" + k);
      if (tab) { tab.classList.toggle("active", k === preset.dripper); tab.disabled = true; }
    });
  } else {
    currentDripper = preset.dripper;
    currentDripperLabel = preset.dripperModel || preset.dripper;
    const visual = window.DRIPPERS.hario;
    document.documentElement.style.setProperty("--theme-color", visual.themeColor);
    document.documentElement.style.setProperty("--theme-dark", visual.themeDark);
    document.documentElement.style.setProperty("--theme-soft", visual.themeSoft);
    ["bluebottle","hario","kalita"].forEach(k => { const tab=document.getElementById("card-"+k); if(tab){tab.classList.remove("active");tab.disabled=true;} });
  }
  const logo = document.getElementById("logo-badge");
  if (logo && logo.tagName !== "IMG") logo.textContent = (window.DRIPPERS[preset.dripper] || {}).badge || "★";

  const setNum = (id, value) => { const el=document.getElementById(id); if(el) el.value=value; };
  setNum("dose-num", active.coffeeDose); setNum("dose", active.coffeeDose);
  setNum("water-num", active.waterAmount); setNum("water", active.waterAmount);
  setNum("temp-num", active.temperature.recommendedC); setNum("temp", active.temperature.recommendedC);
  setNum("time-num", active.targetTime.targetSec); setNum("time", active.targetTime.targetSec);
  const generalRadio = document.querySelector('input[name="recipe-type"][value="general"]');
  const baristaRadio = document.querySelector('input[name="recipe-type"][value="barista"]');
  if (generalRadio) generalRadio.checked = false;
  if (baristaRadio) baristaRadio.checked = true;
  const generalOptions = document.getElementById("general-recipe-options");
  const baristaOptions = document.getElementById("barista-recipe-options");
  if (generalOptions) generalOptions.hidden = true;
  if (baristaOptions) baristaOptions.hidden = false;
  ["dose","water","temp","time"].forEach(field => applyStandardLockUI(field, lockStates[field] || isAllLocked));
  applyGrinderLockUI();
  const summary = document.getElementById("barista-preset-summary");
  if (summary) {
    summary.hidden = false;
    const profile = getBaristaProfileInfo(preset);
    const safe = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[ch]);
    const ytUrl = getBaristaYoutubeUrl(preset);
    const hasDirectYoutube = (preset.sourceUrls || []).some(url => /youtube\.com\/watch|youtu\.be\//i.test(url));
    const youtubeLabel = hasDirectYoutube ? "▶ 관련 YouTube 영상 보기" : "▶ YouTube에서 관련 영상 찾기";
    const special = preset.requiresSpecialEquipment ? "특수 장비 전용 프리셋입니다. 일반 드리퍼 그림은 실제 장비를 대체하는 표현이 아닙니다." : "";
    summary.classList.add("barista-profile-card");
    summary.innerHTML = `<strong>${safe(preset.baristaName)} · ${safe(preset.recipeName)}</strong><p>${safe(profile.description)}</p><p><b>추출 포인트:</b> ${safe(profile.focus)}</p><p><b>원본 세팅:</b> ${preset.coffeeDose}g / ${preset.waterAmount}g · ${Number(preset.temperature?.recommendedC || 0).toFixed(1)}°C · ${safe(preset.grindGuidance)}</p>${special ? `<p class="profile-warning">⚠️ ${safe(special)}</p>` : ""}<div class="barista-profile-links"><a href="${safe(ytUrl)}" target="_blank" rel="noopener noreferrer">${youtubeLabel}</a>${preset.sourceUrl ? `<a href="${safe(preset.sourceUrl)}" target="_blank" rel="noopener noreferrer">원본 레시피·출처</a>` : ""}</div>`;
  }
  const diagTitle = document.getElementById("diag-title");
  const diagDesc = document.getElementById("diag-desc");
  const sourceLink = document.getElementById("recipe-source-link");
  if (diagTitle) diagTitle.textContent = `[바리스타 프리셋] ${preset.baristaName} — ${preset.recipeName}`;
  if (diagDesc) diagDesc.textContent = `${preset.temperature.note} · ${preset.targetTime.note} ${scaled.scalingNotice}`;
  if (sourceLink && preset.sourceUrl) { sourceLink.href = preset.sourceUrl; sourceLink.style.display = "inline"; }
  // 중량 프리셋과 일반 모드 버튼은 잠금 상태를 명확히 보여줍니다.
  document.querySelectorAll("#weight-btns-wrap button,#mode-selector-group button").forEach(btn => btn.disabled = true);
  refreshWizard();
  updateDial();
}

function applyOriginMatrix() {
  // 바리스타 프리셋의 원본 세팅은 원두 일반 추천 매트릭스가 덮어쓰지 않습니다.
  if (currentBaristaPresetId) { updateDial(); return; }
  const selectEl = document.getElementById("origin-select");
  const originKey = selectEl ? selectEl.value : "geisha";
  const origin = (window.ORIGIN_DB || {})[originKey];
  if (!origin) return;

  const weights = window.WEIGHTS || [15, 20, 25, 30, 35, 40, 50];
  const dose = weights[currentWeightIdx] || 30;
  const waterRes = window.calculateBrewModeWater ? window.calculateBrewModeWater(dose, currentModeKey) : { totalInputWaterG: dose * 16 };
  
  const doseInput = document.getElementById("dose-num");
  const doseSlider = document.getElementById("dose");
  const waterInput = document.getElementById("water-num");
  const waterSlider = document.getElementById("water");
  const tempInput = document.getElementById("temp-num");
  const tempSlider = document.getElementById("temp");
  const timeInput = document.getElementById("time-num");
  const timeSlider = document.getElementById("time");

  if (doseInput && !lockStates["dose"] && !isAllLocked) { doseInput.value = dose; doseSlider.value = dose; }
  if (waterInput && !lockStates["water"] && !isAllLocked) { waterInput.value = waterRes.totalInputWaterG; waterSlider.value = waterRes.totalInputWaterG; }
  if (tempInput && !lockStates["temp"] && !isAllLocked) { tempInput.value = origin.temp; tempSlider.value = origin.temp; }

  const defaultTimes = origin.times || [150, 170, 190, 210, 225, 240, 265];
  const recTime = defaultTimes[currentWeightIdx] || 210;
  if (timeInput && !lockStates["time"] && !isAllLocked) { timeInput.value = recTime; timeSlider.value = recTime; }

  const diagTitle = document.getElementById("diag-title");
  const diagDesc = document.getElementById("diag-desc");
  const sourceLink = document.getElementById("recipe-source-link");
  const tempRangeHint = document.getElementById("temp-range-hint");

  if (diagTitle) diagTitle.textContent = `[${origin.name}]`;
  if (diagDesc) diagDesc.textContent = origin.note;
  if (tempRangeHint && origin.recommendedTempRangeC) {
    tempRangeHint.textContent = `권장 ${origin.recommendedTempRangeC[0]}~${origin.recommendedTempRangeC[1]}°C`;
  }

  if (sourceLink && origin.sourceUrls && origin.sourceUrls.length > 0) {
    sourceLink.href = origin.sourceUrls[0];
    sourceLink.style.display = "inline";
  }

  updateDial();
}

// ============================================================================
// 6. 다이얼 연산, 차트 2종 및 실측 TDS·EY 연동
// ============================================================================
function formatSecToKorean(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}분 ${s < 10 ? "0" + s : s}초 (${Math.round(sec)}초)`;
}

function formatMMSS(sec) {
  const absSec = Math.floor(Math.abs(sec));
  const m = Math.floor(absSec / 60);
  const s = absSec % 60;
  const sign = sec < 0 ? "-" : "";
  return `${sign}${m < 10 ? "0" + m : m}:${s < 10 ? "0" + s : s}`;
}

function getEstimatedBrewMetrics(doseArg, waterArg, timeArg) {
  const dose = Math.max(1, Number(doseArg) || 30);
  const water = Math.max(1, Number(waterArg) || 480);
  const time = Math.max(1, Number(timeArg) || 210);
  const temp = Number(document.getElementById("temp-num")?.value) || 95;
  const ratio = water / dose;
  const grindMode = getSelectedGrinderMode();
  const grindLevel = getSelectedGeneralGrindLevel();
  // 검증된 예측 모델이 아닌 화면용 참고 휴리스틱입니다. 그라인더 클릭/마이크론은 환산하지 않습니다.
  const grindOffset = grindMode === "general" ? (grindLevel - 3) * 0.22 : 0;
  const ey = Math.max(16, Math.min(23, 19.5 + (temp - 93) * 0.04 + (time - 180) * 0.006 + (16 - ratio) * 0.12 + grindOffset));
  // 예상 음료량은 총 투입수량의 94%라는 단순 가정입니다. 실제 배수·보유수량을 측정한 값이 아닙니다.
  const assumedBeverageMass = water * 0.94;
  const tds = ey * dose / Math.max(1, assumedBeverageMass);
  return { ey, tds, eyMargin: 1.8, tdsMargin: 0.15, assumedBeverageMass };
}

function getEstimatedFlavorProfile(doseArg, waterArg, timeArg) {
  const dose = Math.max(1, Number(doseArg) || 30);
  const water = Math.max(1, Number(waterArg) || 480);
  const time = Math.max(1, Number(timeArg) || 210);
  const temp = Number(document.getElementById("temp-num")?.value) || 95;
  const ratio = water / dose;
  const grindMode = getSelectedGrinderMode();
  const grindLevel = getSelectedGeneralGrindLevel();
  const grindOffset = grindMode === "general" ? (grindLevel - 3) * 0.22 : 0;
  // 검증된 관능 예측 모델이 아닌 화면용 참고 지수입니다. 실제 맛 점수로 해석하지 않습니다.
  const extractionIndex = Math.max(-1, Math.min(1,
    (16 - ratio) * 0.055 + (temp - 93) * 0.035 + (time - 180) * 0.0025 + grindOffset * 0.32
  ));
  const sour = Math.max(0.5, Math.min(4.8, 3.0 - extractionIndex * 0.48));
  const sweet = Math.max(0.5, Math.min(4.8, 3.0 + (1 - Math.abs(extractionIndex)) * 0.28));
  const bitter = Math.max(0.5, Math.min(4.8, 2.45 + Math.max(0, extractionIndex) * 0.62));
  return { sour, sweet, bitter };
}

function drawPredictedFlavorChart(profile) {
  const canvas = document.getElementById("predictedFlavorChart");
  if (!canvas || !profile) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
  const rows = [
    { label: "산미", value: profile.sour, color: "#d69a49" },
    { label: "단맛", value: profile.sweet, color: "#659a73" },
    { label: "쓴맛", value: profile.bitter, color: "#7588a8" }
  ];
  const left = 88, right = 74, top = 14, rowH = 44, barH = 17;
  const barW = W - left - right;
  ctx.font = "bold 15px sans-serif"; ctx.textBaseline = "middle";
  rows.forEach((row, i) => {
    const y = top + i * rowH;
    ctx.fillStyle = "#405547"; ctx.textAlign = "right"; ctx.fillText(row.label, left - 14, y + barH / 2);
    ctx.fillStyle = "#edf2ed"; ctx.beginPath(); ctx.roundRect(left, y, barW, barH, 8); ctx.fill();
    const width = Math.max(0, Math.min(5, row.value)) / 5 * barW;
    ctx.fillStyle = row.color; ctx.beginPath(); ctx.roundRect(left, y, width, barH, 8); ctx.fill();
    ctx.fillStyle = "#526456"; ctx.textAlign = "left"; ctx.font = "bold 13px sans-serif";
    ctx.fillText(`${row.value.toFixed(1)} / 5`, left + barW + 10, y + barH / 2);
  });
  ctx.font = "10px sans-serif"; ctx.fillStyle = "#8a978c"; ctx.textAlign = "right";
  ctx.fillText("참고용 추정 지수", W - 12, H - 7);
}

function updateDial() {
  const d = (window.DRIPPERS || {})[currentDripper] || { themeColor: "#00a1e4", themeDark: "#0077ac" };
  const dose = parseFloat(document.getElementById("dose-num").value) || 30;
  const water = parseFloat(document.getElementById("water-num").value) || 480;
  const time = parseFloat(document.getElementById("time-num").value) || 210;
  const ratio = water / dose;

  const doseLabel = document.getElementById("dose-label");
  const waterLabel = document.getElementById("water-label");
  const tempLabel = document.getElementById("temp-label");
  const timeLabel = document.getElementById("time-label");
  const tempNumInput = document.getElementById("temp-num");

  if (doseLabel) doseLabel.textContent = `${dose}g`;
  if (waterLabel) waterLabel.textContent = `${water}g (1:${ratio.toFixed(1)})`;
  if (tempLabel && tempNumInput) tempLabel.textContent = `${parseFloat(tempNumInput.value || 95).toFixed(1)}°C`;
  if (timeLabel) timeLabel.textContent = formatSecToKorean(time);

  const kpiWaterVal = document.getElementById("kpi-water-val");
  const kpiWaterSub = document.getElementById("kpi-water-sub");
  const kpiWaterBadge = document.getElementById("kpi-water-badge");
  if (kpiWaterVal) kpiWaterVal.textContent = `${water}g 투입`;
  if (kpiWaterSub) {
    if (currentModeKey === "bypass") {
      const wRes = window.calculateBrewModeWater ? window.calculateBrewModeWater(dose, "bypass") : { dripperInputWaterG: 360, bypassHotWaterG: 120 };
      kpiWaterSub.textContent = `바이패스: 드리퍼 ${wRes.dripperInputWaterG}g + 서버온수 ${wRes.bypassHotWaterG}g`;
      if (kpiWaterBadge) kpiWaterBadge.textContent = "바이패스";
    } else if (currentModeKey === "barista" && currentBaristaPreset) {
      const label = `${currentBaristaPreset.baristaName} 프리셋`;
      kpiWaterSub.textContent = `${label} · 원본 비율 1:${ratio.toFixed(1)}`;
      if (kpiWaterBadge) kpiWaterBadge.textContent = "바리스타 원본";
    } else {
      const modeObj = (window.BREW_MODES || {})[currentModeKey] || { shortName: "표준" };
      kpiWaterSub.textContent = `모드: ${modeObj.shortName} (비율 1:${ratio.toFixed(1)})`;
      if (kpiWaterBadge) kpiWaterBadge.textContent = modeObj.shortName;
    }
  }

  // 레시피 설정에 근거한 참고용 예상값과 실측값을 분리해 표시합니다.
  const estimated = getEstimatedBrewMetrics(dose, water, time);
  drawPredictedFlavorChart(getEstimatedFlavorProfile(dose, water, time));
  const estimatedEyEl = document.getElementById("analysis-estimated-ey");
  const estimatedTdsEl = document.getElementById("analysis-estimated-tds");
  if (estimatedEyEl) estimatedEyEl.textContent = `약 ${estimated.ey.toFixed(1)}% (±${estimated.eyMargin.toFixed(1)})`;
  if (estimatedTdsEl) estimatedTdsEl.textContent = `약 ${estimated.tds.toFixed(2)}% (±${estimated.tdsMargin.toFixed(2)})`;

  const measuredTdsInput = document.getElementById("measured-tds");
  const measuredBevInput = document.getElementById("measured-bev");
  const measuredEyResult = document.getElementById("measured-ey-result");
  const eyVal = document.getElementById("ey-val");
  const eyBadge = document.getElementById("ey-badge");
  const tdsSub = document.getElementById("tds-sub");
  const tdsVal = measuredTdsInput ? measuredTdsInput.value : null;
  const bevVal = measuredBevInput ? measuredBevInput.value : null;
  const hasTds = tdsVal !== null && tdsVal !== "" && Number(tdsVal) > 0;
  const hasBev = bevVal !== null && bevVal !== "" && Number(bevVal) > 0;
  const measured = window.calculateMeasuredBrewMetrics ? window.calculateMeasuredBrewMetrics(dose, tdsVal, bevVal) : { isMeasured: false };
  const analysisEy = document.getElementById("analysis-measured-ey");
  const analysisTds = document.getElementById("analysis-measured-tds");
  if (analysisTds) analysisTds.textContent = hasTds ? `${Number(tdsVal).toFixed(2)}%` : "측정 필요";
  if (analysisEy) analysisEy.textContent = measured.isMeasured ? `${measured.calculatedEY_percent.toFixed(2)}%` : "측정 필요";

  if (measured.isMeasured) {
    const ey = measured.calculatedEY_percent;
    const tds = measured.measuredTDS_percent;
    if (eyVal) eyVal.textContent = `예상 ${estimated.ey.toFixed(1)}% / 실측 ${ey.toFixed(2)}% EY`;
    if (tdsSub) tdsSub.textContent = `예상 TDS ${estimated.tds.toFixed(2)}% · 실측 TDS ${tds.toFixed(2)}% · 실제 측정값을 우선 확인하세요.`;
    if (measuredEyResult) measuredEyResult.textContent = `[실측 계산] EY ${ey.toFixed(2)}% = TDS ${tds.toFixed(2)}% × 음료 ${Number(bevVal).toFixed(0)}g ÷ 원두 ${dose}g`;
    if (eyBadge) {
      eyBadge.textContent = measured.withinGoldenCupEY && measured.withinGoldenCupTDS ? "실측 골든컵 참고 영역" : "실측값 범위 확인";
      eyBadge.className = measured.withinGoldenCupEY && measured.withinGoldenCupTDS ? "badge badge-good" : "badge badge-warn";
    }
    drawScaChart(ey, tds, d.themeColor, d.themeDark, estimated.ey, estimated.tds);
  } else {
    if (eyVal) eyVal.textContent = `예상 EY ${estimated.ey.toFixed(1)}% · TDS ${estimated.tds.toFixed(2)}%`;
    if (tdsSub) tdsSub.textContent = `참고용 단순 추정치(± EY ${estimated.eyMargin.toFixed(1)}%p / TDS ${estimated.tdsMargin.toFixed(2)}%p). 실제 결과와 다를 수 있습니다.`;
    if (measuredEyResult) measuredEyResult.textContent = hasTds && !hasBev
      ? "실제 완성 음료 무게를 입력하면 실측 EY를 계산합니다."
      : "추출 완료 후 굴절계 TDS와 실제 음료 무게를 입력하세요.";
    if (eyBadge) { eyBadge.textContent = "예상값 · 실측 대기"; eyBadge.className = "badge badge-info"; }
    drawScaChart(null, null, d.themeColor, d.themeDark, estimated.ey, estimated.tds);
  }

  // 정량 향미 예측은 제거한다. 향미는 실제 시음 후 사용자가 평가·기록한다.
  const sourEl = document.getElementById("sour-pct");
  const sweetEl = document.getElementById("sweet-pct");
  const bitterEl = document.getElementById("bitter-pct");
  const balancePointer = document.getElementById("balance-pointer");
  if (sourEl) sourEl.textContent = "—";
  if (sweetEl) sweetEl.textContent = "시음 평가";
  if (bitterEl) bitterEl.textContent = "—";
  if (balancePointer) balancePointer.style.display = "none";

  updateGrinderSummary();
  drawTimeChart(time, d.themeColor);
  updateBrewProfileStats();
}

// ----------------------------------------------------------------------------
// v1.651 유지: 설정된 물 붓기 일정 및 추출 프로파일 통계
// ----------------------------------------------------------------------------
function getAnalyticsPourSchedule() {
  const dose = parseFloat(document.getElementById("dose-num")?.value) || 30;
  const totalWater = parseFloat(document.getElementById("water-num")?.value) || 480;
  const totalTime = parseFloat(document.getElementById("time-num")?.value) || 210;

  if (currentBaristaPreset && Array.isArray(currentBaristaPreset.pourSchedule) && currentBaristaPreset.pourSchedule.length) {
    const factor = dose / (Number(currentBaristaPreset.coffeeDose) || dose);
    return currentBaristaPreset.pourSchedule.map((step, index, all) => {
      const previous = index ? Number(all[index - 1].cumulativeWaterG) : 0;
      const previousScaled = Math.round(previous * factor);
      const cumulative = Math.round(Number(step.cumulativeWaterG) * factor);
      const start = Number(step.startTimeSec ?? step.timeSec ?? 0);
      const pourEnd = Number(step.endTimeSec ?? (start + 12));
      const wait = Number(step.waitUntilSec ?? pourEnd);
      const phase = /bloom/i.test(String(step.phase || "")) ? "뜸들이기" : `${index}차 푸어`;
      return { name: phase, startSec: start, pourEndSec: Math.max(start + 1, pourEnd), endSec: Math.max(pourEnd, wait), addWater: Number(step.pourAmountG ?? cumulative - previousScaled), cumulativeWaterG: cumulative };
    });
  }

  let dripperWater = totalWater;
  if (currentModeKey === "bypass" && window.calculateBrewModeWater) {
    const result = window.calculateBrewModeWater(dose, "bypass");
    dripperWater = Number(result.dripperInputWaterG) || totalWater;
  }
  const w1 = Math.min(Math.round(dripperWater * 0.24), Math.round(dose * 2.2));
  const w2 = Math.round(dripperWater * 0.45);
  const w3 = Math.round(dripperWater * 0.74);
  const w4 = dripperWater;
  const t1 = 0;
  const t2 = Math.min(40, Math.round(totalTime * 0.20));
  const t3 = Math.round(totalTime * 0.44);
  const t4 = Math.round(totalTime * 0.68);
  const p1 = Math.max(8, Math.round((t2 - t1) * 0.45));
  const p2 = Math.max(10, Math.round((t3 - t2) * 0.52));
  const p3 = Math.max(10, Math.round((t4 - t3) * 0.52));
  const p4 = Math.max(10, Math.round((totalTime - t4) * 0.45));
  return [
    { name: "뜸들이기", startSec: t1, pourEndSec: t1 + p1, endSec: t2, addWater: w1, cumulativeWaterG: w1 },
    { name: "1차 푸어", startSec: t2, pourEndSec: t2 + p2, endSec: t3, addWater: w2 - w1, cumulativeWaterG: w2 },
    { name: "2차 푸어", startSec: t3, pourEndSec: t3 + p3, endSec: t4, addWater: w3 - w2, cumulativeWaterG: w3 },
    { name: "마무리 푸어", startSec: t4, pourEndSec: t4 + p4, endSec: totalTime, addWater: w4 - w3, cumulativeWaterG: w4 }
  ];
}

function updateBrewProfileStats() {
  const dose = parseFloat(document.getElementById("dose-num")?.value) || 30;
  const water = parseFloat(document.getElementById("water-num")?.value) || 480;
  const temp = parseFloat(document.getElementById("temp-num")?.value) || 95;
  const time = parseFloat(document.getElementById("time-num")?.value) || 210;
  const ratio = water / dose;
  const result = currentModeKey === "bypass" && window.calculateBrewModeWater
    ? window.calculateBrewModeWater(dose, "bypass") : null;
  const schedule = getAnalyticsPourSchedule();
  const stats = {
    "profile-ratio": `1:${ratio.toFixed(1)}`,
    "profile-dose-water": `${dose}g / ${water}g`,
    "profile-temp-time": `${temp.toFixed(1)}°C / ${formatMMSS(time)}`,
    "profile-pour-count": `${schedule.length}단계 / ${result ? `${Number(result.bypassHotWaterG || 0)}g 온수` : "없음"}`
  };
  Object.entries(stats).forEach(([id,value]) => { const el=document.getElementById(id); if(el) el.textContent=value; });
  drawPourScheduleChart(schedule, time, water);
  drawRatioChart(ratio);
  const list=document.getElementById("pour-schedule-list");
  if (list) {
    list.innerHTML = schedule.map((stage,index) => `<div class="pour-schedule-item"><strong>${index+1}. ${stage.name}</strong><span>${formatMMSS(stage.startSec)}–${formatMMSS(stage.endSec)} · +${Math.round(stage.addWater)}g</span><span>누적 ${Math.round(stage.cumulativeWaterG)}g</span></div>`).join("");
  }
}

function drawPourScheduleChart(schedule, targetTime, totalWater) {
  const canvas=document.getElementById("pourScheduleChart"); if(!canvas) return;
  const ctx=canvas.getContext("2d"), W=canvas.width, H=canvas.height;
  ctx.clearRect(0,0,W,H);
  const left=42,right=16,top=20,bottom=34,plotW=W-left-right,plotH=H-top-bottom;
  const maxTime=Math.max(60, Math.ceil(Math.max(targetTime,...schedule.map(s=>s.endSec))/60)*60);
  const maxWater=Math.max(50,totalWater);
  ctx.font="10px sans-serif"; ctx.fillStyle="#77847a"; ctx.textAlign="right";
  for(let i=0;i<=4;i++){const grams=maxWater*i/4,y=top+plotH-(plotH*i/4);ctx.fillText(`${Math.round(grams)}g`,left-6,y+3);ctx.strokeStyle="#e9eee9";ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(W-right,y);ctx.stroke();}
  ctx.textAlign="center";
  const ticks=6;
  for(let i=0;i<=ticks;i++){const sec=maxTime*i/ticks,x=left+plotW*i/ticks;ctx.fillText(`${Math.round(sec)}s`,x,H-9);}
  const points=[{time:0,water:0},...schedule.map(s=>({time:s.pourEndSec,water:s.cumulativeWaterG}))];
  ctx.beginPath();ctx.strokeStyle="#5f8067";ctx.lineWidth=3;
  points.forEach((p,i)=>{const x=left+Math.min(maxTime,p.time)/maxTime*plotW,y=top+plotH-Math.min(maxWater,p.water)/maxWater*plotH;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();
  points.slice(1).forEach((p,i)=>{const x=left+Math.min(maxTime,p.time)/maxTime*plotW,y=top+plotH-Math.min(maxWater,p.water)/maxWater*plotH;ctx.beginPath();ctx.fillStyle="#5f8067";ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();ctx.fillStyle="#47664d";ctx.font="bold 9px sans-serif";ctx.textAlign="left";ctx.fillText(`${Math.round(p.water)}g`,Math.min(W-right-30,x+5),Math.max(top+10,y-8));});
  const tx=left+Math.min(maxTime,targetTime)/maxTime*plotW;ctx.beginPath();ctx.setLineDash([4,4]);ctx.strokeStyle="#248bd5";ctx.lineWidth=2;ctx.moveTo(tx,top);ctx.lineTo(tx,top+plotH);ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle="#248bd5";ctx.font="bold 9px sans-serif";ctx.textAlign="center";ctx.fillText("목표",tx,top-6);
}

function drawRatioChart(currentRatio) {
  const canvas=document.getElementById("ratioChart"); if(!canvas) return;
  const ctx=canvas.getContext("2d"),W=canvas.width,H=canvas.height;ctx.clearRect(0,0,W,H);
  const values=[12,14,16,18],left=48,right=20,top=22,bottom=34,plotW=W-left-right,rowH=(H-top-bottom)/values.length;
  const max=20;ctx.font="10px sans-serif";ctx.textBaseline="middle";
  values.forEach((value,index)=>{const y=top+index*rowH+7;ctx.fillStyle="#596b5d";ctx.textAlign="right";ctx.fillText(`1:${value}`,left-9,y+5);ctx.fillStyle="#edf2ed";ctx.fillRect(left,y,plotW,12);ctx.fillStyle="#9db3a0";ctx.fillRect(left,y,plotW*value/max,12);});
  const currentY=top+rowH*3+7;ctx.fillStyle="#a77b43";ctx.fillRect(left,currentY+15,plotW*Math.max(0,Math.min(max,currentRatio))/max,12);ctx.fillStyle="#805b2d";ctx.textAlign="left";ctx.fillText(`현재 설정 1:${currentRatio.toFixed(1)}`,left,currentY+39);
  ctx.fillStyle="#7b897e";ctx.textAlign="center";ctx.fillText("참고 비율 비교 (실제 추출 품질 점수 아님)",W/2,H-7);
}

// ----------------------------------------------------------------------------
// 차트 1: 시간별 용출 차트
// ----------------------------------------------------------------------------
function drawTimeChart(targetTime, themeColor) {
  const canvas = document.getElementById("timeChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const padL = 36, padR = 20, padT = 20, padB = 28;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxT = 360;

  ctx.strokeStyle = "#e9ecef";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padT + (plotH / 4) * i;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
  }

  ctx.fillStyle = "#868e96"; ctx.font = "10px sans-serif"; ctx.textAlign = "center";
  [0, 60, 120, 180, 240, 300, 360].forEach(sec => {
    ctx.fillText(`${sec}s`, padL + (sec / maxT) * plotW, H - 8);
  });

  const curves = [
    { color: "#f59f00", fn: t => (t > 10 ? Math.pow((t - 10) / 45, 1.4) * Math.exp(-(t - 10) / 45) : 0) * 1.8 },
    { color: "#37b24d", fn: t => (t > 28 ? Math.pow((t - 28) / 95, 2.0) * Math.exp(-(t - 28) / 60) : 0) * 1.45 },
    { color: "#7950f2", fn: t => (1 / (1 + Math.exp(-(t - 170) / 35))) * 0.82 }
  ];

  curves.forEach(c => {
    ctx.beginPath(); ctx.strokeStyle = c.color; ctx.lineWidth = 2;
    for (let t = 0; t <= maxT; t += 5) {
      const x = padL + (t / maxT) * plotW;
      const y = padT + plotH - Math.min(plotH, c.fn(t) * plotH * 0.85);
      t === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  });

  const tx = padL + (Math.min(maxT, targetTime) / maxT) * plotW;
  ctx.beginPath(); ctx.setLineDash([4, 4]); ctx.strokeStyle = themeColor; ctx.lineWidth = 2;
  ctx.moveTo(tx, padT); ctx.lineTo(tx, padT + plotH); ctx.stroke();
  ctx.setLineDash([]);
}

// ----------------------------------------------------------------------------
// 차트 2: SCA 골든컵 컨트롤 차트
// ----------------------------------------------------------------------------
function drawScaChart(ey, tds, themeColor, themeDark, estimatedEy = null, estimatedTds = null) {
  const canvas = document.getElementById("scaChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const padL = 36, padR = 16, padT = 18, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const minEy = 14, maxEy = 26, minTds = 0.8, maxTds = 2.0;

  ctx.fillStyle = "#868e96"; ctx.font = "9.5px sans-serif"; ctx.textAlign = "center";
  [14, 16, 18, 20, 22, 24, 26].forEach(val => {
    const x = padL + ((val - minEy) / (maxEy - minEy)) * plotW;
    ctx.fillText(`${val}%`, x, H - 8);
    ctx.strokeStyle = "#f1f3f5"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); ctx.stroke();
  });

  ctx.textAlign = "right";
  [0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0].forEach(val => {
    const y = padT + plotH - ((val - minTds) / (maxTds - minTds)) * plotH;
    ctx.fillText(`${val.toFixed(1)}%`, padL - 4, y + 3);
    ctx.strokeStyle = "#f1f3f5"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
  });

  const gx1 = padL + ((18.0 - minEy) / (maxEy - minEy)) * plotW;
  const gx2 = padL + ((22.0 - minEy) / (maxEy - minEy)) * plotW;
  const gy1 = padT + plotH - ((1.35 - minTds) / (maxTds - minTds)) * plotH;
  const gy2 = padT + plotH - ((1.15 - minTds) / (maxTds - minTds)) * plotH;

  ctx.fillStyle = "rgba(0, 161, 228, 0.16)";
  ctx.fillRect(gx1, gy1, gx2 - gx1, gy2 - gy1);
  ctx.strokeStyle = themeColor; ctx.lineWidth = 2;
  ctx.strokeRect(gx1, gy1, gx2 - gx1, gy2 - gy1);

  ctx.fillStyle = themeDark; ctx.font = "bold 10.5px sans-serif"; ctx.textAlign = "center";
  ctx.fillText("SCA Golden Cup Target", (gx1 + gx2) / 2, (gy1 + gy2) / 2 + 4);

  const point = (pointEy, pointTds, color, label, shape) => {
    if (pointEy === null || pointEy === undefined || pointTds === null || pointTds === undefined || !Number.isFinite(Number(pointEy)) || !Number.isFinite(Number(pointTds))) return;
    const x = padL + ((Math.max(minEy, Math.min(maxEy, Number(pointEy))) - minEy) / (maxEy - minEy)) * plotW;
    const y = padT + plotH - ((Math.max(minTds, Math.min(maxTds, Number(pointTds))) - minTds) / (maxTds - minTds)) * plotH;
    ctx.save(); ctx.fillStyle = color; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2;
    ctx.beginPath();
    if (shape === "square") ctx.rect(x - 5.5, y - 5.5, 11, 11); else ctx.arc(x, y, 6.5, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = color; ctx.font = "bold 9.5px sans-serif"; ctx.textAlign = "left";
    ctx.fillText(label, x + 8, y - 5); ctx.restore();
  };
  point(estimatedEy, estimatedTds, "#2563eb", "예상", "square");
  point(ey, tds, "#dc2626", "실측", "circle");
  ctx.fillStyle = "#6c757d"; ctx.font = "9px sans-serif"; ctx.textAlign = "left";
  ctx.fillText("■ 예상값   ● 실측값", padL + 4, H - 23);
}

// ============================================================================
// 7. 앱 내부 누적 저장 + 단일 엑셀(.csv) 강제 저장 및 백업·복원 시스템
// ============================================================================
const TASTING_LOG_STORAGE_KEY = "brewmap_tasting_logs_v1652"; // v1.652 이후 기존 기록 키를 유지하여 호환
function getTastingLogs() {
  try { const data = JSON.parse(localStorage.getItem(TASTING_LOG_STORAGE_KEY) || "[]"); return Array.isArray(data) ? data : []; }
  catch (error) { console.warn("추출 평가 기록을 읽지 못했습니다.", error); return []; }
}
function setTastingLogs(records) {
  try { localStorage.setItem(TASTING_LOG_STORAGE_KEY, JSON.stringify(records.slice(0, 500))); return true; }
  catch (error) { console.error("추출 평가 기록 자동 저장 실패:", error); const status=document.getElementById("tasting-save-status"); if(status) status.textContent="브라우저 저장 공간에 기록을 저장하지 못했습니다. 저장 공간을 확인해 주세요."; return false; }
}
let ratingSvgIdCounter = 0;
function renderRatingStarSvg(fillFraction, extraClass = "") {
  const fill = Math.max(0, Math.min(1, Number(fillFraction) || 0));
  const clipId = `brewmap-star-clip-${++ratingSvgIdCounter}`;
  const clip = fill > 0 && fill < 1
    ? `<defs><clipPath id="${clipId}"><rect x="0" y="0" width="${(24 * fill).toFixed(2)}" height="24" /></clipPath></defs>`
    : "";
  const filled = fill >= 1
    ? `<path d="M12 2.1l2.95 6.0 6.62.96-4.78 4.66 1.13 6.59L12 17.2l-5.92 3.11 1.13-6.59-4.78-4.66 6.62-.96L12 2.1z" fill="#d69a39" stroke="#b9852b" stroke-width=".65"/>`
    : fill > 0
      ? `<path d="M12 2.1l2.95 6.0 6.62.96-4.78 4.66 1.13 6.59L12 17.2l-5.92 3.11 1.13-6.59-4.78-4.66 6.62-.96L12 2.1z" fill="#d69a39" stroke="#b9852b" stroke-width=".65" clip-path="url(#${clipId})"/>`
      : "";
  const base = `<path d="M12 2.1l2.95 6.0 6.62.96-4.78 4.66 1.13 6.59L12 17.2l-5.92 3.11 1.13-6.59-4.78-4.66 6.62-.96L12 2.1z" fill="#e1e7e1" stroke="#aeb9af" stroke-width=".75"/>`;
  return `<svg class="${extraClass}" viewBox="0 0 24 24" role="img" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">${clip}${base}${filled}</svg>`;
}
function renderStarRatingText(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return "미평가";
  const rating = Math.max(0.5, Math.min(5, Math.round(raw * 2) / 2));
  const out = Array.from({length:5}, (_, index) => renderRatingStarSvg(Math.max(0, Math.min(1, rating - index)))).join("");
  return `<span class="saved-rating-stars" aria-label="전체 만족도 ${rating.toFixed(1)}점">${out}</span>`;
}
function renderTastingHistorySummary() {
  const el = document.getElementById("tasting-history-summary");
  if (!el) return;
  const all = getTastingLogs();
  const visible = isMaster ? all : all.filter(r => r.author === currentUserName);
  if (!visible.length) { el.textContent = "아직 자동 저장된 추출·관능평가 기록이 없습니다."; return; }
  const r = visible[0];
  const f = r.flavorRatings || {};
  const hasOverall = r.overallRating !== null && r.overallRating !== undefined && r.overallRating !== "" && Number.isFinite(Number(r.overallRating));
  const satisfaction = hasOverall ? ` · 전체 만족도 ${renderStarRatingText(Number(r.overallRating))} (${Number(r.overallRating).toFixed(1)}/5)` : " · 전체 만족도 미평가";
  const intent = r.rebrewIntent ? ` · 재추출: ${({repeat:"다시 추출",adjust:"수정 후 추출",no:"재추출 안 함"})[r.rebrewIntent] || r.rebrewIntent}` : "";
  // 이 영역은 별점 HTML을 표시하므로, 저장 데이터에서 오는 텍스트는 모두 HTML 이스케이프합니다.
  el.innerHTML = `최근 기록: ${escapeRecipeHtml(r.date || "")} · ${escapeRecipeHtml(r.beanName || "원두")} / ${escapeRecipeHtml(r.dripperLabel || r.dripper || "")} · 강도 산미 ${escapeRecipeHtml(f.sour ?? "—")}, 단맛 ${escapeRecipeHtml(f.sweet ?? "—")}, 쓴맛 ${escapeRecipeHtml(f.bitter ?? "—")}${satisfaction}${escapeRecipeHtml(intent)} · 총 ${visible.length}건`;
}
function currentBrewSnapshot() {
  const dose = Number(document.getElementById("dose-num")?.value) || 30;
  const water = Number(document.getElementById("water-num")?.value) || 480;
  const time = Number(document.getElementById("time-num")?.value) || 210;
  const temp = Number(document.getElementById("temp-num")?.value) || 95;
  const origin = document.getElementById("origin-select")?.value || "";
  const bean = (window.ORIGIN_DB || {})[origin];
  const estimated = getEstimatedBrewMetrics(dose, water, time);
  const estimatedFlavorProfile = getEstimatedFlavorProfile(dose, water, time);
  const tds = document.getElementById("measured-tds")?.value;
  const beverageMass = document.getElementById("measured-bev")?.value;
  const measured = window.calculateMeasuredBrewMetrics ? window.calculateMeasuredBrewMetrics(dose, tds, beverageMass) : { isMeasured: false };
  return {
    dripper: currentDripper, dripperLabel: currentDripperLabel, origin, beanName: bean?.name || "",
    recipeType: recipeType || "general", baristaPresetId: currentBaristaPresetId || "", baristaName: currentBaristaPreset?.baristaName || "",
    dose, water, temp, time, ratio: water / dose,
    grinderMode: getSelectedGrinderMode(),
    grinderId: getSelectedGrinderMode() === "registered" ? (document.getElementById("grinder-select")?.value || "") : "",
    grinderSetting: getSelectedGrinderMode() === "registered" ? (Number(document.getElementById("grinder-dial-num")?.value) || null) : null,
    generalGrindLevel: getSelectedGrinderMode() === "general" ? getSelectedGeneralGrindLevel() : null,
    estimatedEY: estimated.ey, estimatedTDS: estimated.tds, estimatedFlavorProfile,
    measuredTDS: tds !== "" && tds != null ? Number(tds) : null,
    measuredBeverageMass: beverageMass !== "" && beverageMass != null ? Number(beverageMass) : null,
    measuredEY: measured.isMeasured ? measured.calculatedEY_percent : null
  };
}
function beginNewBrewSession() {
  if (tastingAutoSaveTimer) { clearTimeout(tastingAutoSaveTimer); tastingAutoSaveTimer = null; }
  currentBrewSessionId = `brew_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  latestTastingRecord = null;
  tastingSkipped = false;
  currentOverallRating = null;
  ["sour","sweet","bitter"].forEach(key => { const el=document.getElementById(`flavor-${key}`); if(el) { el.value="2.5"; el.dataset.rated="false"; } });
  ["measured-tds","measured-bev"].forEach(id => { const el=document.getElementById(id); if(el) el.value=""; });
  const intent=document.getElementById("tasting-rebrew-intent"); if(intent) intent.value="";
  const note=document.getElementById("tasting-personal-note"); if(note) note.value="";
  const panel=document.getElementById("postbrew-evaluation-panel"); if(panel) panel.hidden=true;
  const btn=document.getElementById("btn-save-tasting"); if(btn) btn.disabled=false;
  const status=document.getElementById("tasting-save-status"); if(status) status.textContent="";
  renderOverallRatingStars();
  updateFlavorChart();
  updateDial();
}
function showPostBrewEvaluation() {
  const panel=document.getElementById("postbrew-evaluation-panel");
  if (panel) { panel.hidden=false; panel.scrollIntoView({behavior:"smooth",block:"nearest"}); }
  const status=document.getElementById("tasting-save-status");
  if (status && !latestTastingRecord) status.textContent="추출이 끝났습니다. 예상 향미와 비교하면서 실제 맛의 강도와 전체 만족도를 입력해 주세요. 입력 내용은 자동 저장됩니다.";
  updateFlavorChart();
}
function hasTastingInput(ratings, overall, intent, note, tds, beverageMass) {
  return Object.values(ratings).some(v => v !== null) || overall !== null || !!intent || !!(note && note.trim()) || !!tds || !!beverageMass;
}
function persistTastingEvaluation(finalize = false) {
  if (!currentBrewSessionId) currentBrewSessionId = `brew_${Date.now()}`;
  const ratings = getFlavorRatings();
  const overall = currentOverallRating;
  const intent = document.getElementById("tasting-rebrew-intent")?.value || "";
  const note = document.getElementById("tasting-personal-note")?.value || "";
  const tds = document.getElementById("measured-tds")?.value || "";
  const beverageMass = document.getElementById("measured-bev")?.value || "";
  if (!hasTastingInput(ratings, overall, intent, note, tds, beverageMass)) {
    if (finalize) alert("맛의 강도, 전체 만족도, 재추출 의향, 메모 또는 실제 측정값 중 하나 이상 입력해 주세요.");
    return false;
  }
  const snapshot = currentBrewSnapshot();
  const previous = getTastingLogs().find(item => item.sessionId === currentBrewSessionId);
  const record = {
    id: currentBrewSessionId, sessionId: currentBrewSessionId,
    date: previous?.date || new Date().toLocaleString("ko-KR"), updatedAt: new Date().toISOString(),
    author: currentUserName, roleCode: isMaster ? "MASTER" : "GUEST", ...snapshot,
    flavorRatings: ratings, overallRating: overall, rebrewIntent: intent, personalNote: note,
    recordStatus: (finalize || previous?.recordStatus === "completed") ? "completed" : "draft",
    note: note || ""
  };
  const records = getTastingLogs().filter(item => item.sessionId !== currentBrewSessionId);
  records.unshift(record);
  if (!setTastingLogs(records)) return false;
  latestTastingRecord = record;
  renderTastingHistorySummary();
  updateFlavorChart();
  const status=document.getElementById("tasting-save-status");
  if (status) status.textContent = finalize
    ? "✓ 관능평가를 완료하고 추출 기록에 자동 저장했습니다. 레시피 설정은 별도 저장 버튼으로 보관할 수 있습니다."
    : "✓ 입력한 평가가 기기에 자동 저장되었습니다.";
  const summary=document.getElementById("flavor-latest-summary");
  if (summary) summary.textContent = `실제 강도: 산미 ${ratings.sour ?? "미평가"} · 단맛 ${ratings.sweet ?? "미평가"} · 쓴맛 ${ratings.bitter ?? "미평가"} · 전체 만족도 ${overall === null ? "미평가" : `${overall.toFixed(1)}/5`}`;
  return true;
}
function scheduleTastingAutoSave() {
  if (tastingAutoSaveTimer) clearTimeout(tastingAutoSaveTimer);
  tastingAutoSaveTimer = window.setTimeout(() => {
    tastingAutoSaveTimer = null;
    persistTastingEvaluation(false);
  }, 450);
}
function saveTastingEvaluation() {
  if (tastingAutoSaveTimer) { clearTimeout(tastingAutoSaveTimer); tastingAutoSaveTimer = null; }
  persistTastingEvaluation(true);
}
function skipTastingEvaluation() {
  if (tastingAutoSaveTimer) { clearTimeout(tastingAutoSaveTimer); tastingAutoSaveTimer = null; }
  persistTastingEvaluation(false);
  tastingSkipped = true;
  const panel=document.getElementById("postbrew-evaluation-panel"); if(panel) panel.hidden=true;
  const status=document.getElementById("tasting-save-status");
  if (status) status.textContent = latestTastingRecord ? "현재까지 입력한 평가는 자동 저장되어 있습니다. 추출 기록에서 확인할 수 있습니다." : "관능평가를 건너뛰었습니다. 평가 입력이 없어 저장된 관능평가 기록은 없습니다.";
}

const STORAGE_KEY = "ohBaristaCumulativeRecipesDB_v3";

function getStoredRecipes() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  let list;
  try { list = JSON.parse(raw); } catch (error) {
    console.error("저장된 레시피 데이터를 읽지 못했습니다:", error);
    return [];
  }
  if (!Array.isArray(list)) return [];

  let migrated = false;
  list.forEach(recipe => {
    // v1.5의 grind 필드는 실제 그라인더 눈금이 아닌 시뮬레이션 저항지수였다.
    if (Object.prototype.hasOwnProperty.call(recipe, "grind")) {
      delete recipe.grind;
      migrated = true;
    }
    if (!recipe.grinderMode) {
      recipe.grinderMode = recipe.grinderId && recipe.grinderSetting !== null && recipe.grinderSetting !== undefined
        ? "registered" : "none";
      migrated = true;
    }
    if (!recipe.measurementStatus) {
      recipe.measurementStatus = recipe.measuredTds != null && recipe.measuredBeverageMass != null
        ? "measured" : "legacy_unverified";
      migrated = true;
    }
  });
  if (migrated) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); }
    catch (error) { console.warn("레시피 호환 데이터 저장을 완료하지 못했습니다:", error); }
  }
  return list;
}

function setStoredRecipes(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function getRecommendedRecipeName() {
  const selectEl = document.getElementById("origin-select");
  const originKey = selectEl ? selectEl.value : "geisha";
  const bean = (window.ORIGIN_DB || {})[originKey];
  const beanShort = bean ? bean.name.split(" (")[0] : "원두";
  const dripShort = (window.DRIPPERS[currentDripper] || { name: currentDripperLabel || "특수 드리퍼" }).name || currentDripperLabel;
  const dose = document.getElementById("dose-num").value;
  const temp = document.getElementById("temp-num").value;
  const now = new Date();
  return `${beanShort}_${dripShort}_${dose}g_${temp}℃ (${now.getMonth() + 1}/${now.getDate()})`;
}

function saveCurrentRecipe() {
  if (!wizardState.dripper || !wizardState.bean || !wizardState.recipe) {
    alert("드리퍼, 원두, 레시피를 먼저 선택해 주세요.");
    return;
  }
  // 레시피 저장 버튼을 누르는 순간 대기 중인 자동 저장을 먼저 완료해 평가의 최신값을 연결합니다.
  if (tastingAutoSaveTimer) { clearTimeout(tastingAutoSaveTimer); tastingAutoSaveTimer = null; }
  persistTastingEvaluation(false);
  const defaultName = getRecommendedRecipeName();
  const nameInput = prompt("저장할 레시피 이름을 확인해 주세요 (기본 추천 이름 자동 입력):", defaultName);
  if (!nameInput) return;

  const reviewInput = prompt("레시피 메모를 남기세요 (선택 사항):", latestTastingRecord?.sessionId === currentBrewSessionId ? "추출 후 관능평가 기록 포함" : "");
  const dose = parseFloat(document.getElementById("dose-num").value) || 30;
  const water = parseFloat(document.getElementById("water-num").value) || 480;
  const temp = parseFloat(document.getElementById("temp-num").value) || 95.0;
  const time = parseFloat(document.getElementById("time-num").value) || 210;
  const grinderMode = getSelectedGrinderMode();
  const grinderSelect = document.getElementById("grinder-select");
  const grinderDial = document.getElementById("grinder-dial-num");
  const generalLevel = getSelectedGeneralGrindLevel();
  const measuredTds = document.getElementById("measured-tds")?.value || "";
  const measuredBeverageMass = document.getElementById("measured-bev")?.value || "";
  const measuredMetrics = window.calculateMeasuredBrewMetrics
    ? window.calculateMeasuredBrewMetrics(dose, measuredTds, measuredBeverageMass)
    : { isMeasured: false };
  const selectEl = document.getElementById("origin-select");
  const originKey = selectEl ? selectEl.value : "geisha";

  const newEntry = {
    id: Date.now(),
    date: new Date().toLocaleString("ko-KR"),
    roleCode: isMaster ? "MASTER_오찬욱" : `GUEST_${currentUserName}`,
    author: currentUserName,
    name: nameInput.trim(),
    dripper: currentDripper,
    dripperLabel: currentDripperLabel,
    origin: originKey,
    recipeType: recipeType || "general",
    baristaPresetId: currentBaristaPresetId || "",
    flavorRatings: latestTastingRecord?.sessionId === currentBrewSessionId ? latestTastingRecord.flavorRatings : { sour:null, sweet:null, bitter:null },
    overallRating: latestTastingRecord?.sessionId === currentBrewSessionId ? latestTastingRecord.overallRating : currentOverallRating,
    rebrewIntent: latestTastingRecord?.sessionId === currentBrewSessionId ? latestTastingRecord.rebrewIntent : (document.getElementById("tasting-rebrew-intent")?.value || ""),
    personalNote: latestTastingRecord?.sessionId === currentBrewSessionId ? latestTastingRecord.personalNote : (document.getElementById("tasting-personal-note")?.value || ""),
    tastingRecordId: latestTastingRecord?.sessionId === currentBrewSessionId ? latestTastingRecord.id : "",
    dose: dose,
    grinderMode: grinderMode,
    grinderId: grinderMode === "registered" && grinderSelect ? grinderSelect.value : "",
    grinderSetting: grinderMode === "registered" && grinderDial && grinderDial.value !== "" ? Number(grinderDial.value) : null,
    generalGrindLevel: grinderMode === "general" ? generalLevel : null,
    measuredTds: measuredTds ? Number(measuredTds) : null,
    measuredBeverageMass: measuredBeverageMass ? Number(measuredBeverageMass) : null,
    measurementStatus: measuredMetrics.isMeasured ? "measured" : "unmeasured",
    temp: temp,
    time: time,
    water: water,
    ey: document.getElementById("ey-val").textContent,
    review: (reviewInput && reviewInput.trim()) ? reviewInput.trim() : "메모 없음"
  };

  const list = getStoredRecipes();
  list.unshift(newEntry);
  setStoredRecipes(list);
  renderRecipeBoard();
  downloadExcelFile("default");
}

function getVisibleRecipes() {
  const all = getStoredRecipes();
  return isMaster ? all : all.filter(r => r.author === currentUserName);
}

function downloadExcelFile(mode) {
  const targetList = getVisibleRecipes();
  if (targetList.length === 0) {
    alert("저장된 레시피 데이터가 없습니다.");
    return;
  }

  const headers = ["고유ID", "저장일시", "구분코드", "작성자", "레시피이름", "드리퍼", "산지키", "원두량(g)", "분쇄설정방식", "그라인더ID", "그라인더눈금", "일반분쇄도단계", "실측TDS(%)", "실측음료무게(g)", "물온도(℃)", "추출시간(초)", "물의양(g)", "수율정보", "맛한줄평", "측정상태", "레시피유형", "바리스타프리셋ID", "드리퍼표시명", "향미산미", "향미단맛", "향미쓴맛", "시음기록ID", "전체만족도(0.5단위)", "재추출의향", "개인메모"];
  const escapeCsv = val => `"${String(val ?? "").replace(/"/g, '""')}"`;

  const rows = targetList.map(r => [
    r.id, r.date, r.roleCode, r.author, r.name, r.dripper, r.origin,
    r.dose, r.grinderMode || "none", r.grinderId || "", r.grinderSetting ?? "", r.generalGrindLevel ?? "",
    r.measuredTds ?? "", r.measuredBeverageMass ?? "", r.temp, r.time, r.water, r.ey, r.review,
    r.measurementStatus || "legacy_unverified", r.recipeType || "general", r.baristaPresetId || "", r.dripperLabel || "",
    r.flavorRatings?.sour ?? "", r.flavorRatings?.sweet ?? "", r.flavorRatings?.bitter ?? "", r.tastingRecordId || "",
    r.overallRating ?? "", r.rebrewIntent || "", r.personalNote || ""
  ].map(escapeCsv).join(","));

  const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  let fileName = mode === "default"
    ? (isMaster ? "마스터_오찬욱_기본레시피.csv" : `개별링크_${currentUserName}_기본레시피.csv`)
    : (isMaster ? `마스터_오찬욱_백업레시피_${today}.csv` : `개별링크_${currentUserName}_백업레시피_${today}.csv`);

  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function triggerExcelUpload(mode) {
  uploadMode = mode;
  const fileInput = document.getElementById("excel-file-input");
  if (fileInput) { fileInput.value = ""; fileInput.click(); }
}

function parseCsvLine(line) {
  const result = [];
  let cur = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === "," && !inQuotes) {
      result.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  result.push(cur);
  return result;
}

function doseAndMeasuresAreValid(dose, tds, beverageMass) {
  if (tds === undefined || tds === null || tds === "" || beverageMass === undefined || beverageMass === null || beverageMass === "") return false;
  if (!Number.isFinite(Number(dose)) || Number(dose) <= 0) return false;
  if (!Number.isFinite(Number(tds)) || Number(tds) <= 0) return false;
  if (!Number.isFinite(Number(beverageMass)) || Number(beverageMass) <= 0) return false;
  return true;
}

function handleExcelFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const text = e.target.result.replace(/^\uFEFF/, "");
    const lines = text.split(/\r?\n/).filter(l => l.trim() !== "");
    if (lines.length < 2) {
      alert("유효한 레시피 데이터가 없는 파일입니다.");
      return;
    }

    const existing = getStoredRecipes();
    const existingIds = new Set(existing.map(x => String(x.id)));
    const headers = parseCsvLine(lines[0]).map(h => h.trim());
    const hasV16Headers = headers.includes("분쇄설정방식");
    const col = (cols, name, legacyIndex) => {
      const idx = headers.indexOf(name);
      return idx >= 0 ? cols[idx] : cols[legacyIndex];
    };
    let addedCount = 0;

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      if (cols.length < 10) continue;
      const grinderModeRaw = hasV16Headers ? col(cols, "분쇄설정방식", -1) : "none";
      const grinderMode = ["registered", "general", "none"].includes(grinderModeRaw) ? grinderModeRaw : "none";
      const legacyEy = col(cols, "수율정보", hasV16Headers ? 17 : 12) || "기록 없음";
      const importedTds = hasV16Headers ? col(cols, "실측TDS(%)", -1) : "";
      const importedBeverageMass = hasV16Headers ? col(cols, "실측음료무게(g)", -1) : "";
      const importedGrinderSetting = hasV16Headers ? col(cols, "그라인더눈금", -1) : "";
      const importedPresetId = hasV16Headers ? (col(cols, "바리스타프리셋ID", -1) || "") : "";
      const importedPreset = (window.BARISTA_PRESETS || []).find(p => p.id === importedPresetId);
      const rawDripper = col(cols, "드리퍼", 5) || "bluebottle";
      // 저장·CSV에는 드리퍼 객체가 아니라 안정적인 ID 문자열을 보관합니다.
      const importedDripper = (window.DRIPPERS || {})[rawDripper]
        ? rawDripper
        : (importedPreset && importedPreset.dripper === rawDripper ? rawDripper : "bluebottle");
      const importedTdsNum = Number(importedTds);
      const importedMassNum = Number(importedBeverageMass);
      const item = {
        id: Number(col(cols, "고유ID", 0)) || (Date.now() + i),
        date: col(cols, "저장일시", 1) || "",
        roleCode: col(cols, "구분코드", 2) || "",
        author: col(cols, "작성자", 3) || currentUserName,
        name: col(cols, "레시피이름", 4) || "복원된 레시피",
        dripper: importedDripper,
        dripperLabel: hasV16Headers ? (col(cols, "드리퍼표시명", -1) || (importedPreset && importedPreset.dripperModel) || "") : "",
        recipeType: hasV16Headers ? (col(cols, "레시피유형", -1) || (importedPresetId ? "barista" : "general")) : "general",
        baristaPresetId: importedPresetId,
        tastingRecordId: hasV16Headers ? (col(cols, "시음기록ID", -1) || "") : "",
        overallRating: (() => { const raw = headers.includes("전체만족도(0.5단위)") ? col(cols, "전체만족도(0.5단위)", -1) : ""; const n = Number(raw); return raw !== "" && Number.isFinite(n) ? Math.max(0.5, Math.min(5, Math.round(n * 2) / 2)) : null; })(),
        rebrewIntent: headers.includes("재추출의향") ? (col(cols, "재추출의향", -1) || "") : "",
        personalNote: headers.includes("개인메모") ? (col(cols, "개인메모", -1) || "") : "",
        flavorRatings: hasV16Headers ? {
          sour: (() => { const v = col(cols, "향미산미", -1); return v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null; })(),
          sweet: (() => { const v = col(cols, "향미단맛", -1); return v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null; })(),
          bitter: (() => { const v = col(cols, "향미쓴맛", -1); return v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null; })()
        } : { sour:null, sweet:null, bitter:null },
        origin: (window.ORIGIN_DB || {})[col(cols, "산지키", 6)] ? col(cols, "산지키", 6) : "geisha",
        dose: parseFloat(col(cols, "원두량(g)", 7)) || 30,
        grinderMode: grinderMode,
        grinderId: grinderMode === "registered" ? (col(cols, "그라인더ID", -1) || "") : "",
        grinderSetting: grinderMode === "registered" && importedGrinderSetting !== undefined && importedGrinderSetting !== "" && Number.isFinite(Number(importedGrinderSetting)) ? Number(importedGrinderSetting) : null,
        generalGrindLevel: grinderMode === "general" ? (Number(col(cols, "일반분쇄도단계", -1)) || 3) : null,
        measuredTds: hasV16Headers && importedTds !== undefined && importedTds !== "" && Number.isFinite(importedTdsNum) ? importedTdsNum : null,
        measuredBeverageMass: hasV16Headers && importedBeverageMass !== undefined && importedBeverageMass !== "" && Number.isFinite(importedMassNum) ? importedMassNum : null,
        measurementStatus: hasV16Headers
          ? (doseAndMeasuresAreValid(parseFloat(col(cols, "원두량(g)", 7)) || 30, importedTds, importedBeverageMass)
              ? "measured"
              : (col(cols, "측정상태", -1) === "legacy_unverified" ? "legacy_unverified" : "unmeasured"))
          : "legacy_unverified",
        temp: parseFloat(col(cols, "물온도(℃)", hasV16Headers ? 14 : 9)) || 95.0,
        time: parseFloat(col(cols, "추출시간(초)", hasV16Headers ? 15 : 10)) || 210,
        water: parseFloat(col(cols, "물의양(g)", hasV16Headers ? 16 : 11)) || 480,
        ey: hasV16Headers ? legacyEy : `v1.5 기록값(측정 여부 확인 불가): ${legacyEy}`,
        review: col(cols, "맛한줄평", hasV16Headers ? 18 : 13) || ""
      };

      if (!existingIds.has(String(item.id))) {
        existing.push(item);
        existingIds.add(String(item.id));
        addedCount++;
      }
    }

    existing.sort((a, b) => b.id - a.id);
    setStoredRecipes(existing);
    renderRecipeBoard();
    alert(`엑셀 파일에서 새로운 레시피 ${addedCount}건을 성공적으로 복원했습니다!`);
  };
  reader.readAsText(file, "utf-8");
}

function getRecipeMetricsSummary(recipe) {
  if (!recipe) return "실측값 없음";
  if (recipe.measurementStatus === "measured") return recipe.ey || "실측 데이터";
  if (recipe.measurementStatus === "legacy_unverified") return "v1.5 기록값 (측정 여부 확인 불가)";
  return "실측값 없음";
}

function getRecipeGrindSummary(recipe) {
  if (!recipe || recipe.grinderMode === "none" || !recipe.grinderMode) return "과거 버전: 분쇄 정보 없음";
  if (recipe.grinderMode === "registered") {
    const grinder = (window.COFFEE_GRINDERS || []).find(g => g.id === recipe.grinderId);
    return `${grinder ? grinder.name : (recipe.grinderId || "등록 모델")} · ${recipe.grinderSetting ?? "눈금 미기록"}`;
  }
  if (recipe.grinderMode === "general") return `${recipe.generalGrindLevel || 3}단계 · ${getGeneralGrindLabel(recipe.generalGrindLevel || 3)}`;
  return "설정 안 함";
}

function escapeRecipeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[ch]);
}

function renderRecipeBoard() {
  const visible = getVisibleRecipes();
  const grid = document.getElementById("recipe-grid");
  if (!grid) return;

  if (visible.length === 0) {
    grid.innerHTML = '<div style="color:#868e96; font-size:12px; padding:10px;">저장된 레시피가 없습니다. [⭐ 세팅 저장 (+엑셀)] 버튼을 눌러보세요!</div>';
    return;
  }

  grid.innerHTML = visible.map(r => `
    <div class="recipe-card">
      <div style="font-weight:900; font-size:13px; margin-bottom:3px; color:var(--text-main);">${escapeRecipeHtml(r.name)}</div>
      <div style="font-size:11px; color:#495057; line-height:1.4;">
        • <b>원두/물:</b> ${r.dose}g / ${r.water}g (${r.temp}°C)<br/>
        • <b>추출:</b> ${formatSecToKorean(r.time)} · ${getRecipeMetricsSummary(r)}<br/>
        • <b>드리퍼:</b> ${escapeRecipeHtml(r.dripperLabel || r.dripper || "")}<br/>
        • <b>분쇄:</b> ${escapeRecipeHtml(getRecipeGrindSummary(r))}<br/>
        • <b>전체 만족도:</b> ${renderStarRatingText(r.overallRating)}<br/>
        • <b>재추출 의향:</b> ${escapeRecipeHtml(({repeat:"다시 추출",adjust:"수정 후 추출",no:"재추출하지 않음"})[r.rebrewIntent] || "미기록")}<br/>
        • <b>메모:</b> <span style="color:#d9480f; font-weight:700;">"${escapeRecipeHtml(r.personalNote || r.review)}"</span>
      </div>
      <button class="excel-btn load1" style="width:100%; margin-top:6px; padding:4px;" onclick="loadRecipeToDial(${r.id})">🔄 이 세팅으로 불러오기</button>
    </div>
  `).join("");
}

function loadRecipeToDial(id) {
  const all = getStoredRecipes();
  const r = all.find(x => x.id === id);
  if (!r) return;

  const originSel = document.getElementById("origin-select");
  if (originSel && (window.ORIGIN_DB || {})[r.origin]) originSel.value = r.origin;
  selectDripper(r.dripper || "bluebottle");

  const doseInput = document.getElementById("dose-num");
  const doseSlider = document.getElementById("dose");
  const waterInput = document.getElementById("water-num");
  const waterSlider = document.getElementById("water");
  const tempInput = document.getElementById("temp-num");
  const tempSlider = document.getElementById("temp");
  const timeInput = document.getElementById("time-num");
  const timeSlider = document.getElementById("time");
  if (doseInput) { doseInput.value = r.dose; doseSlider.value = r.dose; }
  if (waterInput) { waterInput.value = r.water; waterSlider.value = r.water; }
  if (tempInput) { tempInput.value = r.temp; tempSlider.value = r.temp; }
  if (timeInput) { timeInput.value = r.time; timeSlider.value = r.time; }

  // v1.6 분쇄 설정 복원. v1.5의 grind 값은 저항지수이므로 실제 분쇄 눈금으로 해석하지 않는다.
  // none/미기록 레거시 값은 UI에서 제거했으므로, 불러올 때는 중간 단계로 시작하되 과거 원본 데이터는 덮어쓰지 않습니다.
  const restoredMode = r.grinderId && r.grinderSetting !== null && r.grinderSetting !== undefined
    ? "registered" : "general";
  const modeRadio = document.querySelector(`input[name="grinder-mode"][value="${restoredMode}"]`);
  if (modeRadio) modeRadio.checked = true;
  if (restoredMode === "registered") {
    const grinderSelect = document.getElementById("grinder-select");
    if (grinderSelect && r.grinderId && Array.from(grinderSelect.options).some(o => o.value === r.grinderId)) {
      grinderSelect.value = r.grinderId;
      onGrinderChange();
      const dialInput = document.getElementById("grinder-dial-num");
      if (dialInput && r.grinderSetting !== null && r.grinderSetting !== undefined && r.grinderSetting !== "") dialInput.value = r.grinderSetting;
    }
  } else if (restoredMode === "general") {
    const level = Number(r.generalGrindLevel) || 3;
    const levelRadio = document.querySelector(`input[name="general-grind-level"][value="${level}"]`);
    if (levelRadio) levelRadio.checked = true;
  }
  onGrinderModeChange();

  currentDripperLabel = r.dripperLabel || ((window.DRIPPERS || {})[r.dripper]?.fullName) || currentDripperLabel;
  currentBaristaPresetId = null;
  currentBaristaPreset = null;
  recipeType = currentBaristaPreset ? "barista" : "general";
  wizardState = { dripper: true, bean: true, recipe: true, grind: true };
  const recipeRadio = document.querySelector(`input[name="recipe-type"][value="${recipeType}"]`);
  if (recipeRadio) recipeRadio.checked = true;
  const presetSelect = document.getElementById("preset-select");
  if (presetSelect) presetSelect.value = r.baristaPresetId || "common_mode";
  if (r.baristaPresetId) {
    recipeType = "barista";
    const baristaOptions = document.getElementById("barista-recipe-options");
    const generalOptions = document.getElementById("general-recipe-options");
    if (baristaOptions) baristaOptions.hidden = false;
    if (generalOptions) generalOptions.hidden = true;
    onPresetSelectChange();
  } else {
    clearBaristaPreset(false);
    recipeType = "general";
    const go=document.getElementById("general-recipe-options");if(go)go.hidden=false;
    const bo=document.getElementById("barista-recipe-options");if(bo)bo.hidden=true;
  }
  ["sour","sweet","bitter"].forEach(key => { const el=document.getElementById(`flavor-${key}`); if(el){ const v=r.flavorRatings?.[key]; el.value=v ?? 2.5; el.dataset.rated=(v !== null && v !== undefined && v !== "") ? "true" : "false"; } });
  currentOverallRating = r.overallRating !== null && r.overallRating !== undefined && r.overallRating !== "" && Number.isFinite(Number(r.overallRating)) ? Number(r.overallRating) : null;
  const rebrewEl=document.getElementById("tasting-rebrew-intent"); if(rebrewEl) rebrewEl.value=r.rebrewIntent || "";
  const noteEl=document.getElementById("tasting-personal-note"); if(noteEl) noteEl.value=r.personalNote || r.review || "";
  renderOverallRatingStars();
  refreshWizard();
  updateFlavorChart();
  const tdsInput = document.getElementById("measured-tds");
  const bevInput = document.getElementById("measured-bev");
  if (tdsInput) tdsInput.value = r.measuredTds ?? "";
  if (bevInput) bevInput.value = r.measuredBeverageMass ?? "";
  updateDial();
  const details = document.getElementById("recipe-board-details");
  if (details) details.open = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}


// ============================================================================
// v1.652 도움말 · 단계 선택 · 인증 세션
// ============================================================================
const MASTER_SESSION_KEY = "brewmap_master_session_v1651";
const MASTER_SESSION_DAYS = 10;
function initMasterSession() {
  try {
    const session = JSON.parse(localStorage.getItem(MASTER_SESSION_KEY) || "null");
    if (session && session.expiresAt > Date.now() && session.role === "master") {
      completeLogin(true, "오찬욱", false);
      return;
    }
    if (session) localStorage.removeItem(MASTER_SESSION_KEY);
  } catch (error) { console.warn("마스터 세션을 읽지 못했습니다.", error); }
}
function saveMasterSession() {
  const expiresAt = Date.now() + MASTER_SESSION_DAYS * 24 * 60 * 60 * 1000;
  try { localStorage.setItem(MASTER_SESSION_KEY, JSON.stringify({ role: "master", expiresAt })); }
  catch (error) { console.warn("마스터 세션 저장 실패:", error); }
}
function showInlineHelp(topic) {
  const help = {
    dripper: ["드리퍼 선택", "사용 중인 드리퍼를 먼저 선택합니다. 바리스타 프리셋을 고르면 원본 레시피에 지정된 드리퍼가 자동 선택되고 변경이 잠깁니다."],
    bean: ["원두 선택", "사용할 원두 산지·품종 정보를 선택합니다. 원두 정보는 일반 모드의 시작 세팅과 추천 가이드에 반영됩니다."],
    recipe: ["레시피 유형", "일반 모드는 원두량과 공통 추출 모드를 직접 선택합니다. 특별 바리스타 모드는 원본 프리셋의 드리퍼·도징·물량·온도·목표 시간과 푸어 일정을 적용하고 지정값을 잠급니다."],
    dose: ["원두량", "추출에 사용할 건조 원두의 질량입니다. 바리스타 프리셋에서 지정한 원두량은 원본 재현을 위해 잠깁니다."],
    water: ["물 투입량", "드리퍼 또는 서버에 붓는 총 물의 질량입니다. 추출된 완성 음료량과 같지 않습니다. 바이패스에서는 드리퍼 투입량과 별도 온수량을 구분합니다."],
    temp: ["추출 수온", "추출에 사용하는 물의 목표 온도입니다. 실제 주전자 출수 온도 및 추출 중 온도와 차이가 있을 수 있습니다."],
    time: ["목표 추출 시간", "레시피의 목표 종료 시간입니다. 분쇄도·원두·물줄기·교반과 드리퍼 상태에 따라 실제 배수 시간은 달라집니다."],
    grind: ["분쇄 설정", "등록 모델은 해당 그라인더 고유 눈금만 표시합니다. 일반 5단계는 모델을 모를 때 사용하는 정성적 분류이며 마이크론이나 다른 그라인더 눈금으로 환산하지 않습니다."],
    metrics: ["예상·실측 수율(EY)과 농도(TDS)", "예상값은 수온·시간·물:원두 비율·일반 분쇄 단계와 단순 가정을 반영한 화면용 휴리스틱입니다. 실험으로 보정되거나 검증된 예측 모델이 아니며 표시한 오차 범위도 통계적 신뢰구간이 아닙니다. 실제 결과와 다를 수 있습니다. 실측 EY는 굴절계 TDS와 실제 완성 음료 무게가 모두 있어야 계산됩니다."],
    flavor: ["관능평가", "산미·단맛·쓴맛은 실제로 느낀 강도를 0~5 범위로 기록합니다. 전체 커피 만족도는 별도로 0.5점 단위, 최대 5점으로 평가하며 재추출 의향과 개인 메모도 저장할 수 있습니다."],
    extraction: ["시간별 성분 용출 개념도", "시간축에 따른 성분 용출 경향을 설명하는 개념 곡선입니다. 특정 원두의 실측 화학 분석 데이터가 아니며 목표 시간선은 현재 레시피의 목표 시간입니다."],
    sca: ["SCA 골든컵 차트", "참고 목표 영역은 TDS 1.15~1.35%, EY 18~22%로 표시합니다. 개인 취향이나 모든 추출 방식에 대한 절대적 품질 판정은 아닙니다."],
    profile: ["추출 프로파일 통계", "현재 설정한 원두량·총 물 투입량·비율·수온·목표 시간·푸어 단계 수를 요약합니다. 실측 추출 성능 통계와는 구분합니다."],
    pour: ["설정된 물 붓기 일정", "일반 모드는 앱의 안내 타이밍 규칙을, 바리스타 모드는 저장된 프리셋의 물 붓기 일정을 표시합니다. 실제 주전자 출수량을 센서로 측정한 기록은 아닙니다."],
    ratio: ["추출 비율 비교", "현재 총 물 투입량과 원두량의 비율을 1:12, 1:14, 1:16, 1:18 참고 비율과 비교합니다. 비율만으로 맛이나 수율을 예측하지 않습니다."]
  };
  const item = help[topic] || ["도움말", "관련 기능의 설명을 준비 중입니다."];
  const title = document.getElementById("inlineHelpTitle");
  const text = document.getElementById("inlineHelpText");
  const modal = document.getElementById("inlineHelpModal");
  if (title) title.textContent = item[0];
  if (text) text.textContent = item[1];
  if (modal) modal.classList.add("open");
}
function closeInlineHelp() { const modal=document.getElementById("inlineHelpModal"); if(modal)modal.classList.remove("open"); }
function getFlavorRatings() {
  const read = key => {
    const el=document.getElementById(`flavor-${key}`);
    if (!el || el.dataset.rated !== "true") return null;
    const n=Number(el.value);
    return Number.isFinite(n) ? Math.max(0, Math.min(5, n)) : null;
  };
  return { sour: read("sour"), sweet: read("sweet"), bitter: read("bitter") };
}
function setFlavorRatingTouched(key) {
  const el=document.getElementById(`flavor-${key}`);
  if (el) el.dataset.rated="true";
  updateFlavorChart();
  scheduleTastingAutoSave();
}
function renderOverallRatingStars() {
  const container=document.getElementById("overall-rating-stars");
  if (!container) return;
  const value = currentOverallRating === null ? 0 : Math.max(0, Math.min(5, Number(currentOverallRating) || 0));
  container.innerHTML = Array.from({length:5},(_,idx)=>{
    const star=idx+1, halfValue=star-.5, fullValue=star;
    const fillFraction=Math.max(0,Math.min(1,value-idx));
    return `<span class="rating-star-wrap"><span class="rating-star-graphic">${renderRatingStarSvg(fillFraction)}</span><button type="button" class="rating-star-half left" onclick="setOverallRating(${halfValue})" aria-label="전체 만족도 ${halfValue}점 선택" title="${halfValue}점"></button><button type="button" class="rating-star-half right" onclick="setOverallRating(${fullValue})" aria-label="전체 만족도 ${fullValue}점 선택" title="${fullValue}점"></button></span>`;
  }).join("") + `<span class="rating-star-caption">${currentOverallRating === null ? "미평가" : `${Number(currentOverallRating).toFixed(1)} / 5.0`}</span>`;
}
function setOverallRating(value, shouldAutoSave = true) {
  const n=Number(value);
  if (!Number.isFinite(n) || n < 0.5 || n > 5 || Math.round(n*2)!==n*2) return;
  currentOverallRating=n;
  renderOverallRatingStars();
  if (shouldAutoSave) scheduleTastingAutoSave();
}
function updateFlavorChart() {
  const values = ["sour","sweet","bitter"].map(key => {
    const el=document.getElementById(`flavor-${key}`); const value=el?Number(el.value):0;
    const rated=!!el && el.dataset.rated === "true";
    const output=document.getElementById(`flavor-${key}-value`);
    if(output) output.textContent=rated?`${value.toFixed(1)} / 5`:"미평가";
    return { value, rated };
  });
  const canvas=document.getElementById("flavorChart"); if(!canvas)return;
  const ctx=canvas.getContext("2d"), W=canvas.width, H=canvas.height;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle="#fff"; ctx.fillRect(0,0,W,H);
  const keys=["sour","sweet","bitter"], labels=["산미","단맛","쓴맛"], colors=["#d69a49","#659a73","#7588a8"];
  const dose=Number(document.getElementById("dose-num")?.value)||30;
  const water=Number(document.getElementById("water-num")?.value)||480;
  const time=Number(document.getElementById("time-num")?.value)||210;
  const predicted=getEstimatedFlavorProfile(dose,water,time);
  const predictedValues=[predicted.sour,predicted.sweet,predicted.bitter];
  const left=55,right=92,barW=W-left-right,rowTop=30,rowH=60,barH=13;
  ctx.font="bold 13px sans-serif"; ctx.textBaseline="middle";
  labels.forEach((label,i)=>{
    const y=rowTop+i*rowH;
    ctx.fillStyle="#405547"; ctx.textAlign="right"; ctx.fillText(label,left-9,y+14);
    // 예상값
    ctx.fillStyle="#eaf0eb"; ctx.beginPath(); ctx.roundRect(left,y,barW,barH,6); ctx.fill();
    ctx.fillStyle=colors[i]; ctx.globalAlpha=.55; ctx.beginPath(); ctx.roundRect(left,y,barW*Math.max(0,Math.min(5,predictedValues[i]))/5,barH,6); ctx.fill(); ctx.globalAlpha=1;
    ctx.fillStyle="#718076"; ctx.textAlign="left"; ctx.font="10px sans-serif"; ctx.fillText(`예상 ${predictedValues[i].toFixed(1)}`,left+barW+5,y+7);
    // 실제 평가
    const actualY=y+22;
    ctx.fillStyle="#edf2ed"; ctx.beginPath(); ctx.roundRect(left,actualY,barW,barH,6); ctx.fill();
    if(values[i].rated){ctx.fillStyle=colors[i];ctx.beginPath();ctx.roundRect(left,actualY,barW*Math.max(0,Math.min(5,values[i].value))/5,barH,6);ctx.fill();}
    ctx.fillStyle="#526456"; ctx.textAlign="left"; ctx.font="10px sans-serif"; ctx.fillText(values[i].rated?`실제 ${values[i].value.toFixed(1)}`:"실제 미평가",left+barW+5,actualY+7);
    ctx.font="bold 13px sans-serif";
  });
  ctx.fillStyle="#66766a"; ctx.font="10px sans-serif"; ctx.textAlign="left";
  ctx.fillText("예상값은 참고용 추정치이며 실제 맛과 다를 수 있습니다.",left,H-7);
}

// ============================================================================
// 9. 3D 추출 개념 애니메이션 & 음성·ASMR 사운드 엔진
// ============================================================================
let audioCtx = null;
let pourNoiseNode = null;
let pourGainNode = null;
let isPourSoundPlaying = false;
let soundEnabled = true;

let brewRunning = false;
let brewElapsed = -10.0;
let brewLastTick = 0;

let brewAnimReq = null;
let pourStages = [];
let lastBeepSec = null;

function initAudio() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) audioCtx = new AudioContext();
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  if (audioCtx && !pourGainNode) {
    setupPouringSoundEngine();
  }
}

function setupPouringSoundEngine() {
  const bufferSize = audioCtx.sampleRate * 2;
  const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const output = noiseBuffer.getChannelData(0);
  let lastOut = 0.0;
  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;
    output[i] = (lastOut + (0.04 * white)) / 1.04;
    lastOut = output[i];
    output[i] *= 3.0;
  }

  pourNoiseNode = audioCtx.createBufferSource();
  pourNoiseNode.buffer = noiseBuffer;
  pourNoiseNode.loop = true;

  const bandpass = audioCtx.createBiquadFilter();
  bandpass.type = "bandpass";
  bandpass.frequency.value = 720;
  bandpass.Q.value = 1.6;

  const lfo = audioCtx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 5.5;
  const lfoGain = audioCtx.createGain();
  lfoGain.gain.value = 220;
  lfo.connect(bandpass.frequency);
  lfo.start();

  pourGainNode = audioCtx.createGain();
  pourGainNode.gain.value = 0.0001;

  pourNoiseNode.connect(bandpass);
  bandpass.connect(pourGainNode);
  pourGainNode.connect(audioCtx.destination);
  pourNoiseNode.start();
}

function setPouringWaterSound(active) {
  if (!audioCtx || !pourGainNode) return;
  const shouldPlay = active && soundEnabled && brewRunning;
  if (shouldPlay && !isPourSoundPlaying) {
    isPourSoundPlaying = true;
    pourGainNode.gain.setTargetAtTime(0.085, audioCtx.currentTime, 0.15);
  } else if (!shouldPlay && isPourSoundPlaying) {
    isPourSoundPlaying = false;
    pourGainNode.gain.setTargetAtTime(0.0001, audioCtx.currentTime, 0.1);
  }
}

function playStageAlarm(alarmType, stageIndex = 1) {
  if (!soundEnabled) return;
  initAudio();
  if (!audioCtx) return;

  const now = audioCtx.currentTime;

  if (alarmType === "countdown") {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    gain.gain.setValueAtTime(0.16, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.14);
  } else if (alarmType === "prep_start") {
    [440, 554.37].forEach((f, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(f, now + idx * 0.14);
      gain.gain.setValueAtTime(0.2, now + idx * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.14 + 0.35);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + idx * 0.14);
      osc.stop(now + idx * 0.14 + 0.38);
    });
  } else if (alarmType === "pour_start") {
    const pitchShift = Math.pow(1.06, stageIndex - 1);
    const notes = [523.25 * pitchShift, 659.25 * pitchShift, 783.99 * pitchShift];
    notes.forEach((f, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(f, now + idx * 0.11);
      gain.gain.setValueAtTime(0.24, now + idx * 0.11);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.11 + 0.38);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + idx * 0.11);
      osc.stop(now + idx * 0.11 + 0.4);
    });
  } else if (alarmType === "wait_start") {
    const notes = [783.99, 523.25];
    notes.forEach((f, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(f, now + idx * 0.16);
      gain.gain.setValueAtTime(0.22, now + idx * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.16 + 0.42);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + idx * 0.16);
      osc.stop(now + idx * 0.16 + 0.45);
    });
  } else if (alarmType === "finish") {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(f, now + idx * 0.13);
      gain.gain.setValueAtTime(0.25, now + idx * 0.13);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.13 + 0.55);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + idx * 0.13);
      osc.stop(now + idx * 0.13 + 0.58);
    });
  }
}

function speakGuide(text, totalTimeSec, alarmType, stageIndex = 1) {
  if (!soundEnabled || !text) return;
  playStageAlarm(alarmType, stageIndex);
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "ko-KR";
    utter.rate = totalTimeSec <= 120 ? 1.16 : (totalTimeSec <= 180 ? 1.08 : 1.02);
    window.speechSynthesis.speak(utter);
  }
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  const btn = document.getElementById("btn-sound-toggle");
  if (btn) btn.textContent = soundEnabled ? "🔊 소리 켜짐" : "🔇 소리 꺼짐";
  if (!soundEnabled) {
    setPouringWaterSound(false);
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }
}

function buildPourStages() {
  const dose = parseFloat(document.getElementById("dose-num").value) || 30;
  const water = parseFloat(document.getElementById("water-num").value) || 480;
  const totalTime = parseFloat(document.getElementById("time-num").value) || 210;

  if (currentBaristaPreset && Array.isArray(currentBaristaPreset.pourSchedule) && currentBaristaPreset.pourSchedule.length) {
    const raw = currentBaristaPreset.pourSchedule;
    const scale = dose / currentBaristaPreset.coffeeDose;
    const stages = raw.map((step, idx) => {
      const prev = idx === 0 ? 0 : raw[idx - 1].cumulativeWaterG;
      const cumulative = Math.round(step.cumulativeWaterG * scale);
      const start = Number(step.startTimeSec ?? step.timeSec ?? 0);
      const pourEnd = Number(step.endTimeSec ?? start + 12);
      const end = Number(step.waitUntilSec ?? pourEnd);
      const stageName = step.phase && /bloom/i.test(step.phase) ? "뜸들이기" : `${idx}차 푸어`;
      return {
        id: idx === 0 ? "bloom" : `barista-pour-${idx}`,
        name: `${idx+1}) ${stageName}`,
        startSec: start, pourEndSec: Math.max(start+1,pourEnd), endSec: Math.max(pourEnd,end),
        startWater: Math.round(prev*scale), targetWater: cumulative,
        addWater: cumulative - Math.round(prev*scale),
        voiceStart: `${stageName}입니다. ${Number(step.pourAmountG ?? (step.cumulativeWaterG-prev)).toFixed(0)}g을 추가해 누적 ${cumulative}g까지 부으세요. ${step.instruction || ""}`,
        voiceMid: "물을 멈추고 다음 단계까지 기다리세요.", spokenStart:false, spokenMid:false
      };
    });
    const scheduleTarget = stages[stages.length - 1]?.targetWater || water;
    if (scheduleTarget < water) stages[stages.length - 1].targetWater = water;
    stages.unshift({id:"prep",name:"0. 추출 준비 (10초 카운트다운)",startSec:-10,pourEndSec:0,endSec:0,startWater:0,targetWater:0,addWater:0,voiceStart:`${currentUserName} 바리스타님, 저울을 확인하세요. 10초 후 원본 프리셋 일정으로 시작합니다.`,voiceMid:null,spokenStart:false,spokenMid:false});
    stages.finishVoice = `바리스타 원본 푸어 일정이 완료되었습니다. 드리퍼를 치워주세요.`;
    stages.finishSpoken = false;
    pourStages = stages;
    const badgeEl=document.getElementById("modal-bypass-badge"); if(badgeEl)badgeEl.textContent="[바리스타 원본 푸어 일정]";
    const listEl=document.getElementById("schedule-list");
    if(listEl) listEl.innerHTML=stages.slice(1).map((stage,idx)=>`<div class="schedule-item" id="sched-row-${idx+1}"><div style="font-weight:800;color:var(--theme-dark);">${formatMMSS(stage.startSec)} ~ ${formatMMSS(stage.endSec)}</div><div>${stage.name} <span style="font-size:11px;color:#868e96;">(+${stage.addWater}g)</span></div><div style="text-align:right;font-weight:900;">누적 ${stage.targetWater}g</div></div>`).join("");
    return;
  }

  let w1 = Math.min(Math.round(water * 0.24), Math.round(dose * 2.2));
  let w2 = Math.round(water * 0.45);
  let w3 = Math.round(water * 0.74);
  let w4 = water;

  if (currentModeKey === "bypass") {
    const bRes = window.calculateBrewModeWater(dose, "bypass");
    w4 = bRes.dripperInputWaterG;
    w1 = Math.min(Math.round(w4 * 0.3), Math.round(dose * 2.2));
    w2 = Math.round(w4 * 0.6);
    w3 = Math.round(w4 * 0.85);
  }

  const add1 = w1;
  const add2 = w2 - w1;
  const add3 = w3 - w2;
  const add4 = w4 - w3;

  const t1 = 0;
  const t2 = Math.min(40, Math.round(totalTime * 0.20));
  const t3 = Math.round(totalTime * 0.44);
  const t4 = Math.round(totalTime * 0.68);

  const p1 = Math.max(8, Math.round((t2 - t1) * 0.45));
  const p2 = Math.max(10, Math.round((t3 - t2) * 0.52));
  const p3 = Math.max(10, Math.round((t4 - t3) * 0.52));
  const p4 = Math.max(10, Math.round((totalTime - t4) * 0.45));

  const bypassNoticeText = currentModeKey === "bypass"
    ? ` (※ 바이패스 모드: 드리퍼 추출 ${w4}g 완료 후 서버에 온수 ${Math.round(water - w4)}g 추가)`
    : "";

  const msg = {
    prep: `${currentUserName} 바리스타님, 저울을 확인하세요. 10초 후 추출을 시작합니다.`,
    s1_start: `뜸들이기입니다. 중심부터 물 ${add1}그램을 ${p1}초 안에 부으세요.`,
    s1_mid: `물 붓기를 멈추고 1차 추출까지 기다리세요.`,
    s2_start: `1차 추출입니다. 물 ${add2}그램을 추가해 저울 기준 ${w2}그램까지 부으세요.`,
    s2_mid: `물 붓기를 멈추고 2차 추출까지 기다리세요.`,
    s3_start: `2차 추출입니다. 물 ${add3}그램을 추가해 저울 기준 ${w3}그램까지 부으세요.`,
    s3_mid: `물 붓기를 멈추고 마지막 추출까지 기다리세요.`,
    s4_start: `마지막 추출입니다. 남은 물 ${add4}그램을 부어 드리퍼 기준 ${w4}그램을 맞춰주세요.`,
    s4_mid: `물 붓기를 멈추고 주전자를 내려놓으세요.`,
    finish: `추출이 모두 끝났습니다. 이제 드리퍼를 치워주세요.${bypassNoticeText} 정성껏 내린 커피가 완성되었습니다.`
  };

  pourStages = [
    {
      id: "prep",
      name: "0. 추출 준비 (10초 카운트다운)",
      startSec: -10,
      pourEndSec: 0,
      endSec: 0,
      startWater: 0,
      targetWater: 0,
      addWater: 0,
      voiceStart: msg.prep,
      voiceMid: null,
      spokenStart: false,
      spokenMid: false
    },
    {
      id: "bloom",
      name: "1) 뜸들이기",
      startSec: t1,
      pourEndSec: t1 + p1,
      endSec: t2,
      startWater: 0,
      targetWater: w1,
      addWater: add1,
      voiceStart: msg.s1_start,
      voiceMid: msg.s1_mid,
      spokenStart: false,
      spokenMid: false
    },
    {
      id: "pour1",
      name: "2) 1차 추출",
      startSec: t2,
      pourEndSec: t2 + p2,
      endSec: t3,
      startWater: w1,
      targetWater: w2,
      addWater: add2,
      voiceStart: msg.s2_start,
      voiceMid: msg.s2_mid,
      spokenStart: false,
      spokenMid: false
    },
    {
      id: "pour2",
      name: "3) 2차 추출",
      startSec: t3,
      pourEndSec: t3 + p3,
      endSec: t4,
      startWater: w2,
      targetWater: w3,
      addWater: add3,
      voiceStart: msg.s3_start,
      voiceMid: msg.s3_mid,
      spokenStart: false,
      spokenMid: false
    },
    {
      id: "pour3",
      name: "4) 마지막 추출",
      startSec: t4,
      pourEndSec: t4 + p4,
      endSec: totalTime,
      startWater: w3,
      targetWater: w4,
      addWater: add4,
      voiceStart: msg.s4_start,
      voiceMid: msg.s4_mid,
      spokenStart: false,
      spokenMid: false
    }
  ];

  pourStages.finishVoice = msg.finish;
  pourStages.finishSpoken = false;

  const badgeEl = document.getElementById("modal-bypass-badge");
  if (badgeEl) badgeEl.textContent = currentModeKey === "bypass" ? "[바이패스: 서버 온수 추가 대기]" : "";

  const listEl = document.getElementById("schedule-list");
  if (!listEl) return;
  listEl.innerHTML = pourStages.slice(1).map((s, idx) => `
    <div class="schedule-item" id="sched-row-${idx + 1}">
      <div style="font-weight:800; color:var(--theme-dark);">${formatMMSS(s.startSec)} ~ ${formatMMSS(s.endSec)}</div>
      <div>${s.name} <span style="font-size:11px; color:#868e96;">(+${s.addWater}g)</span></div>
      <div style="text-align:right; font-weight:900;">누적 ${s.targetWater}g</div>
    </div>
  `).join("");
}

function openBrewModal() {
  if (!wizardState.dripper || !wizardState.bean || !wizardState.recipe) {
    alert("먼저 드리퍼, 원두, 레시피를 순서대로 선택해 주세요.");
    return;
  }
  const d = (window.DRIPPERS || {})[currentDripper] || { fullName: currentDripperLabel || "특수 드리퍼" };
  const dose = parseFloat(document.getElementById("dose-num").value) || 30;
  const temp = parseFloat(document.getElementById("temp-num").value) || 95.0;
  const time = parseFloat(document.getElementById("time-num").value) || 210;
  const water = parseFloat(document.getElementById("water-num").value) || 480;

  const modalTitle = document.getElementById("modal-title");
  const modalSub = document.getElementById("modal-subtitle");
  if (modalTitle) modalTitle.textContent = `BrewMap 3D 브루잉 가이드 (${currentDripperLabel || d.fullName})`;
  const specialNote = currentBaristaPreset?.requiresSpecialEquipment ? " · 특수 장비 전용 프리셋: 3D 드리퍼 그림은 추출 순서 안내용 개념 표현입니다." : "";
  if (modalSub) modalSub.textContent = `원두 ${dose}g · 물 투입량 ${water}g · ${temp.toFixed(1)}°C · 목표 시간 ${formatSecToKorean(time)}${specialNote}`;

  buildPourStages();
  resetBrewTimer();
  const modal = document.getElementById("brewModal");
  if (modal) modal.classList.add("open");
}

function closeBrewModal() {
  // 모달을 닫는 순간 입력 디바운스가 남아 있으면 먼저 플러시하여 평가 누락을 방지합니다.
  if (tastingAutoSaveTimer) { clearTimeout(tastingAutoSaveTimer); tastingAutoSaveTimer = null; }
  persistTastingEvaluation(false);
  if (brewElapsed >= (parseFloat(document.getElementById("time-num")?.value) || 210) && !latestTastingRecord && !tastingSkipped) {
    const proceed = window.confirm("관능평가를 아직 저장하지 않았습니다. 추출 평가 없이 닫을까요?");
    if (!proceed) return;
  }
  brewRunning = false;
  setPouringWaterSound(false);
  if (brewAnimReq) cancelAnimationFrame(brewAnimReq);
  if (brewOutroAnimReq) cancelAnimationFrame(brewOutroAnimReq);
  brewOutroAnimReq = null;
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  const modal = document.getElementById("brewModal");
  if (modal) modal.classList.remove("open");
}

function syncStartButtonsText(label) {
  const topBtn = document.getElementById("btn-brew-top");
  const botBtn = document.getElementById("btn-brew-bottom");
  if (topBtn) topBtn.textContent = `${label} (상단)`;
  if (botBtn) botBtn.textContent = `${label} (하단)`;
}

function resetBrewTimer() {
  beginNewBrewSession();
  brewCompletionPromptShown = false;
  brewRunning = false;
  brewElapsed = -10.0;
  lastBeepSec = null;
  setPouringWaterSound(false);
  if (brewAnimReq) cancelAnimationFrame(brewAnimReq);
  if (brewOutroAnimReq) cancelAnimationFrame(brewOutroAnimReq);
  brewOutroAnimReq = null;
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();

  pourStages.forEach(s => { s.spokenStart = false; s.spokenMid = false; });
  pourStages.finishSpoken = false;

  syncStartButtonsText("▶ 추출 시작");
  const banner = document.getElementById("stage-banner");
  if (banner) banner.className = "stage-alert-banner";
  const bTitle = document.getElementById("stage-banner-title");
  const bDesc = document.getElementById("stage-banner-desc");
  if (bTitle) bTitle.textContent = "준비 완료: [▶ 추출 시작]을 눌러주세요";
  if (bDesc) bDesc.textContent = "10초 준비 카운트다운 후 물 붓기와 멈춤 대기를 안내합니다.";

  for (let i = 1; i <= Math.max(4, pourStages.length - 1); i++) {
    const row = document.getElementById("sched-row-" + i);
    if (row) row.className = "schedule-item";
  }

  draw3DScene(-10, "prep", 0, 0, "추출 대기 중 (-10초 준비)", "상단 또는 하단 [추출 시작]을 누르세요");
}

function toggleBrewTimer() {
  initAudio();
  const totalTime = parseFloat(document.getElementById("time-num").value) || 210;
  if (brewElapsed >= totalTime) {
    resetBrewTimer();
  }

  brewRunning = !brewRunning;
  if (brewRunning) {
    syncStartButtonsText("⏸ 일시정지");
    brewLastTick = performance.now();
    brewLoop(brewLastTick);
  } else {
    setPouringWaterSound(false);
    syncStartButtonsText("▶ 이어서 추출");
  }
}

function brewLoop(now) {
  if (!brewRunning) return;
  const dt = (now - brewLastTick) / 1000;
  brewLastTick = now;
  brewElapsed += dt;

  const totalTime = parseFloat(document.getElementById("time-num").value) || 210;
  const water = parseFloat(document.getElementById("water-num").value) || 480;
  let targetRefWater = water;
  if (currentModeKey === "bypass") {
    const bRes = window.calculateBrewModeWater(parseFloat(document.getElementById("dose-num").value) || 30, "bypass");
    targetRefWater = bRes.dripperInputWaterG;
  }

  if (brewElapsed >= totalTime) {
    brewElapsed = totalTime;
    brewRunning = false;
    setPouringWaterSound(false);
    syncStartButtonsText("↺ 다시 추출");
    if (!brewCompletionPromptShown) {
      brewCompletionPromptShown = true;
      startBrewOutro(targetRefWater, totalTime);
    }
  }

  if (brewElapsed >= -3.2 && brewElapsed < -0.1) {
    const secInt = Math.ceil(brewElapsed);
    if (secInt !== lastBeepSec) {
      lastBeepSec = secInt;
      playStageAlarm("countdown");
    }
  }

  let activeIdx = 0;
  for (let i = 0; i < pourStages.length; i++) {
    if (brewElapsed >= pourStages[i].startSec) activeIdx = i;
  }
  const curStage = pourStages[activeIdx];

  if (!curStage.spokenStart && brewElapsed < totalTime) {
    curStage.spokenStart = true;
    const alarmKind = activeIdx === 0 ? "prep_start" : "pour_start";
    speakGuide(curStage.voiceStart, totalTime, alarmKind, activeIdx);
  }

  if (activeIdx >= 1 && !curStage.spokenMid && brewElapsed >= curStage.pourEndSec && brewElapsed < curStage.endSec) {
    curStage.spokenMid = true;
    speakGuide(curStage.voiceMid, totalTime, "wait_start", activeIdx);
  }

  let phaseMode = "prep";
  let currentWater = 0;
  let phaseProgress = 0;
  let hudStageTitle = "";
  let hudSubText = "";
  const bannerEl = document.getElementById("stage-banner");

  if (brewElapsed < 0) {
    phaseMode = "prep";
    currentWater = 0;
    phaseProgress = (10 + brewElapsed) / 10;
    setPouringWaterSound(false);
    if (bannerEl) bannerEl.className = "stage-alert-banner";
    hudStageTitle = `⏳ 추출 준비 (${Math.ceil(Math.abs(brewElapsed))}초 전)`;
    hudSubText = "저울 영점 확인 및 주전자를 준비하세요";
    document.getElementById("stage-banner-title").textContent = hudStageTitle;
    document.getElementById("stage-banner-desc").textContent = curStage.voiceStart;
  } else if (brewElapsed >= totalTime) {
    phaseMode = "done";
    currentWater = targetRefWater;
    phaseProgress = 1;
    setPouringWaterSound(false);
    if (bannerEl) bannerEl.className = "stage-alert-banner";
    hudStageTitle = "🎉 추출 완료!";
    hudSubText = pourStages.finishVoice;
    if (!pourStages.finishSpoken) {
      pourStages.finishSpoken = true;
      speakGuide(pourStages.finishVoice, totalTime, "finish", 4);
    }
    document.getElementById("stage-banner-title").textContent = hudStageTitle;
    document.getElementById("stage-banner-desc").textContent = pourStages.finishVoice;
  } else {
    const isPouringNow = brewElapsed >= curStage.startSec && brewElapsed < curStage.pourEndSec;
    if (isPouringNow) {
      phaseMode = "pouring";
      phaseProgress = Math.max(0, Math.min(1, (brewElapsed - curStage.startSec) / Math.max(1, curStage.pourEndSec - curStage.startSec)));
      currentWater = curStage.startWater + (curStage.targetWater - curStage.startWater) * phaseProgress;
      const remainPourSec = Math.ceil(curStage.pourEndSec - brewElapsed);

      setPouringWaterSound(true);
      if (bannerEl) bannerEl.className = "stage-alert-banner pouring-mode";
      hudStageTitle = `💧 [물 붓는 중] ${curStage.name} (${remainPourSec}초)`;
      hudSubText = `목표 ${curStage.targetWater}g까지 부으세요 (현재 ${Math.round(currentWater)}g)`;
      document.getElementById("stage-banner-title").textContent = hudStageTitle;
      document.getElementById("stage-banner-desc").textContent = curStage.voiceStart;
    } else {
      phaseMode = "waiting";
      phaseProgress = Math.max(0, Math.min(1, (brewElapsed - curStage.pourEndSec) / Math.max(1, curStage.endSec - curStage.pourEndSec)));
      currentWater = curStage.targetWater;
      const remainWaitSec = Math.ceil(curStage.endSec - brewElapsed);

      setPouringWaterSound(false);
      if (bannerEl) bannerEl.className = "stage-alert-banner waiting-mode";
      hudStageTitle = `✋ [멈춤·대기 중] 다음 단계까지 ${remainWaitSec}초`;
      hudSubText = `주전자를 내려놓고 대기하세요 (현재 ${curStage.targetWater}g)`;
      document.getElementById("stage-banner-title").textContent = hudStageTitle;
      document.getElementById("stage-banner-desc").textContent = curStage.voiceMid;
    }
  }

  for (let i = 1; i <= Math.max(4, pourStages.length - 1); i++) {
    const row = document.getElementById("sched-row-" + i);
    if (!row) continue;
    if (brewElapsed >= totalTime || i < activeIdx) {
      row.className = "schedule-item done";
    } else if (i === activeIdx) {
      row.className = phaseMode === "pouring" ? "schedule-item active-pouring" : "schedule-item active-waiting";
    } else {
      row.className = "schedule-item";
    }
  }

  draw3DScene(brewElapsed, phaseMode, currentWater, phaseProgress, hudStageTitle, hudSubText);

  if (brewRunning) {
    brewAnimReq = requestAnimationFrame(brewLoop);
  }
}

// ----------------------------------------------------------------------------
// 3D 투명 드리퍼·커피층 애니메이션 캔버스
// ----------------------------------------------------------------------------
function startBrewOutro(finalWater, totalTime) {
  if (brewOutroAnimReq) cancelAnimationFrame(brewOutroAnimReq);
  const startedAt = performance.now();
  const duration = 6.8;
  const clamp = value => Math.max(0, Math.min(1, value));
  const frame = now => {
    const elapsed = Math.max(0, (now-startedAt)/1000);
    const kettleAlpha = 1 - clamp(elapsed/1.5);
    // 주전자 주둥이가 사라진 뒤 3초를 기다리고 드리퍼를 서서히 제거합니다.
    const dripperAlpha = elapsed < 4.5 ? 1 : 1 - clamp((elapsed-4.5)/1.5);
    const steamProgress = clamp((elapsed-5.2)/1.3);
    draw3DScene(totalTime, "outro", finalWater, 1, "🎉 추출 완료!", "따뜻한 커피 향을 즐겨보세요.", { kettleAlpha, dripperAlpha, steamProgress, elapsed });
    if (elapsed < duration && document.getElementById("brewModal")?.classList.contains("open")) {
      brewOutroAnimReq = requestAnimationFrame(frame);
    } else {
      brewOutroAnimReq = null;
      showPostBrewEvaluation();
    }
  };
  brewOutroAnimReq = requestAnimationFrame(frame);
}

function draw3DScene(elapsed, phaseMode, currentWater, phaseProgress, hudTitle, hudSub, outroState = null) {
  const canvas = document.getElementById("brewAnimCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height, cx = W / 2;
  ctx.clearRect(0, 0, W, H);

  const dose = Math.max(10, Number(document.getElementById("dose-num")?.value) || 30);
  const water = Math.max(1, Number(document.getElementById("water-num")?.value) || 480);
  const waterRatio = Math.max(0, Math.min(1, currentWater / water));
  const visualDripper = ["bluebottle", "hario", "kalita"].includes(currentDripper)
    ? currentDripper
    : (currentDripper === "hario_switch" ? "hario" : "bluebottle");
  const dripperData = (window.DRIPPERS || {})[visualDripper] || { themeColor: "#78947b", themeDark: "#42634a" };
  const accent = dripperData.themeColor || "#78947b";
  const pouring = phaseMode === "pouring";
  const waiting = phaseMode === "waiting";
  const isOutro = phaseMode === "outro";
  const kettleAlpha = isOutro ? Math.max(0,Math.min(1,Number(outroState?.kettleAlpha)||0)) : 1;
  const dripperAlpha = isOutro ? Math.max(0,Math.min(1,Number(outroState?.dripperAlpha)||0)) : 1;

  // 단계 번호: 0=Bloom, 1=1차, 2=2차, 3=3차/마무리
  let activeStageIndex = 0;
  if (Array.isArray(pourStages)) {
    for (let i = 1; i < pourStages.length; i++) {
      if (elapsed >= Number(pourStages[i].startSec || 0)) activeStageIndex = i;
    }
  }
  const stageNo = Math.max(0, Math.min(3, activeStageIndex - 1));
  const stageAmplitudes = [15, 10.5, 7.2, 4.5];
  const craterTargets = [4, 8, 12, 16];
  const previousCrater = stageNo === 0 ? 0 : craterTargets[stageNo - 1];
  const progress = Math.max(0, Math.min(1, Number(phaseProgress) || 0));
  let swell = 0, crater = 0;
  if (pouring) {
    swell = stageAmplitudes[stageNo] * (0.38 + 0.62 * progress) * Math.pow(dose / 30, 0.22);
    crater = previousCrater * (1 - progress) + 0.5;
  } else if (waiting) {
    swell = stageAmplitudes[stageNo] * (1 - 0.78 * progress) * Math.pow(dose / 30, 0.22);
    crater = previousCrater + (craterTargets[stageNo] - previousCrater) * progress;
  } else if (phaseMode === "done" || phaseMode === "outro") {
    swell = 0;
    crater = craterTargets[3];
  }
  const wetness = Math.min(1, Math.max(0, currentWater / Math.max(1, dose * 3.2)));

  // Night-blue studio background
  const bg = ctx.createRadialGradient(cx, 210, 10, cx, 220, 280);
  if (pouring) {
    bg.addColorStop(0, "#103b50"); bg.addColorStop(0.62, "#0b2031"); bg.addColorStop(1, "#070d16");
  } else if (waiting) {
    bg.addColorStop(0, "#3c291b"); bg.addColorStop(0.62, "#21170f"); bg.addColorStop(1, "#090d14");
  } else {
    bg.addColorStop(0, "#253548"); bg.addColorStop(0.6, "#111e2a"); bg.addColorStop(1, "#080d14");
  }
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  // HUD
  ctx.save();
  ctx.fillStyle = pouring ? "rgba(8,112,153,.45)" : waiting ? "rgba(161,103,37,.34)" : "rgba(255,255,255,.10)";
  ctx.strokeStyle = pouring ? "#55c5ee" : waiting ? "#d6a85a" : "rgba(255,255,255,.25)";
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(12, 10, W - 24, 54, 10); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#fff"; ctx.font = "900 13px sans-serif"; ctx.textAlign = "center";
  ctx.fillText(hudTitle || "BrewMap 3D 브루잉", cx, 30);
  ctx.fillStyle = pouring ? "#a5e7fa" : "#ffe2a6"; ctx.font = "700 10.5px sans-serif";
  ctx.fillText(hudSub || "커피층의 팽창과 배수 변화를 표현합니다", cx, 48);
  ctx.restore();

  // Server and coffee surface
  const srvTopY = 326, srvBotY = 428, srvTopW = 52, srvBotW = 78;
  const beverageRatio = Math.min(0.78, waterRatio * 0.78);
  const liquidH = (srvBotY - srvTopY) * beverageRatio;
  const liquidTopY = srvBotY - liquidH;
  const liquidTopW = srvTopW + (srvBotW - srvTopW) * ((liquidTopY - srvTopY) / (srvBotY - srvTopY));
  ctx.save();
  if (liquidH > 2) {
    const coffee = ctx.createLinearGradient(cx - srvBotW, liquidTopY, cx + srvBotW, srvBotY);
    coffee.addColorStop(0, "#7d4527"); coffee.addColorStop(0.48, "#3b1c0d"); coffee.addColorStop(1, "#211008");
    ctx.fillStyle = coffee;
    ctx.beginPath(); ctx.moveTo(cx - liquidTopW, liquidTopY); ctx.lineTo(cx + liquidTopW, liquidTopY);
    ctx.lineTo(cx + srvBotW, srvBotY); ctx.lineTo(cx - srvBotW, srvBotY); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(206,133,78,.82)";
    ctx.beginPath(); ctx.ellipse(cx, liquidTopY, liquidTopW, 7, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.strokeStyle = "rgba(222,242,248,.68)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx - srvTopW, srvTopY); ctx.lineTo(cx - srvBotW, srvBotY); ctx.moveTo(cx + srvTopW, srvTopY); ctx.lineTo(cx + srvBotW, srvBotY); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(cx, srvBotY, srvBotW, 9, 0, 0, Math.PI); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(cx, srvTopY, srvTopW, 6, 0, Math.PI, Math.PI * 2); ctx.stroke();
  ctx.restore();

  // 물줄기 도착점을 현재 원두량과 팽창/함몰이 반영된 커피층 중앙 표면에 일치시킵니다.
  const normalizedDoseForStream = Math.max(0, Math.min(1, (dose - 15) / 35));
  const bedBaseYForStream = 220 - 34 - normalizedDoseForStream * 30;
  const streamTargetY = bedBaseYForStream - swell + crater;
  ctx.save();
  ctx.globalAlpha *= kettleAlpha;
  ctx.strokeStyle = "#adb9c5"; ctx.lineWidth = 8; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(W - 10, 78); ctx.quadraticCurveTo(cx + 55, 94, cx + 5, 86); ctx.stroke();
  ctx.restore();

  // Dripper geometry (transparent glass). Different inner profiles per dripper.
  const topY = 104, bottomY = 220, topHalf = 91;
  const bottomHalf = visualDripper === "hario" ? 22 : (visualDripper === "kalita" ? 62 : 38);
  const shapePath = () => {
    ctx.beginPath();
    if (visualDripper === "kalita") {
      ctx.moveTo(cx - topHalf, topY); ctx.lineTo(cx + topHalf, topY);
      ctx.lineTo(cx + 76, topY + 22); ctx.lineTo(cx + bottomHalf, bottomY - 5);
      ctx.lineTo(cx - bottomHalf, bottomY - 5); ctx.lineTo(cx - 76, topY + 22); ctx.closePath();
    } else if (visualDripper === "bluebottle") {
      ctx.moveTo(cx - topHalf, topY); ctx.lineTo(cx + topHalf, topY);
      ctx.bezierCurveTo(cx + 77, topY + 45, cx + 54, bottomY - 24, cx + bottomHalf, bottomY - 5);
      ctx.lineTo(cx - bottomHalf, bottomY - 5);
      ctx.bezierCurveTo(cx - 54, bottomY - 24, cx - 77, topY + 45, cx - topHalf, topY);
      ctx.closePath();
    } else {
      ctx.moveTo(cx - topHalf, topY); ctx.lineTo(cx + topHalf, topY);
      ctx.lineTo(cx + bottomHalf, bottomY - 5); ctx.lineTo(cx - bottomHalf, bottomY - 5); ctx.closePath();
    }
  };
  const widthAtY = y => {
    const t = Math.max(0, Math.min(1, (y - topY) / (bottomY - topY)));
    if (visualDripper === "kalita") return topHalf - (topHalf - bottomHalf) * t * 0.78;
    if (visualDripper === "bluebottle") return topHalf - (topHalf - bottomHalf) * Math.pow(t, 0.88);
    return topHalf - (topHalf - bottomHalf) * t;
  };

  ctx.save();
  ctx.globalAlpha *= dripperAlpha;

  // Main coffee bed height is tied to coffee dose. A larger dose creates a taller bed.
  const normalizedDose = Math.max(0, Math.min(1, (dose - 15) / 35));
  const bedBaseY = bottomY - 34 - normalizedDose * 30;
  const bedHalfW = Math.max(27, widthAtY(bedBaseY) - 7);
  const centerOffset = -swell + crater;
  const centerY = bedBaseY + centerOffset;

  // Glass body behind coffee bed
  ctx.save(); shapePath();
  const glass = ctx.createLinearGradient(cx - topHalf, topY, cx + topHalf, bottomY);
  glass.addColorStop(0, "rgba(220,244,249,.16)"); glass.addColorStop(.48, "rgba(255,255,255,.06)"); glass.addColorStop(1, "rgba(178,220,231,.13)");
  ctx.fillStyle = glass; ctx.fill();
  ctx.restore();

  // Clip bed to the transparent dripper interior.
  ctx.save(); shapePath(); ctx.clip();
  const grounds = ctx.createLinearGradient(cx, bedBaseY, cx, bottomY);
  grounds.addColorStop(0, "#7a4528"); grounds.addColorStop(.18, "#4a2817"); grounds.addColorStop(1, "#241309");
  ctx.fillStyle = grounds;
  ctx.beginPath();
  ctx.moveTo(cx - bedHalfW, bedBaseY);
  ctx.quadraticCurveTo(cx - bedHalfW * .42, bedBaseY + centerOffset * .68, cx, centerY);
  ctx.quadraticCurveTo(cx + bedHalfW * .42, bedBaseY + centerOffset * .68, cx + bedHalfW, bedBaseY);
  ctx.lineTo(cx + bottomHalf + 8, bottomY + 8); ctx.lineTo(cx - bottomHalf - 8, bottomY + 8); ctx.closePath(); ctx.fill();

  // Uneven, wet coffee surface: edge ring remains while the centre swells or dips.
  const surfaceGrad = ctx.createRadialGradient(cx - 9, centerY - 7, 3, cx, centerY + 1, bedHalfW * .95);
  surfaceGrad.addColorStop(0, pouring ? "#c28a5d" : "#98603b");
  surfaceGrad.addColorStop(.52, wetness > .15 ? "#754126" : "#5c321c");
  surfaceGrad.addColorStop(1, "#3b2113");
  ctx.fillStyle = surfaceGrad;
  ctx.beginPath();
  ctx.moveTo(cx - bedHalfW, bedBaseY);
  ctx.quadraticCurveTo(cx - bedHalfW * .38, bedBaseY + centerOffset * .72, cx, centerY);
  ctx.quadraticCurveTo(cx + bedHalfW * .38, bedBaseY + centerOffset * .72, cx + bedHalfW, bedBaseY);
  ctx.quadraticCurveTo(cx + bedHalfW * .65, bedBaseY + 9, cx, bedBaseY + 9);
  ctx.quadraticCurveTo(cx - bedHalfW * .65, bedBaseY + 9, cx - bedHalfW, bedBaseY);
  ctx.closePath(); ctx.fill();

  if (pouring) {
    ctx.fillStyle = "rgba(124,213,231,.34)";
    ctx.beginPath(); ctx.ellipse(cx, centerY - 1, Math.max(12, bedHalfW * (.22 + .10 * progress)), 4 + progress * 2, 0, 0, Math.PI * 2); ctx.fill();
  } else if (waiting && wetness > .1) {
    ctx.fillStyle = "rgba(126,186,192,.16)";
    ctx.beginPath(); ctx.ellipse(cx, centerY + 2, bedHalfW * .26, 2.5, 0, 0, Math.PI * 2); ctx.fill();
  }

  // A few bloom bubbles, strongest during the first bloom.
  if (stageNo === 0 && (pouring || waiting) && wetness > .05) {
    for (let i = 0; i < 9; i++) {
      const bx = cx + Math.sin(i * 2.17 + elapsed * .65) * bedHalfW * (.12 + (i % 3) * .12);
      const by = centerY + Math.cos(i * 1.47 + elapsed * .48) * 4;
      const r = 1.2 + ((i * 7) % 4) * .42;
      ctx.strokeStyle = "rgba(238,205,164,.72)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.stroke();
    }
  }
  ctx.restore();

  // Transparent front walls and dripper rim, drawn over the bed.
  ctx.save();
  ctx.strokeStyle = "rgba(231,248,251,.82)"; ctx.lineWidth = 2.1;
  shapePath(); ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,.84)"; ctx.lineWidth = 2.3;
  ctx.beginPath(); ctx.ellipse(cx, topY, topHalf, 13, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = "rgba(116,171,187,.48)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(cx, topY + 2, topHalf - 4, 10, 0, 0, Math.PI * 2); ctx.stroke();
  if (visualDripper === "kalita") {
    for (let i = -5; i <= 5; i++) {
      const x = cx + i * 11;
      ctx.strokeStyle = "rgba(229,247,249,.27)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x * .98 + cx * .02, topY + 12); ctx.lineTo(cx + i * 8.2, bottomY - 7); ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,.68)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx - bottomHalf, bottomY - 5); ctx.lineTo(cx + bottomHalf, bottomY - 5); ctx.stroke();
  } else if (visualDripper === "hario") {
    for (let i = 0; i < 12; i++) {
      const a = Math.PI * 2 * i / 12;
      const x1 = cx + Math.cos(a) * (topHalf - 9), y1 = topY + Math.sin(a) * 7;
      const x2 = cx + Math.cos(a) * (bottomHalf + 2), y2 = bottomY - 9;
      ctx.strokeStyle = "rgba(225,246,249,.20)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    }
  } else {
    for (let i = -3; i <= 3; i++) {
      ctx.strokeStyle = "rgba(231,248,251,.23)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx + i * 20, topY + 12); ctx.lineTo(cx + i * 8, bottomY - 8); ctx.stroke();
    }
  }
  ctx.fillStyle = "rgba(225,244,247,.48)";
  ctx.beginPath(); ctx.ellipse(cx, bottomY - 4, bottomHalf + 2, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // Extracted coffee drops from the dripper into the server.
  if (elapsed > 1 && phaseMode !== "prep" && phaseMode !== "done" && !isOutro) {
    ctx.save();
    ctx.strokeStyle = "rgba(190,126,80,.88)"; ctx.lineWidth = waiting || phaseMode === "done" ? 1.8 : 2.6;
    ctx.setLineDash(waiting || phaseMode === "done" ? [3, 7] : [7, 4]);
    ctx.lineDashOffset = -elapsed * 28;
    const outlets = visualDripper === "kalita" ? [cx - 12, cx, cx + 12] : [cx];
    outlets.forEach(x => { ctx.beginPath(); ctx.moveTo(x, bottomY + 2); ctx.lineTo(x, liquidTopY - 1); ctx.stroke(); });
    ctx.restore();
  }
  ctx.restore(); // dripper fade scope

  // 물줄기는 드리퍼/커피층 앞쪽에 렌더링하여 커피층의 중앙 표면에 닿는 것이 보이게 합니다.
  if (pouring) {
    const streamX = cx + Math.sin(elapsed * 5) * 1.2;
    const streamGrad = ctx.createLinearGradient(streamX, 90, cx, streamTargetY);
    streamGrad.addColorStop(0, "rgba(191,235,255,.98)"); streamGrad.addColorStop(1, "rgba(75,176,220,.92)");
    ctx.save();
    ctx.globalAlpha *= kettleAlpha;
    ctx.strokeStyle = streamGrad; ctx.lineWidth = 4.2; ctx.lineCap="round";
    ctx.beginPath(); ctx.moveTo(streamX, 90); ctx.quadraticCurveTo(cx + 1, (90+streamTargetY)/2, cx, streamTargetY); ctx.stroke();
    ctx.fillStyle = "rgba(194,239,255,.68)"; ctx.beginPath(); ctx.ellipse(cx, streamTargetY, 11, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // Steam rises from the coffee server after the dripper begins to disappear.
  if (isOutro && Number(outroState?.steamProgress) > 0) {
    const steam = Math.max(0,Math.min(1,Number(outroState.steamProgress)));
    const phaseTime = Number(outroState.elapsed) || 0;
    ctx.save();
    for (let i=0;i<4;i++) {
      const baseX = cx + (i-1.5)*13;
      const rise = steam*48;
      const drift = Math.sin(phaseTime*2.2+i*1.7)*7;
      ctx.strokeStyle = `rgba(232,244,238,${0.28+steam*0.38})`;
      ctx.lineWidth = 3.2 - i*.35;
      ctx.lineCap = "round";
      const steamBaseY = Math.min(srvBotY - 6, Math.max(srvTopY + 8, liquidTopY - 2));
      ctx.beginPath();
      ctx.moveTo(baseX, steamBaseY);
      ctx.bezierCurveTo(baseX-10+drift, steamBaseY-15-rise*.25, baseX+12-drift, steamBaseY-28-rise*.65, baseX+drift, steamBaseY-40-rise);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Waiting countdown centered in the server/beaker.
  if (waiting) {
    let waitRemainSec = 0;
    const activeWaitStage = Array.isArray(pourStages) ? pourStages.find(stage =>
      elapsed >= Number(stage.pourEndSec || 0) && elapsed < Number(stage.endSec || 0)
    ) : null;
    if (activeWaitStage) waitRemainSec = Math.max(0, Math.ceil(Number(activeWaitStage.endSec) - elapsed));
    const waitW = 132, waitH = 48, waitX = cx - waitW / 2, waitY = srvTopY + (srvBotY - srvTopY - waitH) / 2;
    ctx.save();
    ctx.fillStyle = "rgba(5,13,20,.82)"; ctx.strokeStyle = "rgba(214,168,90,.95)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(waitX, waitY, waitW, waitH, 9); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#f0c982"; ctx.font = "800 9px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("물을 붓고 기다리는 시간", cx, waitY + 13);
    ctx.fillStyle = "#fff2d5"; ctx.font = "900 20px monospace";
    ctx.fillText(formatMMSS(waitRemainSec), cx, waitY + 37);
    ctx.restore();
  }

  // 드리퍼와 서버 사이의 가운데 영역: 좌측 물량, 우측 시간. 별도 박스 없이 중앙 정렬합니다.
  const totalWater = Math.max(1, Number(document.getElementById("water-num")?.value) || water);
  const totalTime = Math.max(1, Number(document.getElementById("time-num")?.value) || 210);
  const waterCenterX = W * 0.25;
  const timeCenterX = W * 0.75;
  const currentRowY = 246;
  const separatorY = 263;
  const targetRowY = 292;
  const drawCenteredValueLabel = (centerX, baselineY, valueText, labelText, valueColor, labelColor) => {
    ctx.save();
    ctx.textAlign = "left";
    ctx.font = "900 17px monospace";
    const valueWidth = ctx.measureText(valueText).width;
    ctx.font = "800 8px sans-serif";
    const labelWidth = ctx.measureText(labelText).width;
    const gap = 4;
    const startX = centerX - (valueWidth + gap + labelWidth) / 2;
    ctx.font = "900 17px monospace";
    ctx.fillStyle = valueColor;
    ctx.fillText(valueText, startX, baselineY);
    ctx.font = "800 8px sans-serif";
    ctx.fillStyle = labelColor;
    ctx.fillText(labelText, startX + valueWidth + gap, baselineY - 1);
    ctx.restore();
  };

  drawCenteredValueLabel(waterCenterX, currentRowY, `${Math.round(currentWater)}g`, "투입량", "#43c8f2", "#8bdcf3");
  drawCenteredValueLabel(waterCenterX, targetRowY, `${Math.round(totalWater)}g`, "목표 물량", "#93dff2", "#93dff2");
  drawCenteredValueLabel(timeCenterX, currentRowY, formatMMSS(Math.max(0, elapsed)), "경과 시간", "#63d69b", "#9ce4bc");
  drawCenteredValueLabel(timeCenterX, targetRowY, formatMMSS(totalTime), "목표 시간", "#a0e9bd", "#a0e9bd");

  // 물량 구분선: 현재 누적 투입량의 일의 자리(10g 단위 반복)에 따라 길이가 변합니다.
  const waterUnits = Math.round(currentWater) % 10;
  const waterLineWidth = waterUnits * 6.8;
  if (waterLineWidth > 0) {
    ctx.save();
    ctx.strokeStyle = "#43c8f2";
    ctx.lineWidth = 2.8;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(waterCenterX - waterLineWidth / 2, separatorY);
    ctx.lineTo(waterCenterX + waterLineWidth / 2, separatorY);
    ctx.stroke();
    ctx.restore();
  }

  // 시간 구분선: 추출이 진행되는 동안 0.5초 표시 / 0.5초 숨김을 반복합니다.
  const timeLineIsOn = !((pouring || waiting) && (Math.floor(Math.max(0, elapsed) * 2) % 2 === 1));
  if (timeLineIsOn) {
    ctx.save();
    ctx.strokeStyle = "#63d69b";
    ctx.lineWidth = 2.8;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(timeCenterX - 35, separatorY);
    ctx.lineTo(timeCenterX + 35, separatorY);
    ctx.stroke();
    ctx.restore();
  }
}
