import {
  db,
  collection,
  doc,
  updateDoc,
  onSnapshot,
  writeBatch,
  getDocs
} from "./firebase-config.js";
import { INITIAL_STUDENTS, INITIAL_EVENTS } from "./data.js";

// ==================== GLOBAL STATE ====================
let studentsList = [];
let eventsList = [];
let activeTab = "upload";
let activeClassFilter = "อ.2";
let activeEventAgeFilter = "all";
let activeResultFilter = "all";

// Cropper state
let cropperInstance = null;
let currentCropTarget = { studentId: null, field: null }; // field: 'photoData' | 'docData'

// Lineup Modal state
let currentEditingEvent = null;
let tempAthletes = []; // array of { slotLabel, studentId }
let allowedClassesInModal = new Set();

const ALL_CLASSES = ["อ.2", "อ.3", "ป.1", "ป.2", "ป.3", "ป.4", "ป.5", "ป.6"];
const AGE_GROUPS = [6, 8, 10, 12];
const GENDERS = ["ชาย", "หญิง"];

// Distinct Print Themes by Age Group (6: Pink, 8: Blue, 10: Orange, 12: Green)
const AGE_PRINT_THEMES = {
  6: {
    label: "รุ่น 6 ปี (อนุบาล)",
    primary: "#be185d",
    gradient: "linear-gradient(135deg, #9d174d, #db2777)",
    light: "#fdf2f8",
    border: "#f9a8d4",
    text: "#9d174d",
    subtext: "#fce7f3"
  },
  8: {
    label: "รุ่น 8 ปี",
    primary: "#1d4ed8",
    gradient: "linear-gradient(135deg, #1e40af, #2563eb)",
    light: "#eff6ff",
    border: "#93c5fd",
    text: "#1e40af",
    subtext: "#dbeafe"
  },
  10: {
    label: "รุ่น 10 ปี",
    primary: "#c2410c",
    gradient: "linear-gradient(135deg, #c2410c, #ea580c)",
    light: "#fff7ed",
    border: "#fdba74",
    text: "#9a3412",
    subtext: "#ffedd5"
  },
  12: {
    label: "รุ่น 12 ปี",
    primary: "#15803d",
    gradient: "linear-gradient(135deg, #166534, #16a34a)",
    light: "#f0fdf4",
    border: "#86efac",
    text: "#166534",
    subtext: "#dcfce7"
  }
};

// ==================== HELPERS ====================
function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatThaiTimeArabic(date = new Date()) {
  try {
    return new Intl.DateTimeFormat("th-TH-u-nu-latn", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace("T", " ");
  }
}

function getCurrentTeacherName() {
  const saved = localStorage.getItem("soden_teacher_name");
  return (saved && saved.trim()) || "ครูนภรัฐ อุดเต็น";
}

window.saveTeacherName = function (val) {
  const clean = (val || "").trim() || "ครูนภรัฐ อุดเต็น";
  localStorage.setItem("soden_teacher_name", clean);
  const input = document.getElementById("teacherNameInput");
  if (input) input.value = clean;
  const hint = document.getElementById("lineupModalEditorHint");
  if (hint) hint.textContent = `บันทึกในชื่อ: ${clean}`;
  showToast(`ตั้งชื่อครูผู้ใช้งานเป็น "${clean}" แล้ว`);
};

function initTeacherNameInput() {
  const input = document.getElementById("teacherNameInput");
  if (input) {
    input.value = getCurrentTeacherName();
  }
}

// ==================== INIT & FIREBASE SYNC ====================
async function initApp() {
  initTeacherNameInput();

  window.addEventListener("afterprint", () => {
    document.body.dataset.printTarget = "a4";
  });

  try {
    updateSyncStatus("⏳ กำลังตรวจสอบฐานข้อมูล...", "amber");

    const stdSnap = await getDocs(collection(db, "students"));
    if (stdSnap.empty) {
      updateSyncStatus("📥 กำลังนำเข้ารายชื่อนักเรียน 76 คนและ 50 รายการ...", "orange");
      await seedInitialDatabase();
    } else {
      const evSnap = await getDocs(collection(db, "events"));
      if (evSnap.empty) {
        await seedEventsOnly();
      }
    }

    onSnapshot(collection(db, "students"), (snapshot) => {
      studentsList = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.no || 0) - (b.no || 0));
      refreshUI();
      updateSyncStatus("🟢 เชื่อมต่อฐานข้อมูลออนไลน์แล้ว", "green");
    });

    onSnapshot(collection(db, "events"), (snapshot) => {
      eventsList = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.no || 0) - (b.no || 0));
      refreshUI();
    });
  } catch (err) {
    console.error("Firebase init error:", err);
    updateSyncStatus("⚠️ ทำงานแบบออฟไลน์ (กำลังใช้ข้อมูลในเครื่อง)", "red");
    studentsList = [...INITIAL_STUDENTS];
    eventsList = [...INITIAL_EVENTS];
    refreshUI();
  }
}

async function seedInitialDatabase() {
  const batch = writeBatch(db);
  INITIAL_STUDENTS.forEach((std) => {
    batch.set(doc(db, "students", std.id), std);
  });
  INITIAL_EVENTS.forEach((ev) => {
    batch.set(doc(db, "events", ev.id), ev);
  });
  await batch.commit();
}

async function seedEventsOnly() {
  const batch = writeBatch(db);
  INITIAL_EVENTS.forEach((ev) => {
    batch.set(doc(db, "events", ev.id), ev);
  });
  await batch.commit();
}

function updateSyncStatus(text, color) {
  const el = document.getElementById("syncStatus");
  if (!el) return;
  el.textContent = text;
  const styles = {
    amber: "bg-amber-100 text-amber-800",
    orange: "bg-orange-100 text-orange-800",
    green: "bg-emerald-100 text-emerald-800",
    red: "bg-red-100 text-red-800"
  };
  el.className = `text-xs px-2.5 py-1 rounded-full font-medium ${styles[color] || styles.amber}`;
}

function showToast(msg) {
  const el = document.getElementById("toastMsg");
  if (!el) return;
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 2800);
}

// ==================== COMPUTED HELPERS ====================
function getStudentWorkloadMap() {
  const map = {};
  studentsList.forEach((s) => (map[s.id] = []));
  eventsList.forEach((ev) => {
    (ev.athletes || []).forEach((a) => {
      if (a.studentId && map[a.studentId]) {
        map[a.studentId].push({
          eventId: ev.id,
          eventNo: ev.no,
          eventName: ev.name,
          slotLabel: a.slotLabel,
          ageGroup: ev.ageGroup,
          category: ev.category
        });
      }
    });
  });
  return map;
}

function refreshUI() {
  if (activeTab === "upload") renderUploadTab();
  if (activeTab === "lineup") renderLineupTab();
  if (activeTab === "summary") renderSummaryTab();
  if (activeTab === "print") renderPrintPages();
  if (activeTab === "results") renderResultsTab();
}

// ==================== TAB SWITCHING ====================
window.switchTab = function (tabName) {
  activeTab = tabName;
  ["upload", "lineup", "summary", "print", "results"].forEach((t) => {
    const sec = document.getElementById(`tab-${t}`);
    const btn = document.getElementById(`tab-btn-${t}`);
    if (sec) sec.classList.toggle("hidden", t !== tabName);
    if (btn) {
      if (t === tabName) {
        btn.classList.add("border-orange-600", "text-orange-700", "bg-white");
        btn.classList.remove("border-transparent", "text-zinc-600");
      } else {
        btn.classList.remove("border-orange-600", "text-orange-700", "bg-white");
        btn.classList.add("border-transparent", "text-zinc-600");
      }
    }
  });
  refreshUI();
};

