/**
 * brew_engine.js
 * 드립 커피 추출 프로그램 작동 엔진 파일 (버전 1.65 수정본)
 * - 사용자 인증(마스터 / 지인 모드) 및 권한 관리 안전성 강화
 * - 1줄 2개 배치 조작창 (막대 슬라이더 + 직접 숫자 입력 + 🔒 잠금 시스템)
 * - 7단계 중량 × 4개 추출 모드 실시간 물 투입량 계산
 * - 두 가지 분쇄 설정 방식(등록 모델 / 일반 5단계)
 * - 실측 TDS/EY 및 SCA 골든컵 차트(미측정 추정값 미표시)
 * - 3D 실사 추출 애니메이션, 물소리 ASMR 효과음, 3단계 음성 안내
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
let wizardState = { dripper: false, bean: false, recipe: false };
let presetLockedFields = new Set();
let brewCompletionPromptShown = false;
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
    renderRecipeBoard();
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
    if (headerTitle) headerTitle.textContent = "오찬욱 바리스타 마스터 다이얼러";
    if (subTitle) subTitle.textContent = "오찬욱 바리스타님, 환영합니다! 모든 사용자의 레시피를 열람하고 지인 초대 링크를 만들 수 있습니다.";
    if (inviteBtn) inviteBtn.style.display = "inline-block";
    if (boardTitle) boardTitle.textContent = "👑 마스터 통합 레시피 보관함 (전체 사용자 열람)";
    if (fileInfo) fileInfo.textContent = "저장 시 [마스터_오찬욱_기본레시피.csv] 단일 파일에 누적 강제 저장됩니다.";
  } else {
    if (roleBadge) {
      roleBadge.textContent = `☕ ${currentUserName} 바리스타`;
      roleBadge.className = "role-badge badge-guest";
    }
    if (headerTitle) headerTitle.textContent = `${currentUserName} 님의 브루잉 다이얼러`;
    if (subTitle) subTitle.textContent = `${currentUserName} 님, 환영합니다! 드리퍼에 [${currentUserName} 바리스타] 전용 명패가 각인되었습니다.`;
    if (inviteBtn) inviteBtn.style.display = "none";
    if (boardTitle) boardTitle.textContent = `📔 ${currentUserName} 님의 전용 레시피 보관함`;
    if (fileInfo) fileInfo.textContent = `저장 시 [개별링크_${currentUserName}_기본레시피.csv] 단일 파일에 누적 강제 저장됩니다.`;
  }

  applyOriginMatrix();
  renderRecipeBoard();
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
  const registered = document.getElementById("grinder-registered-controls");
  const general = document.getElementById("general-grind-controls");
  if (registered) registered.hidden = mode !== "registered";
  if (general) general.hidden = mode !== "general";
  applyGrinderLockUI();
  updateGrinderSummary();
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
  if (logoBadge) logoBadge.textContent = d.badge;
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
  wizardState.bean = true;
  // 원두를 바꾸면 이전 레시피 유형/바리스타 잠금을 해제하고 다시 선택하도록 합니다.
  if (currentBaristaPresetId) clearBaristaPreset(false);
  currentBaristaPresetId = null;
  currentBaristaPreset = null;
  recipeType = null;
  wizardState.recipe = false;
  document.querySelectorAll('input[name="recipe-type"]').forEach(el => { el.checked = false; });
  const generalOptions = document.getElementById("general-recipe-options");
  const baristaOptions = document.getElementById("barista-recipe-options");
  if (generalOptions) generalOptions.hidden = true;
  if (baristaOptions) baristaOptions.hidden = true;
  const presetSel = document.getElementById("preset-select");
  if (presetSel) presetSel.value = "common_mode";
  refreshWizard();
  applyOriginMatrix();
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
  if (s2) s2.hidden = !wizardState.dripper;
  if (s3) s3.hidden = !wizardState.bean;
  [[s1,wizardState.dripper],[s2,wizardState.bean],[s3,wizardState.recipe]].forEach(([el,done]) => {
    if (!el) return;
    el.classList.toggle("is-complete", !!done);
    el.classList.toggle("is-current", !done);
  });
  const dLabel = document.getElementById("wizard-dripper-selected");
  const originSel = document.getElementById("origin-select");
  const bLabel = document.getElementById("wizard-bean-selected");
  const rLabel = document.getElementById("wizard-recipe-selected");
  if (dLabel) { dLabel.textContent = `선택됨: ${currentDripperLabel}`; dLabel.classList.toggle("visible", wizardState.dripper); }
  const bean = originSel && window.ORIGIN_DB ? window.ORIGIN_DB[originSel.value] : null;
  if (bLabel) { bLabel.textContent = bean ? `선택됨: ${bean.name}` : ""; bLabel.classList.toggle("visible", wizardState.bean && !!bean); }
  if (rLabel) {
    const msg = currentBaristaPreset ? `선택됨: ${currentBaristaPreset.baristaName} · ${currentBaristaPreset.recipeName}` : (recipeType === "general" ? "선택됨: 일반 모드" : "");
    rLabel.textContent = msg;
    rLabel.classList.toggle("visible", wizardState.recipe && !!msg);
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
    const presetSel = document.getElementById("preset-select");
    if (presetSel) presetSel.value = "common_mode";
    currentModeKey = "standard";
    const standard = document.getElementById("mbtn-standard");
    if (standard) standard.classList.add("active");
    ["strong", "light", "bypass"].forEach(m => document.getElementById("mbtn-"+m)?.classList.remove("active"));
    wizardState.recipe = true;
    applyOriginMatrix();
  } else {
    wizardState.recipe = false;
    const presetSel = document.getElementById("preset-select");
    if (presetSel) presetSel.value = "common_mode";
  }
  refreshWizard();
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
    const generalOptions = document.getElementById("general-recipe-options");
    const baristaOptions = document.getElementById("barista-recipe-options");
    if (generalOptions) generalOptions.hidden = true;
    if (baristaOptions) baristaOptions.hidden = false;
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
  if (logo) logo.textContent = (window.DRIPPERS[preset.dripper] || {}).badge || "★";

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
    const special = preset.requiresSpecialEquipment ? " · 특수 장비가 필요합니다." : "";
    summary.textContent = `${preset.baristaName} · ${preset.recipeName} / 원본 ${preset.coffeeDose}g : ${preset.waterAmount}g · ${preset.grindGuidance}${special}`;
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

  // 실측값이 모두 있을 때만 EY를 계산한다. 미측정값은 임의 추정하지 않는다.
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
    if (eyVal) eyVal.textContent = `실측 EY ${ey.toFixed(2)}% · TDS ${tds.toFixed(2)}%`;
    if (tdsSub) tdsSub.textContent = "굴절계 TDS와 실제 완성 음료 무게를 사용한 계산값";
    if (measuredEyResult) measuredEyResult.textContent = `[실측 계산] EY: ${ey.toFixed(2)}% · TDS: ${tds.toFixed(2)}%`;
    if (eyBadge) {
      eyBadge.textContent = measured.withinGoldenCupEY && measured.withinGoldenCupTDS ? "골든컵 목표 영역" : "골든컵 범위 확인";
      eyBadge.className = measured.withinGoldenCupEY && measured.withinGoldenCupTDS ? "badge badge-good" : "badge badge-warn";
    }
    drawScaChart(ey, tds, d.themeColor, d.themeDark);
  } else {
    const tdsText = hasTds ? `TDS ${Number(tdsVal).toFixed(2)}% 실측` : "TDS 미입력";
    if (eyVal) eyVal.textContent = hasTds ? `${tdsText} · EY 계산 대기` : "실측 TDS / EY 입력 대기";
    if (tdsSub) tdsSub.textContent = hasBev && !hasTds ? "TDS를 입력하면 EY를 계산합니다." : "미측정 상태에서는 수치를 추정하지 않습니다.";
    if (measuredEyResult) measuredEyResult.textContent = hasTds && !hasBev
      ? "실제 완성 음료 무게를 입력하면 EY 계산"
      : "TDS와 실제 음료 무게 입력 시 실측 EY 계산";
    if (eyBadge) { eyBadge.textContent = "측정 대기"; eyBadge.className = "badge badge-warn"; }
    drawScaChart(null, null, d.themeColor, d.themeDark);
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
function drawScaChart(ey, tds, themeColor, themeDark) {
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

  if (ey !== null && ey !== undefined && tds !== null && tds !== undefined && Number.isFinite(Number(ey)) && Number.isFinite(Number(tds))) {
    const curX = padL + ((Math.max(minEy, Math.min(maxEy, ey)) - minEy) / (maxEy - minEy)) * plotW;
    const curY = padT + plotH - ((Math.max(minTds, Math.min(maxTds, tds)) - minTds) / (maxTds - minTds)) * plotH;
    ctx.beginPath(); ctx.fillStyle = "#e03131";
    ctx.arc(curX, curY, 6.5, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "#212529"; ctx.font = "bold 10px monospace"; ctx.textAlign = "left";
    ctx.fillText(`(${Number(ey).toFixed(2)}%, ${Number(tds).toFixed(2)}%)`, curX + 9, curY + 3);
  } else {
    ctx.fillStyle = "#6c757d"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("실측 TDS와 음료 무게 입력 후 표시", padL + plotW / 2, padT + plotH / 2);
  }
}

// ============================================================================
// 7. 앱 내부 누적 저장 + 단일 엑셀(.csv) 강제 저장 및 백업·복원 시스템
// ============================================================================
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
  const defaultName = getRecommendedRecipeName();
  const nameInput = prompt("저장할 레시피 이름을 확인해 주세요 (기본 추천 이름 자동 입력):", defaultName);
  if (!nameInput) return;

  const reviewInput = prompt("커피 맛이나 향미 특징을 한 줄로 남겨주세요:", "산미와 단맛의 밸런스가 아주 좋음");
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
    flavorRatings: getFlavorRatings(),
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
    review: (reviewInput && reviewInput.trim()) ? reviewInput.trim() : "최고의 세팅"
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

  const headers = ["고유ID", "저장일시", "구분코드", "작성자", "레시피이름", "드리퍼", "산지키", "원두량(g)", "분쇄설정방식", "그라인더ID", "그라인더눈금", "일반분쇄도단계", "실측TDS(%)", "실측음료무게(g)", "물온도(℃)", "추출시간(초)", "물의양(g)", "수율정보", "맛한줄평", "측정상태", "레시피유형", "바리스타프리셋ID", "드리퍼표시명", "향미산미", "향미단맛", "향미쓴맛"];
  const escapeCsv = val => `"${String(val ?? "").replace(/"/g, '""')}"`;

  const rows = targetList.map(r => [
    r.id, r.date, r.roleCode, r.author, r.name, r.dripper, r.origin,
    r.dose, r.grinderMode || "none", r.grinderId || "", r.grinderSetting ?? "", r.generalGrindLevel ?? "",
    r.measuredTds ?? "", r.measuredBeverageMass ?? "", r.temp, r.time, r.water, r.ey, r.review,
    r.measurementStatus || "legacy_unverified", r.recipeType || "general", r.baristaPresetId || "", r.dripperLabel || "",
    r.flavorRatings?.sour ?? "", r.flavorRatings?.sweet ?? "", r.flavorRatings?.bitter ?? ""
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
      const importedDripper = (window.DRIPPERS || {})[rawDripper] || (importedPreset && importedPreset.dripper === rawDripper ? rawDripper : "bluebottle");
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
        flavorRatings: hasV16Headers ? {
          sour: col(cols, "향미산미", -1) !== "" ? Number(col(cols, "향미산미", -1)) : null,
          sweet: col(cols, "향미단맛", -1) !== "" ? Number(col(cols, "향미단맛", -1)) : null,
          bitter: col(cols, "향미쓴맛", -1) !== "" ? Number(col(cols, "향미쓴맛", -1)) : null
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
        • <b>메모:</b> <span style="color:#d9480f; font-weight:700;">"${escapeRecipeHtml(r.review)}"</span>
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
  wizardState = { dripper: true, bean: true, recipe: true };
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
  ["sour","sweet","bitter"].forEach(key => { const el=document.getElementById(`flavor-${key}`); if(el)el.value=r.flavorRatings?.[key] ?? 0; });
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
// v1.65 도움말 · 단계 선택 · 인증 세션
// ============================================================================
const MASTER_SESSION_KEY = "brewmap_master_session_v165";
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
    metrics: ["수율(EY)과 농도(TDS)", "SCA 참고 목표 범위와 실측값을 분리해서 표시합니다. 검증된 개인별 예측 모델은 포함하지 않으며, 실제 EY는 굴절계 TDS와 실제 완성 음료 무게가 모두 있어야 계산할 수 있습니다."],
    flavor: ["향미 평가", "산미·단맛·쓴맛은 사용자가 실제로 시음한 뒤 0~5점으로 기록합니다. 설정값만으로 향미 점수를 예측하지 않습니다."],
    extraction: ["시간별 성분 용출 개념도", "시간축에 따른 성분 용출 경향을 설명하는 개념 곡선입니다. 특정 원두의 실측 화학 분석 데이터가 아니며 목표 시간선은 현재 레시피의 목표 시간입니다."],
    sca: ["SCA 골든컵 차트", "참고 목표 영역은 TDS 1.15~1.35%, EY 18~22%로 표시합니다. 개인 취향이나 모든 추출 방식에 대한 절대적 품질 판정은 아닙니다."]
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
  const read = key => { const el=document.getElementById(`flavor-${key}`); const n=el?Number(el.value):0; return n>0?n:null; };
  return { sour: read("sour"), sweet: read("sweet"), bitter: read("bitter") };
}
function updateFlavorChart() {
  const values = ["sour","sweet","bitter"].map(key => {
    const el=document.getElementById(`flavor-${key}`); const value=el?Number(el.value):0;
    const output=document.getElementById(`flavor-${key}-value`);
    if(output) output.textContent=value>0?`${value.toFixed(1)} / 5`:"미평가";
    return value;
  });
  const canvas=document.getElementById("flavorChart"); if(!canvas)return;
  const ctx=canvas.getContext("2d"), W=canvas.width, H=canvas.height;
  ctx.clearRect(0,0,W,H);
  const labels=["산미","단맛","쓴맛"], colors=["#d69a49","#659a73","#7588a8"];
  const max=5, left=54, right=20, top=16, row=43, usable=W-left-right;
  ctx.font="12px sans-serif"; ctx.textBaseline="middle";
  values.forEach((v,i)=>{
    const y=top+i*row;
    ctx.fillStyle="#596b5d"; ctx.textAlign="right"; ctx.fillText(labels[i],left-10,y+9);
    ctx.fillStyle="#edf2ed"; ctx.fillRect(left,y,usable,18);
    if(v>0){ctx.fillStyle=colors[i];ctx.fillRect(left,y,usable*v/max,18);}
    ctx.fillStyle="#647468";ctx.textAlign="left";ctx.fillText(v>0?`${v.toFixed(1)}/5`:"미평가",left+usable+5,y+9);
  });
}

// ============================================================================
// 9. 3D 실사 추출 애니메이션 & 음성·ASMR 사운드 엔진
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
  if (modalTitle) modalTitle.textContent = `${currentUserName} 바리스타 3D 브루잉 가이드 (${currentDripperLabel || d.fullName})`;
  const specialNote = currentBaristaPreset?.requiresSpecialEquipment ? " · 특수 장비 전용 프리셋: 3D 드리퍼 그림은 추출 순서 안내용 개념 표현입니다." : "";
  if (modalSub) modalSub.textContent = `원두 ${dose}g · 물 투입량 ${water}g · ${temp.toFixed(1)}°C · 목표 시간 ${formatSecToKorean(time)}${specialNote}`;

  buildPourStages();
  resetBrewTimer();
  const modal = document.getElementById("brewModal");
  if (modal) modal.classList.add("open");
}

function closeBrewModal() {
  brewRunning = false;
  setPouringWaterSound(false);
  if (brewAnimReq) cancelAnimationFrame(brewAnimReq);
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
  brewCompletionPromptShown = false;
  brewRunning = false;
  brewElapsed = -10.0;
  lastBeepSec = null;
  setPouringWaterSound(false);
  if (brewAnimReq) cancelAnimationFrame(brewAnimReq);
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
      window.setTimeout(() => {
        const shouldSave = window.confirm("추출이 완료되었습니다. 방금 내린 레시피를 저장하시겠습니까?");
        if (shouldSave) saveCurrentRecipe();
      }, 350);
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
// 3D 실사 애니메이션 캔버스 (비이커 글씨 완전 제거 버전)
// ----------------------------------------------------------------------------
function draw3DScene(elapsed, phaseMode, currentWater, phaseProgress, hudTitle, hudSub) {
  const canvas = document.getElementById("brewAnimCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const d = (window.DRIPPERS || {})[currentDripper] || { themeColor: "#00a1e4" };
  const totalTime = parseFloat(document.getElementById("time-num").value) || 210;
  const water = parseFloat(document.getElementById("water-num").value) || 480;
  let targetRefWater = water;
  if (currentModeKey === "bypass") {
    const bRes = window.calculateBrewModeWater(parseFloat(document.getElementById("dose-num").value) || 30, "bypass");
    targetRefWater = bRes.dripperInputWaterG;
  }

  const waterRatio = Math.max(0, Math.min(1, currentWater / Math.max(1, targetRefWater)));
  const cx = W / 2;
  const isPouring = (phaseMode === "pouring");
  const isWaiting = (phaseMode === "waiting");

  // 배경 그라데이션
  const bgGrad = ctx.createRadialGradient(cx, 190, 15, cx, 220, 260);
  if (isPouring) {
    bgGrad.addColorStop(0, "#0c3c5c");
    bgGrad.addColorStop(0.55, "#0b1e33");
    bgGrad.addColorStop(1, "#060c17");
  } else if (isWaiting) {
    bgGrad.addColorStop(0, "#4a2c11");
    bgGrad.addColorStop(0.55, "#26160a");
    bgGrad.addColorStop(1, "#120a05");
  } else {
    bgGrad.addColorStop(0, "#2b3445");
    bgGrad.addColorStop(0.6, "#151a24");
    bgGrad.addColorStop(1, "#090c12");
  }
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // 대기 중 보케 효과
  if (isWaiting) {
    ctx.save();
    for (let i = 0; i < 8; i++) {
      const bx = (cx - 120) + ((i * 37) % 240) + Math.sin(elapsed * 1.2 + i) * 10;
      const by = 280 - ((elapsed * 18 + i * 28) % 200);
      const br = 6 + (i % 3) * 4;
      ctx.fillStyle = "rgba(255, 212, 59, 0.1)";
      ctx.beginPath(); ctx.arc(bx, by, br, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // 상단 HUD 오버레이
  ctx.save();
  ctx.fillStyle = isPouring ? "rgba(0, 161, 228, 0.32)" : (isWaiting ? "rgba(245, 159, 0, 0.3)" : "rgba(255, 255, 255, 0.1)");
  ctx.strokeStyle = isPouring ? "#4dabf7" : (isWaiting ? "#ffd43b" : "rgba(255, 255, 255, 0.25)");
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(12, 10, W - 24, 54, 10); ctx.fill(); ctx.stroke();

  ctx.fillStyle = "#ffffff"; ctx.font = "900 13.5px sans-serif"; ctx.textAlign = "center";
  ctx.fillText(hudTitle || "추출 대기 중", cx, 30);

  ctx.fillStyle = isPouring ? "#a5d8ff" : "#ffe066"; ctx.font = "700 11px sans-serif";
  ctx.fillText(hudSub || "", cx, 48);
  ctx.restore();

  // 구즈넥 주전자 스파우트 & 물줄기
  ctx.save();
  if (isPouring) {
    const spoutSway = Math.sin(elapsed * 5.2) * 16;
    ctx.strokeStyle = "#adb5bd"; ctx.lineWidth = 9; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(W - 10, 78); ctx.quadraticCurveTo(cx + 55, 96, cx + spoutSway, 86); ctx.stroke();

    const streamGrad = ctx.createLinearGradient(cx, 88, cx, 150);
    streamGrad.addColorStop(0, "rgba(165, 216, 255, 0.98)");
    streamGrad.addColorStop(1, "rgba(51, 154, 240, 0.85)");
    ctx.strokeStyle = streamGrad; ctx.lineWidth = 4.5;
    ctx.beginPath(); ctx.moveTo(cx + spoutSway, 88); ctx.quadraticCurveTo(cx + spoutSway * 0.4, 118, cx + spoutSway * 0.5, 150); ctx.stroke();
  } else {
    ctx.strokeStyle = "rgba(173, 181, 189, 0.4)"; ctx.lineWidth = 7; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(W + 10, 72); ctx.quadraticCurveTo(W - 20, 80, W - 42, 74); ctx.stroke();
  }
  ctx.restore();

  // 하단 3D 전자저울 (시간 및 물 무게 표시)
  const scaleY = 372;
  const scaleW = 330;
  const scaleH = 64;
  const scaleX = cx - scaleW / 2;

  ctx.save();
  const scaleBodyGrad = ctx.createLinearGradient(0, scaleY, 0, scaleY + scaleH);
  scaleBodyGrad.addColorStop(0, "#212529"); scaleBodyGrad.addColorStop(1, "#0b0d0e");
  ctx.fillStyle = scaleBodyGrad; ctx.strokeStyle = isPouring ? "#00a1e4" : (isWaiting ? "#f59f00" : "#495057");
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(scaleX, scaleY, scaleW, scaleH, 12); ctx.fill(); ctx.stroke();

  // 좌측 타이머 LED
  ctx.fillStyle = "#05070a"; ctx.strokeStyle = "#1864ab"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(scaleX + 12, scaleY + 9, 140, 46, 6); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#74c0fc"; ctx.font = "800 10px sans-serif"; ctx.textAlign = "left";
  ctx.fillText("TIME", scaleX + 20, scaleY + 22);
  ctx.fillStyle = elapsed < 0 ? "#ff8787" : "#3bc9db"; ctx.font = "900 21px monospace";
  ctx.fillText(formatMMSS(elapsed), scaleX + 20, scaleY + 47);

  // 우측 무게 LED
  ctx.fillStyle = "#05070a"; ctx.strokeStyle = "#2b8a3e";
  ctx.beginPath(); ctx.roundRect(scaleX + scaleW - 152, scaleY + 9, 140, 46, 6); ctx.fill(); ctx.stroke();
  ctx.fillStyle = isPouring ? "#66d9e8" : "#8ce99a"; ctx.font = "800 10px sans-serif"; ctx.textAlign = "right";
  ctx.fillText(isPouring ? "POURING..." : "WEIGHT (g)", scaleX + scaleW - 20, scaleY + 22);
  ctx.fillStyle = "#ffd43b"; ctx.font = "900 21px monospace";
  ctx.fillText(`${Math.round(currentWater)} g`, scaleX + scaleW - 20, scaleY + 47);
  ctx.restore();

  // 서버 & 커피 수면 (비이커 위 글씨 완전 제거)
  const srvTopY = 242;
  const srvBotY = 362;
  const srvTopW = 50;
  const srvBotW = 76;

  const fillRatio = Math.min(0.84, waterRatio * 0.84);
  const liquidH = (srvBotY - srvTopY) * fillRatio;
  const liquidTopY = srvBotY - liquidH;
  const liquidTopW = srvTopW + (srvBotW - srvTopW) * ((liquidTopY - srvTopY) / (srvBotY - srvTopY));

  if (liquidH > 3) {
    ctx.save();
    const cofGrad = ctx.createLinearGradient(cx - srvBotW, liquidTopY, cx + srvBotW, srvBotY);
    cofGrad.addColorStop(0, "#8c481e"); cofGrad.addColorStop(0.5, "#4a200a"); cofGrad.addColorStop(1, "#1f0b02");
    ctx.fillStyle = cofGrad;
    ctx.beginPath();
    ctx.moveTo(cx - liquidTopW, liquidTopY); ctx.lineTo(cx + liquidTopW, liquidTopY);
    ctx.lineTo(cx + srvBotW, srvBotY); ctx.lineTo(cx - srvBotW, srvBotY);
    ctx.closePath(); ctx.fill();

    ctx.fillStyle = "#b06d3b";
    ctx.beginPath(); ctx.ellipse(cx, liquidTopY, liquidTopW, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // 드리퍼에서 서버로 떨어지는 추출 줄기
  if (elapsed > 2 && waterRatio < 1.0) {
    ctx.save();
    ctx.strokeStyle = "#b06d3b"; ctx.lineWidth = isPouring ? 3 : 2;
    ctx.setLineDash(isPouring ? [8, 4] : [4, 8]);
    ctx.lineDashOffset = -elapsed * 50;
    const holes = currentDripper === "kalita" ? [cx - 10, cx, cx + 10] : [cx];
    holes.forEach(hx => {
      ctx.beginPath(); ctx.moveTo(hx, 226); ctx.lineTo(hx, liquidTopY); ctx.stroke();
    });
    ctx.restore();
  }

  // 유리 서버 외곽선
  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.4)"; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - srvTopW, srvTopY); ctx.lineTo(cx - srvBotW, srvBotY);
  ctx.moveTo(cx + srvTopW, srvTopY); ctx.lineTo(cx + srvBotW, srvBotY);
  ctx.stroke();
  ctx.beginPath(); ctx.ellipse(cx, srvBotY, srvBotW, 10, 0, 0, Math.PI); ctx.stroke();
  ctx.restore();

  // 드리퍼 (비이커/드리퍼 위 글씨 완전 제거)
  const dTopY = 120;
  const dBotY = 226;
  const dTopW = 86;
  const dBotW = currentDripper === "hario" ? 20 : 48;

  ctx.save();
  const bodyGrad = ctx.createLinearGradient(cx - dTopW, dTopY, cx + dTopW, dTopY);
  bodyGrad.addColorStop(0, "#dee2e6"); bodyGrad.addColorStop(0.35, "#ffffff"); bodyGrad.addColorStop(1, "#adb5bd");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(cx - dTopW, dTopY); ctx.lineTo(cx + dTopW, dTopY);
  ctx.lineTo(cx + dBotW, dBotY); ctx.lineTo(cx - dBotW, dBotY);
  ctx.closePath(); ctx.fill();

  ctx.fillStyle = d.themeDark;
  ctx.beginPath(); ctx.roundRect(cx - 64, dBotY - 2, 128, 8, 3); ctx.fill();

  // 커피 베드 (블루밍)
  ctx.fillStyle = "#3b2210";
  ctx.beginPath(); ctx.ellipse(cx, dTopY, dTopW, 15, 0, 0, Math.PI * 2); ctx.fill();

  const bloomSwell = elapsed > 0 ? Math.sin(elapsed * 3) * 2 + (isPouring ? 3.5 : 1) : 0;
  const foamGrad = ctx.createRadialGradient(cx - 10, dTopY - 2, 4, cx, dTopY, dTopW * 0.8);
  foamGrad.addColorStop(0, isPouring ? "#cfe8ff" : "#e6ccb2");
  foamGrad.addColorStop(0.5, "#9c6644");
  foamGrad.addColorStop(1, "#582f0e");
  ctx.fillStyle = foamGrad;
  ctx.beginPath(); ctx.ellipse(cx, dTopY + 2, dTopW * 0.82, 11 + bloomSwell, 0, 0, Math.PI * 2); ctx.fill();

  ctx.strokeStyle = d.themeColor; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.ellipse(cx, dTopY, dTopW, 15, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}