// ==================== TAB 1: UPLOAD PHOTOS & EVIDENCE ====================
function renderUploadTab() {
  const btnContainer = document.getElementById("classFilterButtons");
  if (!btnContainer) return;

  btnContainer.innerHTML = ALL_CLASSES.map((cls) => {
    const classStds = studentsList.filter((s) => s.className === cls);
    const completeCnt = classStds.filter((s) => s.photoData && s.docData).length;
    const isActive = activeClassFilter === cls;
    return `
      <button onclick="setClassFilter('${cls}')"
        class="px-3 py-1.5 rounded-lg text-sm font-bold transition flex items-center gap-1.5 ${
          isActive
            ? "bg-orange-600 text-white shadow-sm"
            : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
        }">
        <span>${cls}</span>
        <span class="text-xs px-1.5 py-0.5 rounded-full ${
          isActive ? "bg-orange-800 text-orange-100" : "bg-white text-zinc-600"
        }">${completeCnt}/${classStds.length}</span>
      </button>
    `;
  }).join("");

  const totalComplete = studentsList.filter((s) => s.photoData && s.docData).length;
  document.getElementById("uploadProgressBadge").textContent =
    `หลักฐานครบแล้ว ${totalComplete} / ${studentsList.length} คน`;

  const filtered = studentsList.filter((s) => s.className === activeClassFilter);
  const grid = document.getElementById("studentUploadGrid");
  grid.innerHTML = filtered
    .map((s) => {
      const hasPhoto = Boolean(s.photoData);
      const hasDoc = Boolean(s.docData);
      const isComplete = hasPhoto && hasDoc;

      return `
      <div class="bg-white rounded-xl border ${isComplete ? "border-emerald-300" : "border-zinc-200"} shadow-sm overflow-hidden flex flex-col">
        <div class="px-4 py-2.5 ${isComplete ? "bg-emerald-50" : "bg-zinc-50"} border-b border-zinc-200 flex justify-between items-center">
          <div>
            <div class="font-bold text-zinc-900 text-base">${escapeHtml(s.fullName)}</div>
            <div class="text-xs text-zinc-500">ชั้น ${escapeHtml(s.className)} เลขที่ ${escapeHtml(s.classNo)} • เกิด ${escapeHtml(s.dob)} (เกณฑ์ ${s.minAgeGroup} ปี)</div>
          </div>
          <span class="text-xs font-bold px-2 py-1 rounded-full ${
            isComplete
              ? "bg-emerald-100 text-emerald-800"
              : "bg-amber-100 text-amber-800"
          }">
            ${isComplete ? "🟢 ครบแล้ว" : "🟡 รออัปโหลด"}
          </span>
        </div>

        <div class="p-3.5 grid grid-cols-2 gap-3 flex-1">
          <!-- Photo Box -->
          <div class="flex flex-col items-center gap-1.5">
            <div class="text-xs font-bold text-zinc-700">รูปหน้าตรง (3:4)</div>
            <div class="w-full aspect-[3/4] max-h-36 bg-zinc-100 border border-dashed border-zinc-300 rounded-lg overflow-hidden flex items-center justify-center">
              ${
                hasPhoto
                  ? `<img src="${s.photoData}" class="w-full h-full object-cover" alt="รูปนักเรียน">`
                  : `<span class="text-xs text-zinc-400 text-center px-2">ยังไม่มีรูปถ่าย</span>`
              }
            </div>
            <label class="w-full text-center cursor-pointer bg-orange-50 hover:bg-orange-100 text-orange-800 border border-orange-200 rounded-lg py-1.5 text-xs font-bold">
              ${hasPhoto ? "🔄 เปลี่ยนรูป" : "📷 ถ่าย / เลือกรูป"}
              <input type="file" accept="image/*" class="hidden" onchange="handleFileSelect(event, '${s.id}', 'photoData')">
            </label>
          </div>

          <!-- Evidence Box -->
          <div class="flex flex-col items-center gap-1.5">
            <select onchange="updateStudentDocType('${s.id}', this.value)"
              class="w-full text-xs font-bold text-zinc-700 border border-zinc-300 rounded px-1.5 py-0.5 bg-white">
              <option value="บัตรประจำตัวประชาชน" ${s.docType === "บัตรประจำตัวประชาชน" ? "selected" : ""}>บัตรประจำตัวประชาชน</option>
              <option value="สำเนาทะเบียนบ้าน" ${s.docType === "สำเนาทะเบียนบ้าน" ? "selected" : ""}>สำเนาทะเบียนบ้าน</option>
              <option value="สูติบัตร" ${s.docType === "สูติบัตร" ? "selected" : ""}>สูติบัตร (ใบเกิด)</option>
            </select>

            <div class="w-full aspect-[1.58/1] max-h-36 bg-zinc-100 border border-dashed border-zinc-300 rounded-lg overflow-hidden flex items-center justify-center">
              ${
                hasDoc
                  ? `<img src="${s.docData}" class="w-full h-full object-contain bg-white" alt="หลักฐาน">`
                  : `<span class="text-xs text-zinc-400 text-center px-2">ยังไม่มีหลักฐาน</span>`
              }
            </div>
            <label class="w-full text-center cursor-pointer bg-zinc-100 hover:bg-zinc-200 text-zinc-800 border border-zinc-300 rounded-lg py-1.5 text-xs font-bold mt-auto">
              ${hasDoc ? "🔄 เปลี่ยนหลักฐาน" : "🪪 ถ่าย / เลือกเอกสาร"}
              <input type="file" accept="image/*" class="hidden" onchange="handleFileSelect(event, '${s.id}', 'docData')">
            </label>
          </div>
        </div>
      </div>
    `;
    })
    .join("");
}

window.setClassFilter = function (cls) {
  activeClassFilter = cls;
  renderUploadTab();
};

window.updateStudentDocType = async function (studentId, newType) {
  try {
    await updateDoc(doc(db, "students", studentId), { docType: newType });
    showToast(`เปลี่ยนประเภทหลักฐานเป็น "${newType}" แล้ว`);
  } catch (e) {
    console.error(e);
  }
};

// ==================== IMAGE CROPPER & COMPRESSION ====================
window.handleFileSelect = function (event, studentId, field) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = "";

  const std = studentsList.find((s) => s.id === studentId);
  currentCropTarget = { studentId, field };

  const reader = new FileReader();
  reader.onload = function (e) {
    const imgEl = document.getElementById("cropImagePreview");
    imgEl.src = e.target.result;

    let aspect = NaN;
    if (field === "photoData") {
      aspect = 3 / 4;
      document.getElementById("cropModalTitle").textContent = `✂️ ครอปรูปถ่ายหน้าตรง: ${std?.shortName || ""}`;
      document.getElementById("cropModalSubtitle").textContent = "ล็อกสัดส่วนมาตรฐาน 3:4 สำหรับติดใบลงทะเบียน";
    } else {
      const docType = std?.docType || "บัตรประจำตัวประชาชน";
      if (docType === "บัตรประจำตัวประชาชน") {
        aspect = 1.586;
        document.getElementById("cropModalSubtitle").textContent = "ล็อกสัดส่วนบัตรประจำตัวประชาชนอัตโนมัติ (1.58:1)";
      } else {
        aspect = 1.414;
        document.getElementById("cropModalSubtitle").textContent = `จัดกรอบสำหรับ "${docType}" (สามารถปรับเป็นอิสระได้)`;
      }
      document.getElementById("cropModalTitle").textContent = `✂️ ครอปหลักฐาน (${docType}): ${std?.shortName || ""}`;
    }

    const modal = document.getElementById("cropModal");
    modal.classList.remove("hidden");
    modal.classList.add("flex");

    if (cropperInstance) cropperInstance.destroy();
    cropperInstance = new Cropper(imgEl, {
      aspectRatio: aspect,
      viewMode: 1,
      autoCropArea: 0.9,
      responsive: true
    });
  };
  reader.readAsDataURL(file);
};

window.rotateCropper = function (deg) {
  if (cropperInstance) cropperInstance.rotate(deg);
};

window.setCropAspect = function (mode) {
  if (cropperInstance) cropperInstance.setAspectRatio(mode === "free" ? NaN : 1.586);
};

window.closeCropModal = function () {
  const modal = document.getElementById("cropModal");
  modal.classList.add("hidden");
  modal.classList.remove("flex");
  if (cropperInstance) {
    cropperInstance.destroy();
    cropperInstance = null;
  }
};

window.saveCroppedImage = async function () {
  if (!cropperInstance) return;
  const btn = document.getElementById("saveCropBtn");
  btn.disabled = true;
  btn.textContent = "⏳ กำลังบีบอัดและบันทึก...";

  try {
    const isPhoto = currentCropTarget.field === "photoData";
    const maxW = isPhoto ? 420 : 850;
    const maxH = isPhoto ? 560 : 680;

    const canvas = cropperInstance.getCroppedCanvas({
      maxWidth: maxW,
      maxHeight: maxH,
      fillColor: "#ffffff",
      imageSmoothingEnabled: true,
      imageSmoothingQuality: "high"
    });

    const compressedBase64 = canvas.toDataURL("image/jpeg", 0.78);
    const updateObj = {};
    updateObj[currentCropTarget.field] = compressedBase64;

    await updateDoc(doc(db, "students", currentCropTarget.studentId), updateObj);
    showToast("✅ บันทึกรูปภาพเรียบร้อยแล้ว!");
    closeCropModal();
  } catch (err) {
    console.error("Save crop error:", err);
    alert("เกิดข้อผิดพลาดในการบันทึก กรุณาลองใหม่อีกครั้ง");
  } finally {
    btn.disabled = false;
    btn.textContent = "💾 บันทึกรูปลงระบบ";
  }
};

// ==================== TAB 2: LINEUP BUILDER (COLLABORATIVE) ====================
function renderLineupTab() {
  const assignedCount = eventsList.filter((e) => (e.athletes || []).some((a) => a.studentId)).length;
  const badge = document.getElementById("lineupProgressBadge");
  if (badge) badge.textContent = `จัดตัวแล้ว ${assignedCount} / ${eventsList.length} รายการ`;
  renderEventsList();
}

window.setEventAgeFilter = function (age) {
  activeEventAgeFilter = age;
  document.querySelectorAll(".ev-age-btn").forEach((b) => {
    const match = String(b.dataset.age) === String(age);
    b.className = `ev-age-btn px-3 py-1.5 rounded-lg text-sm font-semibold ${
      match ? "bg-orange-600 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
    }`;
  });
  renderEventsList();
};

window.renderEventsList = function () {
  const search = (document.getElementById("eventSearchInput")?.value || "").trim().toLowerCase();
  const statusFilter = document.getElementById("eventStatusFilter")?.value || "all";

  const filtered = eventsList.filter((ev) => {
    if (activeEventAgeFilter !== "all" && Number(ev.ageGroup) !== Number(activeEventAgeFilter)) return false;
    if (search && !ev.name.toLowerCase().includes(search)) return false;
    const assignedCnt = (ev.athletes || []).filter((a) => a.studentId).length;
    if (statusFilter === "pending" && assignedCnt >= ev.mainSlots) return false;
    if (statusFilter === "done" && assignedCnt < ev.mainSlots) return false;
    return true;
  });

  const container = document.getElementById("eventsListContainer");
  if (!container) return;

  container.innerHTML = filtered
    .map((ev) => {
      const assigned = (ev.athletes || []).filter((a) => a.studentId);
      const isComplete = assigned.length >= ev.mainSlots;
      const isHighChance = ev.totalTeams <= 5;
      const slotsDesc = ev.category === "วิ่งผลัด" ? `ตัวจริง ${ev.mainSlots} ไม้` : "ตัวจริง 1 คน";

      const assignedBadges = assigned
        .map((a) => {
          const st = studentsList.find((s) => s.id === a.studentId);
          return `<span class="inline-block bg-orange-50 text-orange-900 border border-orange-200 text-xs px-2 py-0.5 rounded">${escapeHtml(a.slotLabel)}: ${escapeHtml(st ? st.shortName : "-")}</span>`;
        })
        .join(" ");

      const updatedTag = ev.updatedBy
        ? `<div class="text-[11px] text-zinc-500 mt-1">✍️ จัดล่าสุดโดย: <strong class="text-zinc-700">${escapeHtml(ev.updatedBy)}</strong> ${ev.updatedAt ? `(${escapeHtml(ev.updatedAt)})` : ""}</div>`
        : "";

      return `
      <div class="bg-white rounded-xl border ${isComplete ? "border-emerald-300" : "border-zinc-200"} p-3.5 shadow-sm flex flex-col justify-between gap-2.5">
        <div>
          <div class="flex justify-between items-start gap-2">
            <span class="text-xs font-bold px-2 py-0.5 rounded bg-zinc-700 text-white">รุ่น ${ev.ageGroup} ปี • ${escapeHtml(ev.category)}</span>
            <span class="text-xs font-bold px-2 py-0.5 rounded ${isHighChance ? "bg-amber-100 text-amber-800" : "bg-zinc-100 text-zinc-700"}">
              ${escapeHtml(ev.group)} | ช่อง ${escapeHtml(ev.lane)} (${ev.totalTeams} ทีม${isHighChance ? " ⭐" : ""})
            </span>
          </div>
          <h3 class="font-bold text-zinc-900 text-base mt-1.5">${ev.no}. ${escapeHtml(ev.name)}</h3>
          <p class="text-xs text-zinc-500 mt-0.5">คู่แข่ง: ${escapeHtml(ev.competitors || "-")}</p>
          <div class="mt-2 flex flex-wrap gap-1">
            ${assignedBadges || `<span class="text-xs text-zinc-400 italic">ยังไม่ได้จัดตัวนักกีฬา (${slotsDesc})</span>`}
          </div>
          ${updatedTag}
        </div>

        <button onclick="openLineupModal('${ev.id}')" class="w-full py-1.5 rounded-lg text-sm font-bold ${
          isComplete
            ? "bg-emerald-50 text-emerald-800 border border-emerald-300 hover:bg-emerald-100"
            : "bg-orange-600 text-white hover:bg-orange-700"
        }">
          ${isComplete ? "✏️ แก้ไข / ช่วยปรับรายชื่อ" : "➕ จัดตัวนักกีฬาลงรายการนี้"}
        </button>
      </div>
    `;
    })
    .join("");
};

// ==================== LINEUP MODAL (FLEXIBLE AGE/CLASS + QUICK-TAP) ====================
window.openLineupModal = function (eventId) {
  const ev = eventsList.find((e) => e.id === eventId);
  if (!ev) return;

  currentEditingEvent = ev;
  document.getElementById("lineupModalTitle").textContent = `${ev.no}. ${ev.name}`;
  document.getElementById("lineupModalMeta").textContent =
    `${ev.group} • ช่องวิ่งที่ ${ev.lane} • คู่แข่ง ${ev.totalTeams} ทีม${ev.updatedBy ? ` • จัดล่าสุดโดย ${ev.updatedBy}` : ""}`;
  document.getElementById("lineupModalEditorHint").textContent = `บันทึกในชื่อ: ${getCurrentTeacherName()}`;

  const slots = [];
  if (ev.mainSlots === 1) {
    slots.push({ slotLabel: "ตัวจริง", studentId: "" });
    slots.push({ slotLabel: "สำรอง 1", studentId: "" });
  } else {
    for (let i = 1; i <= ev.mainSlots; i++) {
      slots.push({ slotLabel: `ไม้ ${i}`, studentId: "" });
    }
    for (let r = 1; r <= ev.reserveSlots; r++) {
      slots.push({ slotLabel: `สำรอง ${r}`, studentId: "" });
    }
  }

  (ev.athletes || []).forEach((saved) => {
    const target = slots.find((s) => s.slotLabel === saved.slotLabel);
    if (target) target.studentId = saved.studentId;
  });
  tempAthletes = slots;

  allowedClassesInModal = new Set();
  if (ev.ageGroup === 6) {
    ["อ.2", "อ.3", "ป.1"].forEach((c) => allowedClassesInModal.add(c));
  } else if (ev.ageGroup === 8) {
    ["อ.3", "ป.1", "ป.2", "ป.3"].forEach((c) => allowedClassesInModal.add(c));
  } else if (ev.ageGroup === 10) {
    ["ป.2", "ป.3", "ป.4", "ป.5"].forEach((c) => allowedClassesInModal.add(c));
  } else {
    ["ป.4", "ป.5", "ป.6"].forEach((c) => allowedClassesInModal.add(c));
  }

  document.getElementById("lineupGenderFilter").value = ev.gender === "รวม" ? "all" : "match";
  document.getElementById("candidateSearchInput").value = "";

  renderLineupClassCheckboxes();
  renderLineupSlots();
  renderLineupCandidates();

  const modal = document.getElementById("lineupModal");
  modal.classList.remove("hidden");
  modal.classList.add("flex");
};

window.closeLineupModal = function () {
  const modal = document.getElementById("lineupModal");
  modal.classList.add("hidden");
  modal.classList.remove("flex");
  currentEditingEvent = null;
};

function renderLineupClassCheckboxes() {
  const container = document.getElementById("lineupClassCheckboxes");
  container.innerHTML = ALL_CLASSES.map((cls) => {
    const checked = allowedClassesInModal.has(cls) ? "checked" : "";
    return `
      <label class="inline-flex items-center gap-1 bg-white border border-orange-200 px-2 py-1 rounded cursor-pointer font-semibold text-zinc-700">
        <input type="checkbox" ${checked} onchange="toggleClassInModal('${cls}', this.checked)" class="rounded text-orange-600">
        <span>${cls}</span>
      </label>
    `;
  }).join("");
}

window.toggleClassInModal = function (cls, isChecked) {
  if (isChecked) allowedClassesInModal.add(cls);
  else allowedClassesInModal.delete(cls);
  renderLineupCandidates();
};

function renderLineupSlots() {
  const container = document.getElementById("lineupSlotsList");
  container.innerHTML = tempAthletes
    .map((slot, idx) => {
      const st = studentsList.find((s) => s.id === slot.studentId);
      const isReserve = slot.slotLabel.includes("สำรอง");
      return `
      <div class="flex items-center justify-between border rounded-xl p-2.5 ${
        st ? "bg-orange-50 border-orange-300" : isReserve ? "bg-amber-50/40 border-dashed border-amber-300" : "bg-zinc-50 border-dashed border-zinc-300"
      }">
        <div class="flex items-center gap-2.5">
          <span class="text-xs font-bold px-2 py-1 rounded ${isReserve ? "bg-amber-200 text-amber-900" : "bg-zinc-700 text-white"}">
            ${escapeHtml(slot.slotLabel)}
          </span>
          ${
            st
              ? `<div class="flex items-center gap-2">
                  ${st.photoData ? `<img src="${st.photoData}" class="w-8 h-10 object-cover rounded border">` : ""}
                  <div>
                    <div class="font-bold text-sm text-zinc-900">${escapeHtml(st.shortName)}</div>
                    <div class="text-[11px] text-zinc-500">ชั้น ${escapeHtml(st.className)} • เกิด ${escapeHtml(st.dob)}</div>
                  </div>
                 </div>`
              : `<span class="text-xs text-zinc-400">คลิกเลือกชื่อนักเรียนทางขวา...</span>`
          }
        </div>
        ${
          st
            ? `<button onclick="removeAthleteFromSlot(${idx})" class="text-red-500 hover:bg-red-100 rounded-lg px-2 py-1 text-xs font-bold">ลบ</button>`
            : ""
        }
      </div>
    `;
    })
    .join("");
}

window.removeAthleteFromSlot = function (idx) {
  tempAthletes[idx].studentId = "";
  renderLineupSlots();
  renderLineupCandidates();
};

window.clearEventSlots = function () {
  tempAthletes.forEach((s) => (s.studentId = ""));
  renderLineupSlots();
  renderLineupCandidates();
};

window.renderLineupCandidates = function () {
  if (!currentEditingEvent) return;
  const ev = currentEditingEvent;
  const genderMode = document.getElementById("lineupGenderFilter").value;
  const search = (document.getElementById("candidateSearchInput").value || "").trim().toLowerCase();
  const workloadMap = getStudentWorkloadMap();
  const alreadyPicked = new Set(tempAthletes.map((a) => a.studentId).filter(Boolean));

  const candidates = studentsList
    .filter((s) => {
      if (!allowedClassesInModal.has(s.className)) return false;
      if (genderMode === "match" && ev.gender !== "รวม" && s.gender !== ev.gender) return false;
      if (search && !s.fullName.toLowerCase().includes(search)) return false;
      return true;
    })
    .sort((a, b) => {
      const aFits = a.minAgeGroup <= ev.ageGroup ? 0 : 1;
      const bFits = b.minAgeGroup <= ev.ageGroup ? 0 : 1;
      if (aFits !== bFits) return aFits - bFits;
      return (b.birthYear || 0) - (a.birthYear || 0);
    });

  const container = document.getElementById("lineupCandidatesList");
  container.innerHTML = candidates
    .map((s) => {
      const isPicked = alreadyPicked.has(s.id);
      const isEligible = s.minAgeGroup <= ev.ageGroup;
      const isBonusOlderClass =
        isEligible &&
        ((ev.ageGroup === 6 && s.className === "ป.1") ||
          (ev.ageGroup === 8 && s.className === "ป.3") ||
          (ev.ageGroup === 10 && s.className === "ป.5"));

      const eventCount = (workloadMap[s.id] || []).length;
      const hasEvidence = s.photoData && s.docData;

      return `
      <button onclick="${isPicked ? "" : `assignAthleteQuick('${s.id}')`}"
        ${isPicked ? "disabled" : ""}
        class="w-full text-left border rounded-xl p-2 flex items-center justify-between gap-2 transition ${
          isPicked
            ? "bg-zinc-100 border-zinc-200 opacity-50 cursor-not-allowed"
            : isEligible
            ? "bg-white border-zinc-200 hover:border-orange-500 hover:bg-orange-50/60 cursor-pointer"
            : "bg-red-50/40 border-red-200 hover:bg-red-50 cursor-pointer"
        }">
        <div class="flex items-center gap-2.5">
          ${
            s.photoData
              ? `<img src="${s.photoData}" class="w-9 h-11 object-cover rounded border border-zinc-300">`
              : `<div class="w-9 h-11 bg-zinc-200 rounded flex items-center justify-center text-[10px] text-zinc-500">ไม่มีรูป</div>`
          }
          <div>
            <div class="font-bold text-sm text-zinc-900 flex flex-wrap items-center gap-1">
              <span>${escapeHtml(s.shortName)} (${escapeHtml(s.className)})</span>
              ${isBonusOlderClass ? `<span class="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-bold">⭐ พี่แต่อายุถึง!</span>` : ""}
              ${!isEligible ? `<span class="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold">⚠️ เกินเกณฑ์ (${s.minAgeGroup} ปี)</span>` : ""}
            </div>
            <div class="text-[11px] text-zinc-500">เกิด ${escapeHtml(s.dob)} • ${hasEvidence ? "🟢 หลักฐานครบ" : "🟡 ขาดรูป/บัตร"}</div>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <span class="text-xs font-bold px-2 py-0.5 rounded-full ${eventCount >= 3 ? "bg-red-100 text-red-700" : "bg-zinc-100 text-zinc-700"}">
            🏃 ${eventCount} รายการ
          </span>
          <span class="text-xs font-bold text-orange-700">${isPicked ? "✓ เลือกแล้ว" : "+ เพิ่ม"}</span>
        </div>
      </button>
    `;
    })
    .join("");
};

window.assignAthleteQuick = function (studentId) {
  const emptySlot = tempAthletes.find((s) => !s.studentId);
  if (!emptySlot) {
    showToast("⚠️ ครบทุกตำแหน่งแล้ว หากต้องการเปลี่ยนให้ลบออกก่อนครับ");
    return;
  }
  emptySlot.studentId = studentId;
  renderLineupSlots();
  renderLineupCandidates();
};

window.saveLineup = async function () {
  if (!currentEditingEvent) return;
  try {
    const cleanAthletes = tempAthletes.filter((s) => s.studentId);
    const editorName = getCurrentTeacherName();
    await updateDoc(doc(db, "events", currentEditingEvent.id), {
      athletes: cleanAthletes,
      updatedBy: editorName,
      updatedAt: formatThaiTimeArabic()
    });
    showToast(`✅ บันทึกรายชื่อเรียบร้อย (โดย ${editorName})`);
    closeLineupModal();
  } catch (err) {
    console.error("Save lineup error:", err);
    alert("เกิดข้อผิดพลาดในการบันทึก กรุณาลองใหม่");
  }
};

// ==================== TAB 3: ATHLETE WORKLOAD SUMMARY ====================
function getFilteredSummaryRows() {
  const workloadMap = getStudentWorkloadMap();
  const classFilter = document.getElementById("summaryClassFilter")?.value || "all";
  const ageFilter = document.getElementById("summaryAgeFilter")?.value || "all";
  const statusFilter = document.getElementById("summaryStatusFilter")?.value || "all";
  const sortOrder = document.getElementById("summarySortOrder")?.value || "count_desc";
  const search = (document.getElementById("summarySearchInput")?.value || "").trim().toLowerCase();

  let rows = studentsList.map((s) => ({
    student: s,
    events: workloadMap[s.id] || []
  }));

  rows = rows.filter(({ student, events }) => {
    if (classFilter !== "all" && student.className !== classFilter) return false;
    if (ageFilter !== "all" && Number(student.minAgeGroup) !== Number(ageFilter)) return false;
    if (statusFilter === "active" && events.length === 0) return false;
    if (statusFilter === "idle" && events.length > 0) return false;
    if (statusFilter === "heavy" && events.length < 3) return false;
    if (search && !student.fullName.toLowerCase().includes(search)) return false;
    return true;
  });

  if (sortOrder === "count_desc") {
    rows.sort((a, b) => b.events.length - a.events.length || (a.student.no || 0) - (b.student.no || 0));
  } else {
    rows.sort((a, b) => (a.student.no || 0) - (b.student.no || 0));
  }

  return rows;
}

window.renderSummaryTab = function () {
  const workloadMap = getStudentWorkloadMap();
  const totalStudents = studentsList.length;
  const activeCount = studentsList.filter((s) => (workloadMap[s.id] || []).length >= 1).length;
  const heavyCount = studentsList.filter((s) => (workloadMap[s.id] || []).length >= 3).length;
  const idleCount = totalStudents - activeCount;

  const totalEl = document.getElementById("sum-total-students");
  if (!totalEl) return;
  totalEl.textContent = totalStudents;
  document.getElementById("sum-active-athletes").textContent = activeCount;
  document.getElementById("sum-idle-athletes").textContent = idleCount;
  document.getElementById("sum-heavy-athletes").textContent = heavyCount;

  const rows = getFilteredSummaryRows();
  const tbody = document.getElementById("summaryTableBody");

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-8 text-center text-zinc-400">ไม่พบข้อมูลนักเรียนตามตัวกรองที่เลือก</td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map(({ student: s, events }, idx) => {
      const hasEvidence = Boolean(s.photoData && s.docData);
      const cnt = events.length;
      const cntBadge =
        cnt === 0
          ? `<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-zinc-100 text-zinc-500">0 รายการ</span>`
          : cnt >= 3
          ? `<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">🔥 ${cnt} รายการ</span>`
          : `<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-orange-100 text-orange-800">🏃 ${cnt} รายการ</span>`;

      const eventTags = events
        .map(
          (ev) => `
          <span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border border-zinc-300 bg-zinc-50 text-zinc-800">
            <span class="font-bold text-orange-700">${ev.eventNo}.</span>
            <span>${escapeHtml(ev.eventName)}</span>
            <span class="text-[10px] text-zinc-500">(${escapeHtml(ev.slotLabel)})</span>
          </span>
        `
        )
        .join(" ");

      return `
      <tr class="hover:bg-orange-50/40">
        <td class="px-3 py-2 text-center font-semibold text-zinc-600">${idx + 1}</td>
        <td class="px-3 py-2">
          <div class="flex items-center gap-2.5">
            ${
              s.photoData
                ? `<img src="${s.photoData}" class="w-9 h-11 object-cover rounded border border-zinc-300 flex-shrink-0">`
                : `<div class="w-9 h-11 bg-zinc-200 rounded flex items-center justify-center text-[10px] text-zinc-500 flex-shrink-0">ไม่มีรูป</div>`
            }
            <div>
              <div class="font-bold text-zinc-900">${escapeHtml(s.fullName)}</div>
              <div class="text-xs text-zinc-500">ชั้น ${escapeHtml(s.className)} เลขที่ ${escapeHtml(s.classNo)} • เกิด ${escapeHtml(s.dob)}</div>
            </div>
          </div>
        </td>
        <td class="px-3 py-2 text-center">
          <span class="text-xs font-bold px-2 py-0.5 rounded bg-zinc-100 text-zinc-700">รุ่น ${s.minAgeGroup} ปี</span>
        </td>
        <td class="px-3 py-2 text-center">
          <span class="text-xs font-bold px-2 py-0.5 rounded-full ${hasEvidence ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}">
            ${hasEvidence ? "🟢 ครบ" : "🟡 รอรูป/บัตร"}
          </span>
        </td>
        <td class="px-3 py-2 text-center">${cntBadge}</td>
        <td class="px-3 py-2">
          <div class="flex flex-wrap gap-1">${eventTags || `<span class="text-xs text-zinc-400 italic">ยังไม่ได้ลงแข่งขัน</span>`}</div>
        </td>
      </tr>
    `;
    })
    .join("");
};

window.printSummarySheet = function () {
  const rows = getFilteredSummaryRows();
  const printArea = document.getElementById("summaryPrintArea");
  if (!printArea) return;

  const chunkSize = 18;
  const chunks = [];
  for (let i = 0; i < rows.length; i += chunkSize) {
    chunks.push(rows.slice(i, i + chunkSize));
  }
  if (chunks.length === 0) chunks.push([]);

  printArea.innerHTML = chunks
    .map((chunk, pageIdx) => {
      const isLast = pageIdx === chunks.length - 1;
      const trHtml = chunk
        .map(({ student: s, events }, idx) => {
          const rowNum = pageIdx * chunkSize + idx + 1;
          const evList = events.map((ev) => `${ev.eventName} [${ev.slotLabel}]`).join(", ");
          return `
          <tr>
            <td class="border border-zinc-400 px-1.5 py-1 text-center">${rowNum}</td>
            <td class="border border-zinc-400 px-2 py-1 font-semibold">${escapeHtml(s.fullName)}</td>
            <td class="border border-zinc-400 px-1.5 py-1 text-center">${escapeHtml(s.className)}</td>
            <td class="border border-zinc-400 px-1.5 py-1 text-center">รุ่น ${s.minAgeGroup} ปี</td>
            <td class="border border-zinc-400 px-1.5 py-1 text-center font-bold">${events.length}</td>
            <td class="border border-zinc-400 px-2 py-1 text-xs">${escapeHtml(evList || "-")}</td>
          </tr>
        `;
        })
        .join("");

      return `
      <div class="a4-page">
        <div>
          <div class="flex justify-between items-center border-b-2 border-orange-600 pb-1.5 mb-2">
            <span class="bg-zinc-800 text-white text-xs font-bold px-2.5 py-0.5 rounded">โรงเรียนบ้านส้อเด่นพัฒนา (ส.ด.)</span>
            <span class="text-sm font-bold text-zinc-900">สรุปรายชื่อและจำนวนรายการแข่งขันนักกรีฑารายบุคคล 2569</span>
            <span class="text-xs font-semibold text-zinc-600">ผู้จัดทำ: <strong class="text-orange-700">ครูนภรัฐ อุดเต็น</strong></span>
          </div>

          <div class="master-banner px-4 py-1.5 flex justify-between items-center mb-2.5">
            <div class="text-sm font-bold text-white">ตารางสรุปนักกีฬา (หน้า ${pageIdx + 1}/${chunks.length})</div>
            <div class="text-xs text-orange-100">รวมทั้งหมด ${rows.length} คน</div>
          </div>

          <table class="w-full border-collapse text-xs">
            <thead>
              <tr class="bg-zinc-800 text-white">
                <th class="border border-zinc-800 px-1.5 py-1.5 w-8">ที่</th>
                <th class="border border-zinc-800 px-2 py-1.5 w-44">ชื่อ - นามสกุล</th>
                <th class="border border-zinc-800 px-1.5 py-1.5 w-12">ชั้น</th>
                <th class="border border-zinc-800 px-1.5 py-1.5 w-16">เกณฑ์</th>
                <th class="border border-zinc-800 px-1.5 py-1.5 w-14">จำนวน</th>
                <th class="border border-zinc-800 px-2 py-1.5">รายการที่ลงแข่งขัน</th>
              </tr>
            </thead>
            <tbody>
              ${trHtml || `<tr><td colspan="6" class="border border-zinc-400 p-4 text-center text-zinc-400">ไม่มีข้อมูล</td></tr>`}
            </tbody>
          </table>
        </div>

        ${
          isLast
            ? renderDirectorSingleFooterBox()
            : `<div></div>`
        }
      </div>
    `;
    })
    .join("");

  document.body.dataset.printTarget = "summary";
  window.print();
};

// ==================== TAB 4: PRINT A4 STUDIO (SEPARATED ROSTER + PACKED EVIDENCE) ====================
window.printA4Documents = function () {
  document.body.dataset.printTarget = "a4";
  window.print();
};

function renderEvidenceBottomSignature() {
  return `
    <div class="mt-2 flex justify-end">
      <div class="text-center text-[11px] leading-tight text-zinc-900 w-64">
        <div class="mb-3">ขอรับรองว่าเป็นนักเรียนโรงเรียนบ้านส้อเด่นพัฒนาจริง</div>
        <div>ลงชื่อ ....................................................</div>
        <div class="font-bold mt-0.5">( นายนพคุณ เกรียงศักดานุกูล )</div>
        <div class="text-[10px]">ผู้อำนวยการโรงเรียนบ้านส้อเด่นพัฒนา</div>
      </div>
    </div>
  `;
}

function renderDirectorSingleFooterBox() {
  return `
    <div class="mt-3 flex justify-end">
      <div class="px-4 py-1 text-center text-xs w-72 text-zinc-900">
        <div class="mb-5">ขอรับรองว่าเป็นนักเรียนโรงเรียนบ้านส้อเด่นพัฒนาจริง</div>
        <div>ลงชื่อ ............................................................</div>
        <div class="font-bold mt-0.5">( นายนพคุณ เกรียงศักดานุกูล )</div>
        <div class="text-[11px]">ผู้อำนวยการโรงเรียนบ้านส้อเด่นพัฒนา</div>
      </div>
    </div>
  `;
}

function renderFormalHeader(theme, titleText, bannerLeft, bannerRight) {
  return `
    <div>
      <div class="flex justify-between items-center pb-1 mb-1.5" style="border-bottom: 2px solid ${theme.primary};">
        <span class="text-white font-bold text-[11px] px-2.5 py-0.5 rounded" style="background: ${theme.primary};">โรงเรียนบ้านส้อเด่นพัฒนา (ส.ด.)</span>
        <span class="text-xs sm:text-sm font-bold" style="color: ${theme.text};">${escapeHtml(titleText)}</span>
        <span class="text-[11px] font-semibold text-zinc-600">ผู้จัดทำ: <strong style="color: ${theme.text};">ครูนภรัฐ อุดเต็น</strong></span>
      </div>
      <div class="px-3.5 py-1.5 rounded-lg flex flex-wrap justify-between items-center mb-2 text-white" style="background: ${theme.gradient};">
        <div class="text-sm font-bold">${escapeHtml(bannerLeft)}</div>
        <div class="text-[11px]" style="color: ${theme.subtext};">${escapeHtml(bannerRight)}</div>
      </div>
    </div>
  `;
}

function getEvidenceCategoryKey(docType) {
  if (docType === "สูติบัตร") return "birth";
  if (docType === "สำเนาทะเบียนบ้าน") return "house";
  return "id";
}

function renderEvidenceItemCard(item, theme) {
  const st = item.student;
  const docType = st.docType || "บัตรประจำตัวประชาชน";
  const catKey = item.catKey;
  const cardClass = catKey === "birth" ? "ev-card-birth" : catKey === "house" ? "ev-card-house" : "ev-card-id";
  const imgClass = catKey === "birth" ? "ev-img-birth" : catKey === "house" ? "ev-img-house" : "ev-img-id";

  return `
    <div class="${cardClass}" style="border: 1px solid ${theme.border};">
      <div class="flex justify-between items-center gap-1 px-1 pb-0.5" style="border-bottom: 1px solid ${theme.border}; background: ${theme.light};">
        <div class="font-bold text-[10px] truncate" style="color: ${theme.text};">
          ${item.orderNo}. ${escapeHtml(st.shortName)} (${escapeHtml(st.className)})
        </div>
        <div class="text-[9px] text-zinc-600 truncate max-w-[50%] text-right" title="${escapeHtml(item.eventSummary)}">
          ${escapeHtml(docType)} • ${escapeHtml(item.eventSummary)}
        </div>
      </div>
      <div class="flex-1 flex items-center justify-center overflow-hidden bg-white">
        ${
          st.docData
            ? `<img src="${st.docData}" class="${imgClass}" alt="${escapeHtml(docType)}">`
            : `<div class="text-xs text-zinc-400 text-center">ยังไม่อัปโหลด${escapeHtml(docType)}</div>`
        }
      </div>
    </div>
  `;
}

// Smart A4 Evidence Packer:
// - Up to 8 ID cards per page (2 cols x 4 rows, 54mm each = 222mm)
// - Compact borderless Director signature (22mm) fits right below 8 ID cards on the SAME page (222+22=244mm <= 262mm)
// - Guarantees signature NEVER orphans onto an extra blank page by itself
// - Mixes small ID cards first, then House Reg (~2x ID, 106mm), then Birth Cert (114mm)
function buildEvidencePagesHtml(packageTitle, ageGroup, evidenceItems) {
  if (!evidenceItems || evidenceItems.length === 0) return "";
  const theme = AGE_PRINT_THEMES[ageGroup] || AGE_PRINT_THEMES[10];

  const orderRank = { id: 1, house: 2, birth: 3 };
  const typedItems = evidenceItems
    .map((entry, idx) => {
      const catKey = getEvidenceCategoryKey(entry.student.docType);
      return {
        kind: "student",
        orderNo: idx + 1,
        student: entry.student,
        eventSummary: entry.eventSummary,
        catKey,
        spanCols: catKey === "id" ? 1 : 2,
        rowHeight: catKey === "birth" ? 114 : catKey === "house" ? 106 : 54
      };
    })
    .sort((a, b) => orderRank[a.catKey] - orderRank[b.catKey] || a.orderNo - b.orderNo);

  // Pack items into grid rows
  const rows = [];
  let i = 0;
  while (i < typedItems.length) {
    const cur = typedItems[i];
    if (cur.spanCols === 2) {
      rows.push({ height: cur.rowHeight, items: [cur] });
      i += 1;
    } else {
      const next = typedItems[i + 1];
      if (next && next.spanCols === 1) {
        rows.push({ height: 54, items: [cur, next] });
        i += 2;
      } else {
        rows.push({ height: 54, items: [cur] });
        i += 1;
      }
    }
  }

  // Pack rows onto A4 pages (usable height below top bar = 264mm; signature reserve = 23mm)
  const MAX_PAGE_HEIGHT = 264;
  const SIG_HEIGHT = 23;
  const ROW_GAP = 2;
  const pages = []; // { rows, height }
  let currentRows = [];
  let currentHeight = 0;

  rows.forEach((row) => {
    const added = currentRows.length === 0 ? row.height : row.height + ROW_GAP;
    if (currentRows.length > 0 && currentHeight + added > MAX_PAGE_HEIGHT) {
      pages.push({ rows: currentRows, height: currentHeight });
      currentRows = [row];
      currentHeight = row.height;
    } else {
      currentRows.push(row);
      currentHeight += added;
    }
  });
  if (currentRows.length > 0) pages.push({ rows: currentRows, height: currentHeight });

  // Prevent signature from bouncing onto an extra page alone:
  // If last page exceeds MAX_PAGE_HEIGHT - SIG_HEIGHT, move its final row to a new final page with the signature
  const lastPage = pages[pages.length - 1];
  if (lastPage && lastPage.height + SIG_HEIGHT > MAX_PAGE_HEIGHT && lastPage.rows.length > 1) {
    const movedRow = lastPage.rows.pop();
    lastPage.height -= movedRow.height + ROW_GAP;
    pages.push({ rows: [movedRow], height: movedRow.height });
  }

  return pages
    .map((page, pageIdx) => {
      const isLast = pageIdx === pages.length - 1;
      const cardsHtml = page.rows
        .flatMap((r) => r.items)
        .map((item) => renderEvidenceItemCard(item, theme))
        .join("");

      return `
      <div class="a4-evidence-page">
        <!-- Slim top bar only (No bottom footer to maximize space) -->
        <div class="flex justify-between items-center px-2.5 py-1 rounded mb-1.5 text-white" style="background: ${theme.gradient};">
          <div class="text-xs font-bold truncate">
            ส.ด. 2569 • หลักฐาน: ${escapeHtml(packageTitle)} (แผ่นที่ ${pageIdx + 1}/${pages.length})
          </div>
          <div class="text-[11px] whitespace-nowrap" style="color: ${theme.subtext};">
            ผู้จัดทำ: ครูนภรัฐ อุดเต็น
          </div>
        </div>

        <div class="evidence-grid">
          ${cardsHtml}
        </div>

        ${isLast ? renderEvidenceBottomSignature() : ""}
      </div>
    `;
    })
    .join("");
}

function renderPortraitPhotoSection(uniqueStudents, theme) {
  if (!uniqueStudents || uniqueStudents.length === 0) return "";
  const useFiveCols = uniqueStudents.length > 8;
  const gridClass = useFiveCols ? "portrait-grid portrait-grid-5" : "portrait-grid portrait-grid-4";
  const imgClass = useFiveCols ? "portrait-img-md" : "portrait-img-lg";

  const cardsHtml = uniqueStudents
    .map((st) => {
      return `
      <div class="portrait-card">
        ${
          st.photoData
            ? `<img src="${st.photoData}" class="${imgClass}" alt="${escapeHtml(st.shortName)}">`
            : `<div class="${imgClass} flex items-center justify-center text-[10px] text-zinc-400">ไม่มีรูปถ่าย</div>`
        }
        <div class="text-[11px] font-bold text-zinc-900 mt-1 leading-tight">${escapeHtml(st.shortName)}</div>
      </div>
    `;
    })
    .join("");

  return `
    <div class="mt-2.5">
      <div class="text-xs font-bold px-2.5 py-1 rounded text-white inline-block mb-1" style="background: ${theme.primary};">
        📸 รูปถ่ายนักกีฬา (${uniqueStudents.length} คน)
      </div>
      <div class="${gridClass}">
        ${cardsHtml}
      </div>
    </div>
  `;
}

function getUniqueStudentsFromRows(rows) {
  const seen = new Map();
  rows.forEach((r) => {
    if (r.student && !seen.has(r.student.id)) {
      seen.set(r.student.id, r.student);
    }
  });
  return Array.from(seen.values());
}

function buildRosterTableRowsHtml(rows, theme, showEventCol) {
  if (rows.length === 0) {
    return `<tr><td colspan="${showEventCol ? 7 : 6}" class="border border-zinc-400 p-3 text-center text-zinc-400">ยังไม่ได้จัดตัวนักกีฬา</td></tr>`;
  }

  return rows
    .map((r, idx) => {
      const st = r.student;
      if (!st) {
        if (showEventCol) {
          return `
          <tr>
            <td class="border border-zinc-400 px-1.5 py-1 text-center">${idx + 1}</td>
            <td class="border border-zinc-400 px-2 py-1 font-semibold text-zinc-600">${escapeHtml(r.labelCol)}</td>
            <td class="border border-zinc-400 px-1.5 py-1 text-center font-bold">${escapeHtml(r.slotLabel)}</td>
            <td class="border border-zinc-400 px-2 py-1 text-zinc-400 italic" colspan="4">ยังไม่ได้จัดตัวนักกีฬา</td>
          </tr>
        `;
        }
        return `
          <tr>
            <td class="border border-zinc-400 px-1.5 py-1 text-center">${idx + 1}</td>
            <td class="border border-zinc-400 px-1.5 py-1 text-center font-bold">${escapeHtml(r.slotLabel)}</td>
            <td class="border border-zinc-400 px-2 py-1 text-zinc-400 italic" colspan="4">ยังไม่ได้จัดตัวนักกีฬา</td>
          </tr>
        `;
      }

      return `
      <tr>
        <td class="border border-zinc-400 px-1.5 py-1 text-center font-semibold">${idx + 1}</td>
        ${
          showEventCol
            ? `<td class="border border-zinc-400 px-2 py-1 text-xs font-semibold text-zinc-800">${escapeHtml(r.labelCol)} <span class="text-[10px] text-zinc-500 font-normal">(${escapeHtml(r.group)} • ช่อง ${escapeHtml(r.lane)})</span></td>`
            : `<td class="border border-zinc-400 px-1.5 py-1 text-center font-bold" style="color: ${theme.text};">${escapeHtml(r.slotLabel)}</td>`
        }
        ${
          showEventCol
            ? `<td class="border border-zinc-400 px-1.5 py-1 text-center text-xs font-bold" style="color: ${theme.text};">${escapeHtml(r.slotLabel)}</td>`
            : ""
        }
        <td class="border border-zinc-400 px-2 py-1 font-semibold text-zinc-900">${escapeHtml(st.fullName)}</td>
        <td class="border border-zinc-400 px-1.5 py-1 text-center">${escapeHtml(st.className)}</td>
        <td class="border border-zinc-400 px-1.5 py-1 text-center text-xs">${escapeHtml(st.dob)}</td>
        <td class="border border-zinc-400 px-1.5 py-1 text-center text-xs">${escapeHtml(st.citizenId || "-")}</td>
      </tr>
    `;
    })
    .join("");
}

function buildIndividualTablesHtml(trackRows, fieldRows, theme) {
  const trackSectionHtml =
    trackRows.length > 0
      ? `
    <div class="mb-2">
      <div class="text-xs font-bold px-2.5 py-1 rounded-t text-white" style="background: ${theme.primary};">
        🏃 หมวด ก: ประเภทลู่ (วิ่งเดี่ยว)
      </div>
      <table class="w-full border-collapse text-xs">
        <thead>
          <tr style="background: ${theme.light}; color: ${theme.text};">
            <th class="border border-zinc-400 px-1 py-1 w-7">ที่</th>
            <th class="border border-zinc-400 px-1.5 py-1 w-48">รายการแข่งขัน</th>
            <th class="border border-zinc-400 px-1 py-1 w-14">ตำแหน่ง</th>
            <th class="border border-zinc-400 px-1.5 py-1">ชื่อ - นามสกุล</th>
            <th class="border border-zinc-400 px-1 py-1 w-10">ชั้น</th>
            <th class="border border-zinc-400 px-1 py-1 w-20">ว/ด/ป เกิด</th>
            <th class="border border-zinc-400 px-1 py-1 w-28">เลขประชาชน</th>
          </tr>
        </thead>
        <tbody>
          ${buildRosterTableRowsHtml(trackRows, theme, true)}
        </tbody>
      </table>
    </div>
  `
      : "";

  const fieldSectionHtml =
    fieldRows.length > 0
      ? `
    <div class="mb-2">
      <div class="text-xs font-bold px-2.5 py-1 rounded-t text-white" style="background: ${theme.primary};">
        🎯 หมวด ข: ประเภทลาน (กระโดดไกล / ทุ่มน้ำหนัก / เตะบอล)
      </div>
      <table class="w-full border-collapse text-xs">
        <thead>
          <tr style="background: ${theme.light}; color: ${theme.text};">
            <th class="border border-zinc-400 px-1 py-1 w-7">ที่</th>
            <th class="border border-zinc-400 px-1.5 py-1 w-48">รายการแข่งขัน</th>
            <th class="border border-zinc-400 px-1 py-1 w-14">ตำแหน่ง</th>
            <th class="border border-zinc-400 px-1.5 py-1">ชื่อ - นามสกุล</th>
            <th class="border border-zinc-400 px-1 py-1 w-10">ชั้น</th>
            <th class="border border-zinc-400 px-1 py-1 w-20">ว/ด/ป เกิด</th>
            <th class="border border-zinc-400 px-1 py-1 w-28">เลขประชาชน</th>
          </tr>
        </thead>
        <tbody>
          ${buildRosterTableRowsHtml(fieldRows, theme, true)}
        </tbody>
      </table>
    </div>
  `
      : "";

  return `${trackSectionHtml}${fieldSectionHtml}`;
}

function renderIndividualPackagePages(ageGroup, gender, trackEvents, fieldEvents, includeEvidence) {
  const theme = AGE_PRINT_THEMES[ageGroup] || AGE_PRINT_THEMES[10];
  const pkgTitle = `รายการแข่งเดี่ยว รุ่น ${ageGroup} ปี ${gender}`;

  const toRowEntries = (evList) => {
    const out = [];
    evList.forEach((ev) => {
      const assigned = (ev.athletes || []).filter((a) => a.studentId);
      if (assigned.length === 0) {
        out.push({
          labelCol: ev.name,
          slotLabel: "ตัวจริง",
          group: ev.group,
          lane: ev.lane,
          student: null
        });
      } else {
        assigned.forEach((a) => {
          const st = studentsList.find((s) => s.id === a.studentId);
          out.push({
            labelCol: ev.name,
            slotLabel: a.slotLabel,
            group: ev.group,
            lane: ev.lane,
            student: st || null
          });
        });
      }
    });
    return out;
  };

  const trackRows = toRowEntries(trackEvents).map((r) => ({ ...r, section: "track" }));
  const fieldRows = toRowEntries(fieldEvents).map((r) => ({ ...r, section: "field" }));
  const allRows = [...trackRows, ...fieldRows];
  const uniqueStudents = getUniqueStudentsFromRows(allRows);

  // Estimate whether tables + separated portrait grid + signature fit on 1 A4 page (~270mm)
  const tablesEstH =
    22 +
    (trackRows.length > 0 ? 14 : 0) +
    (fieldRows.length > 0 ? 14 : 0) +
    allRows.length * 7;
  const cols = uniqueStudents.length > 8 ? 5 : 4;
  const portraitRowsCnt = uniqueStudents.length > 0 ? Math.ceil(uniqueStudents.length / cols) : 0;
  const portraitsEstH = portraitRowsCnt > 0 ? 10 + portraitRowsCnt * (cols === 4 ? 51 : 45) : 0;
  const signatureEstH = 26;

  let html = "";

  if (tablesEstH + portraitsEstH + signatureEstH <= 270) {
    // Everything (Top Tables + Large Bottom Portrait Grid + ผอ. Signature) fits on 1 page!
    html += `
      <div class="a4-page">
        <div>
          ${renderFormalHeader(
            theme,
            "แบบส่งรายชื่อนักกรีฑา ประเภทเดี่ยว (แยกลู่และลาน)",
            pkgTitle,
            "เชียงกลางเกมส์ ปีการศึกษา 2569"
          )}
          ${buildIndividualTablesHtml(trackRows, fieldRows, theme)}
          ${renderPortraitPhotoSection(uniqueStudents, theme)}
        </div>
        ${renderDirectorSingleFooterBox()}
      </div>
    `;
  } else {
    // Split tables cleanly on page 1a, portraits + signature on page 1b (paginating tables if huge)
    const MAX_TABLE_ROWS = 24;
    const chunks = [];
    for (let i = 0; i < allRows.length; i += MAX_TABLE_ROWS) {
      chunks.push(allRows.slice(i, i + MAX_TABLE_ROWS));
    }
    if (chunks.length === 0) chunks.push([]);

    chunks.forEach((chunk, idx) => {
      const cTrack = chunk.filter((r) => r.section === "track");
      const cField = chunk.filter((r) => r.section === "field");
      html += `
        <div class="a4-page">
          <div>
            ${renderFormalHeader(
              theme,
              "แบบส่งรายชื่อนักกรีฑา ประเภทเดี่ยว (แยกลู่และลาน)",
              `${pkgTitle}${chunks.length > 1 ? ` (ตาราง ${idx + 1}/${chunks.length})` : ""}`,
              "เชียงกลางเกมส์ ปีการศึกษา 2569"
            )}
            ${buildIndividualTablesHtml(cTrack, cField, theme)}
          </div>
          ${uniqueStudents.length === 0 && idx === chunks.length - 1 ? renderDirectorSingleFooterBox() : `<div></div>`}
        </div>
      `;
    });

    if (uniqueStudents.length > 0) {
      // Chunk portraits max 20 per page
      const MAX_PORTRAITS = 20;
      for (let p = 0; p < uniqueStudents.length; p += MAX_PORTRAITS) {
        const pSlice = uniqueStudents.slice(p, p + MAX_PORTRAITS);
        const isLastP = p + MAX_PORTRAITS >= uniqueStudents.length;
        html += `
          <div class="a4-page">
            <div>
              ${renderFormalHeader(
                theme,
                "รูปถ่ายนักกรีฑา ประเภทเดี่ยว",
                `${pkgTitle} — รูปถ่ายนักกีฬา`,
                "เชียงกลางเกมส์ ปีการศึกษา 2569"
              )}
              ${renderPortraitPhotoSection(pSlice, theme)}
            </div>
            ${isLastP ? renderDirectorSingleFooterBox() : `<div></div>`}
          </div>
        `;
      }
    }
  }

  if (includeEvidence) {
    const uniqueMap = new Map();
    [...trackEvents, ...fieldEvents].forEach((ev) => {
      (ev.athletes || []).forEach((a) => {
        if (!a.studentId) return;
        const st = studentsList.find((s) => s.id === a.studentId);
        if (!st) return;
        const tag = `${ev.name.replace(/\s+รุ่น\s+\d+\s+ปี.*/, "")} (${a.slotLabel})`;
        if (!uniqueMap.has(st.id)) {
          uniqueMap.set(st.id, { student: st, tags: [tag] });
        } else {
          uniqueMap.get(st.id).tags.push(tag);
        }
      });
    });

    const evidenceItems = Array.from(uniqueMap.values()).map((entry) => ({
      student: entry.student,
      eventSummary: entry.tags.join(", ")
    }));

    html += buildEvidencePagesHtml(pkgTitle, ageGroup, evidenceItems);
  }

  return html;
}

function renderRelayPackagePages(ev, includeEvidence) {
  const theme = AGE_PRINT_THEMES[ev.ageGroup] || AGE_PRINT_THEMES[10];
  const assigned = (ev.athletes || []).filter((a) => a.studentId);

  const rosterRows = assigned.map((a) => ({
    labelCol: ev.name,
    slotLabel: a.slotLabel,
    group: ev.group,
    lane: ev.lane,
    student: studentsList.find((s) => s.id === a.studentId) || null
  }));
  const uniqueStudents = getUniqueStudentsFromRows(rosterRows);

  let html = `
    <div class="a4-page">
      <div>
        ${renderFormalHeader(
          theme,
          "แบบส่งรายชื่อนักกรีฑา ประเภทวิ่งผลัด เชียงกลางเกมส์ 2569",
          `${ev.name}`,
          `${ev.group} • ช่องวิ่งที่ ${ev.lane} (รุ่น ${ev.ageGroup} ปี)`
        )}

        <table class="w-full border-collapse text-xs">
          <thead>
            <tr style="background: ${theme.primary}; color: #ffffff;">
              <th class="border border-zinc-500 px-1.5 py-1.5 w-8">ที่</th>
              <th class="border border-zinc-500 px-1.5 py-1.5 w-16">ตำแหน่ง/ไม้</th>
              <th class="border border-zinc-500 px-2 py-1.5">ชื่อ - นามสกุล นักเรียน</th>
              <th class="border border-zinc-500 px-1.5 py-1.5 w-12">ชั้น</th>
              <th class="border border-zinc-500 px-1.5 py-1.5 w-24">ว/ด/ป เกิด</th>
              <th class="border border-zinc-500 px-1.5 py-1.5 w-32">เลขประจำตัวประชาชน</th>
            </tr>
          </thead>
          <tbody>
            ${buildRosterTableRowsHtml(rosterRows, theme, false)}
          </tbody>
        </table>

        ${renderPortraitPhotoSection(uniqueStudents, theme)}
      </div>

      ${renderDirectorSingleFooterBox()}
    </div>
  `;

  if (includeEvidence && assigned.length > 0) {
    const evidenceItems = assigned
      .map((a) => {
        const st = studentsList.find((s) => s.id === a.studentId);
        if (!st) return null;
        return {
          student: st,
          eventSummary: `${a.slotLabel}`
        };
      })
      .filter(Boolean);

    html += buildEvidencePagesHtml(ev.name, ev.ageGroup, evidenceItems);
  }

  return html;
}

window.renderPrintPages = function () {
  const scope = document.getElementById("printScopeSelect")?.value || "assigned";
  const categoryMode = document.getElementById("printCategorySelect")?.value || "both";
  const includeEvidence = document.getElementById("printIncludeEvidence")?.checked ?? true;

  const container = document.getElementById("printPagesContainer");
  if (!container) return;

  const targetAges = scope.startsWith("age_") ? [Number(scope.replace("age_", ""))] : AGE_GROUPS;
  let pagesHtml = "";

  // 1. Individual Events Packages (Merged per Age + Gender, Track & Field separated)
  if (categoryMode === "both" || categoryMode === "individual") {
    targetAges.forEach((age) => {
      GENDERS.forEach((gender) => {
        let indEvents = eventsList.filter(
          (ev) =>
            Number(ev.ageGroup) === age &&
            ev.gender === gender &&
            ev.category !== "วิ่งผลัด"
        );

        if (scope === "assigned") {
          indEvents = indEvents.filter((ev) => (ev.athletes || []).some((a) => a.studentId));
        }

        if (indEvents.length === 0) return;

        const trackEvents = indEvents.filter((ev) => ev.category === "วิ่งเดี่ยว");
        const fieldEvents = indEvents.filter((ev) => ev.category !== "วิ่งเดี่ยว");

        pagesHtml += renderIndividualPackagePages(age, gender, trackEvents, fieldEvents, includeEvidence);
      });
    });
  }

  // 2. Relay Events Packages (1 package per Relay Event)
  if (categoryMode === "both" || categoryMode === "relay") {
    let relayEvents = eventsList.filter(
      (ev) => ev.category === "วิ่งผลัด" && targetAges.includes(Number(ev.ageGroup))
    );
    if (scope === "assigned") {
      relayEvents = relayEvents.filter((ev) => (ev.athletes || []).some((a) => a.studentId));
    }

    relayEvents.forEach((ev) => {
      pagesHtml += renderRelayPackagePages(ev, includeEvidence);
    });
  }

  if (!pagesHtml) {
    container.innerHTML = `
      <div class="bg-white rounded-xl p-10 text-center text-zinc-500 border border-zinc-200">
        ยังไม่มีรายการแข่งขันที่จัดตัวนักกีฬาในขอบเขตที่เลือกครับ กรุณาไปที่แท็บ <b>"2. จัดตัวนักกีฬา"</b> หรือเปลี่ยนขอบเขตการพิมพ์ด้านบนครับ
      </div>
    `;
    return;
  }

  container.innerHTML = pagesHtml;
};

// ==================== TAB 5: LIVE RESULTS & MEDAL TALLY ====================
function renderResultsTab() {
  const gold = eventsList.filter((e) => e.resultMedal === "gold").length;
  const silver = eventsList.filter((e) => e.resultMedal === "silver").length;
  const bronze = eventsList.filter((e) => e.resultMedal === "bronze").length;

  const gEl = document.getElementById("medal-gold-count");
  if (!gEl) return;
  gEl.textContent = gold;
  document.getElementById("medal-silver-count").textContent = silver;
  document.getElementById("medal-bronze-count").textContent = bronze;
  document.getElementById("medal-total-count").textContent = gold + silver + bronze;

  renderResultsList();
}

window.setResultFilter = function (mode) {
  activeResultFilter = mode;
  document.querySelectorAll(".res-filter-btn").forEach((b) => {
    const match = b.dataset.res === mode;
    b.className = `res-filter-btn px-3 py-1 rounded-lg text-sm font-semibold ${
      match ? "bg-orange-600 text-white" : "bg-zinc-100 text-zinc-700"
    }`;
  });
  renderResultsList();
};

window.renderResultsList = function () {
  const search = (document.getElementById("resultSearchInput")?.value || "").trim().toLowerCase();
  const filtered = eventsList.filter((ev) => {
    const hasResult = Boolean(ev.resultMedal);
    if (activeResultFilter === "completed" && !hasResult) return false;
    if (activeResultFilter === "pending" && hasResult) return false;
    if (search && !ev.name.toLowerCase().includes(search)) return false;
    return true;
  });

  const container = document.getElementById("resultsListContainer");
  if (!container) return;

  container.innerHTML = filtered
    .map((ev) => {
      const m = ev.resultMedal || "";
      const athletesNames = (ev.athletes || [])
        .filter((a) => a.studentId && !a.slotLabel.includes("สำรอง"))
        .map((a) => {
          const st = studentsList.find((s) => s.id === a.studentId);
          return st ? st.shortName : "";
        })
        .filter(Boolean)
        .join(", ");

      return `
      <div class="bg-white rounded-xl border border-zinc-200 p-3 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div class="flex-1 min-w-[220px]">
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold bg-zinc-700 text-white px-2 py-0.5 rounded">รุ่น ${ev.ageGroup} ปี</span>
            <span class="text-xs font-semibold text-zinc-500">${escapeHtml(ev.group)} • ช่อง ${escapeHtml(ev.lane)}</span>
          </div>
          <div class="font-bold text-zinc-900 text-base mt-1">${ev.no}. ${escapeHtml(ev.name)}</div>
          <div class="text-xs text-zinc-500">นักกีฬา: ${escapeHtml(athletesNames || "ยังไม่ระบุตัวจริง")}</div>
        </div>

        <div class="flex flex-wrap items-center gap-1.5">
          <button onclick="saveEventResult('${ev.id}', 'gold')"
            class="px-3 py-1.5 rounded-lg text-xs font-bold border ${m === "gold" ? "bg-amber-400 text-amber-950 border-amber-500 shadow" : "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100"}">
            🥇 ทอง (ที่ 1)
          </button>
          <button onclick="saveEventResult('${ev.id}', 'silver')"
            class="px-3 py-1.5 rounded-lg text-xs font-bold border ${m === "silver" ? "bg-zinc-400 text-white border-zinc-500 shadow" : "bg-zinc-100 text-zinc-700 border-zinc-300 hover:bg-zinc-200"}">
            🥈 เงิน (ที่ 2)
          </button>
          <button onclick="saveEventResult('${ev.id}', 'bronze')"
            class="px-3 py-1.5 rounded-lg text-xs font-bold border ${m === "bronze" ? "bg-orange-500 text-white border-orange-600 shadow" : "bg-orange-50 text-orange-800 border-orange-200 hover:bg-orange-100"}">
            🥉 ทองแดง (ที่ 3)
          </button>
          <button onclick="saveEventResult('${ev.id}', 'other')"
            class="px-3 py-1.5 rounded-lg text-xs font-bold border ${m === "other" ? "bg-zinc-700 text-white border-zinc-800 shadow" : "bg-zinc-50 text-zinc-600 border-zinc-200 hover:bg-zinc-100"}">
            ร่วมแข่ง (4+)
          </button>
          ${
            m
              ? `<button onclick="saveEventResult('${ev.id}', '')" class="px-2 py-1.5 text-xs text-red-500 hover:underline">ล้าง</button>`
              : ""
          }
        </div>
      </div>
    `;
    })
    .join("");
};

window.saveEventResult = async function (eventId, medal) {
  try {
    await updateDoc(doc(db, "events", eventId), { resultMedal: medal });
    const labels = { gold: "🥇 เหรียญทอง", silver: "🥈 เหรียญเงิน", bronze: "🥉 เหรียญทองแดง", other: "บันทึกเข้าร่วม", "": "ล้างผลแล้ว" };
    showToast(`อัปเดตผล: ${labels[medal]}`);
  } catch (err) {
    console.error("Save result error:", err);
  }
};

// Start Application
initApp();
