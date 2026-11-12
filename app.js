import {
  db,
  collection,
  doc,
  setDoc,
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

// ==================== INIT & FIREBASE SYNC ====================
async function initApp() {
  try {
    updateSyncStatus("⏳ กำลังตรวจสอบฐานข้อมูล...", "amber");

    // Check if Firestore already has data; if empty, seed automatically
    const stdSnap = await getDocs(collection(db, "students"));
    if (stdSnap.empty) {
      updateSyncStatus("📥 กำลังนำเข้ารายชื่อนักเรียน 76 คนและ 50 รายการ...", "blue");
      await seedInitialDatabase();
    } else {
      const evSnap = await getDocs(collection(db, "events"));
      if (evSnap.empty) {
        await seedEventsOnly();
      }
    }

    // Listen to students collection in real time
    onSnapshot(collection(db, "students"), (snapshot) => {
      studentsList = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.no || 0) - (b.no || 0));
      refreshUI();
      updateSyncStatus("🟢 เชื่อมต่อฐานข้อมูลออนไลน์แล้ว", "green");
    });

    // Listen to events collection in real time
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
    const ref = doc(db, "students", std.id);
    batch.set(ref, std);
  });
  INITIAL_EVENTS.forEach((ev) => {
    const ref = doc(db, "events", ev.id);
    batch.set(ref, ev);
  });
  await batch.commit();
}

async function seedEventsOnly() {
  const batch = writeBatch(db);
  INITIAL_EVENTS.forEach((ev) => {
    const ref = doc(db, "events", ev.id);
    batch.set(ref, ev);
  });
  await batch.commit();
}

function updateSyncStatus(text, color) {
  const el = document.getElementById("syncStatus");
  if (!el) return;
  el.textContent = text;
  const styles = {
    amber: "bg-amber-100 text-amber-800",
    blue: "bg-blue-100 text-blue-800",
    green: "bg-emerald-100 text-emerald-800",
    red: "bg-red-100 text-red-800"
  };
  el.className = `text-xs px-2.5 py-1 rounded-full font-medium ${styles[color] || styles.amber}`;
}

function showToast(msg) {
  const el = document.getElementById("toastMsg");
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
          eventName: ev.name,
          slotLabel: a.slotLabel,
          ageGroup: ev.ageGroup
        });
      }
    });
  });
  return map;
}

function refreshUI() {
  if (activeTab === "upload") renderUploadTab();
  if (activeTab === "lineup") renderLineupTab();
  if (activeTab === "print") renderPrintPages();
  if (activeTab === "results") renderResultsTab();
}

// ==================== TAB SWITCHING ====================
window.switchTab = function (tabName) {
  activeTab = tabName;
  ["upload", "lineup", "print", "results"].forEach((t) => {
    document.getElementById(`tab-${t}`).classList.toggle("hidden", t !== tabName);
    const btn = document.getElementById(`tab-btn-${t}`);
    if (t === tabName) {
      btn.classList.add("border-blue-700", "text-blue-800");
      btn.classList.remove("border-transparent", "text-slate-600");
    } else {
      btn.classList.remove("border-blue-700", "text-blue-800");
      btn.classList.add("border-transparent", "text-slate-600");
    }
  });
  refreshUI();
};

// ==================== TAB 1: UPLOAD PHOTOS & EVIDENCE ====================
function renderUploadTab() {
  // Class Filter Buttons
  const btnContainer = document.getElementById("classFilterButtons");
  btnContainer.innerHTML = ALL_CLASSES.map((cls) => {
    const classStds = studentsList.filter((s) => s.className === cls);
    const completeCnt = classStds.filter((s) => s.photoData && s.docData).length;
    const isActive = activeClassFilter === cls;
    return `
      <button onclick="setClassFilter('${cls}')"
        class="px-3 py-1.5 rounded-lg text-sm font-bold transition flex items-center gap-1.5 ${
          isActive
            ? "bg-blue-700 text-white shadow-sm"
            : "bg-slate-100 text-slate-700 hover:bg-slate-200"
        }">
        <span>${cls}</span>
        <span class="text-xs px-1.5 py-0.5 rounded-full ${
          isActive ? "bg-blue-900 text-blue-100" : "bg-white text-slate-600"
        }">${completeCnt}/${classStds.length}</span>
      </button>
    `;
  }).join("");

  // Overall progress
  const totalComplete = studentsList.filter((s) => s.photoData && s.docData).length;
  document.getElementById("uploadProgressBadge").textContent =
    `หลักฐานครบแล้ว ${totalComplete} / ${studentsList.length} คน`;

  // Render student cards
  const filtered = studentsList.filter((s) => s.className === activeClassFilter);
  const grid = document.getElementById("studentUploadGrid");
  grid.innerHTML = filtered
    .map((s) => {
      const hasPhoto = Boolean(s.photoData);
      const hasDoc = Boolean(s.docData);
      const isComplete = hasPhoto && hasDoc;

      return `
      <div class="bg-white rounded-xl border ${isComplete ? "border-emerald-300" : "border-slate-200"} shadow-sm overflow-hidden flex flex-col">
        <div class="px-4 py-2.5 ${isComplete ? "bg-emerald-50" : "bg-slate-50"} border-b border-slate-200 flex justify-between items-center">
          <div>
            <div class="font-bold text-slate-900 text-base">${s.fullName}</div>
            <div class="text-xs text-slate-500">ชั้น ${s.className} เลขที่ ${s.classNo} • เกิด ${s.dob} (เกณฑ์ ${s.minAgeGroup} ปี)</div>
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
            <div class="text-xs font-bold text-slate-700">รูปหน้าตรง (3:4)</div>
            <div class="w-full aspect-[3/4] max-h-36 bg-slate-100 border border-dashed border-slate-300 rounded-lg overflow-hidden flex items-center justify-center">
              ${
                hasPhoto
                  ? `<img src="${s.photoData}" class="w-full h-full object-cover" alt="รูปนักเรียน">`
                  : `<span class="text-xs text-slate-400 text-center px-2">ยังไม่มีรูปถ่าย</span>`
              }
            </div>
            <label class="w-full text-center cursor-pointer bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 rounded-lg py-1.5 text-xs font-bold">
              ${hasPhoto ? "🔄 เปลี่ยนรูป" : "📷 ถ่าย / เลือกรูป"}
              <input type="file" accept="image/*" class="hidden" onchange="handleFileSelect(event, '${s.id}', 'photoData')">
            </label>
          </div>

          <!-- Evidence Box (ID / House Reg / Birth Cert) -->
          <div class="flex flex-col items-center gap-1.5">
            <select onchange="updateStudentDocType('${s.id}', this.value)"
              class="w-full text-xs font-bold text-slate-700 border border-slate-300 rounded px-1.5 py-0.5 bg-white">
              <option value="บัตรประจำตัวประชาชน" ${s.docType === "บัตรประจำตัวประชาชน" ? "selected" : ""}>บัตรประจำตัวประชาชน</option>
              <option value="สำเนาทะเบียนบ้าน" ${s.docType === "สำเนาทะเบียนบ้าน" ? "selected" : ""}>สำเนาทะเบียนบ้าน</option>
              <option value="สูติบัตร" ${s.docType === "สูติบัตร" ? "selected" : ""}>สูติบัตร (ใบเกิด)</option>
            </select>

            <div class="w-full aspect-[1.58/1] max-h-36 bg-slate-100 border border-dashed border-slate-300 rounded-lg overflow-hidden flex items-center justify-center">
              ${
                hasDoc
                  ? `<img src="${s.docData}" class="w-full h-full object-contain bg-white" alt="หลักฐาน">`
                  : `<span class="text-xs text-slate-400 text-center px-2">ยังไม่มีหลักฐาน</span>`
              }
            </div>
            <label class="w-full text-center cursor-pointer bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 rounded-lg py-1.5 text-xs font-bold mt-auto">
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

    // Set title and aspect ratio based on document type
    let aspect = NaN;
    if (field === "photoData") {
      aspect = 3 / 4;
      document.getElementById("cropModalTitle").textContent = `✂️ ครอปรูปถ่ายหน้าตรง: ${std?.shortName || ""}`;
      document.getElementById("cropModalSubtitle").textContent = "ล็อกสัดส่วนมาตรฐาน 3:4 สำหรับติดใบลงทะเบียน";
    } else {
      const docType = std?.docType || "บัตรประจำตัวประชาชน";
      if (docType === "บัตรประจำตัวประชาชน") {
        aspect = 1.586; // Standard ID card aspect ratio (85.6mm x 53.98mm)
        document.getElementById("cropModalSubtitle").textContent = "ล็อกสัดส่วนบัตรประจำตัวประชาชนอัตโนมัติ (1.58:1)";
      } else {
        aspect = 1.414; // Landscape A4 / House reg / Birth cert crop
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

    // Compress to JPEG 0.78 quality (~50-140 KB)
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

// ==================== TAB 2: LINEUP BUILDER ====================
function renderLineupTab() {
  const assignedCount = eventsList.filter((e) => (e.athletes || []).some((a) => a.studentId)).length;
  document.getElementById("lineupProgressBadge").textContent = `จัดตัวแล้ว ${assignedCount} / ${eventsList.length} รายการ`;

  // Workload summary
  const workloadMap = getStudentWorkloadMap();
  const workloadHtml = studentsList
    .map((s) => {
      const list = workloadMap[s.id] || [];
      const count = list.length;
      if (count === 0) return "";
      const badgeColor = count >= 4 ? "bg-red-100 text-red-800 border-red-300" : "bg-blue-50 text-blue-900 border-blue-200";
      return `
        <div class="border rounded-lg p-2 ${badgeColor}">
          <div class="font-bold flex justify-between">
            <span>${s.shortName} (${s.className})</span>
            <span>🏃 ${count}</span>
          </div>
          <div class="text-[11px] opacity-80 truncate">${list.map((x) => x.eventName).join(", ")}</div>
        </div>
      `;
    })
    .filter(Boolean)
    .join("");

  document.getElementById("studentWorkloadSummary").innerHTML =
    workloadHtml || `<div class="col-span-full text-slate-400 text-center py-2">ยังไม่มีการจัดตัวนักกีฬาลงรายการ</div>`;

  renderEventsList();
}

window.setEventAgeFilter = function (age) {
  activeEventAgeFilter = age;
  document.querySelectorAll(".ev-age-btn").forEach((b) => {
    const match = String(b.dataset.age) === String(age);
    b.className = `ev-age-btn px-3 py-1.5 rounded-lg text-sm font-semibold ${
      match ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
    }`;
  });
  renderEventsList();
};

window.renderEventsList = function () {
  const search = (document.getElementById("eventSearchInput")?.value || "").trim().toLowerCase();
  const filtered = eventsList.filter((ev) => {
    if (activeEventAgeFilter !== "all" && Number(ev.ageGroup) !== Number(activeEventAgeFilter)) return false;
    if (search && !ev.name.toLowerCase().includes(search)) return false;
    return true;
  });

  const container = document.getElementById("eventsListContainer");
  container.innerHTML = filtered
    .map((ev) => {
      const assigned = (ev.athletes || []).filter((a) => a.studentId);
      const isHighChance = ev.totalTeams <= 5;
      const slotsDesc = ev.category === "วิ่งผลัด" ? `ตัวจริง ${ev.mainSlots} ไม้` : "ตัวจริง 1 คน";

      const assignedBadges = assigned
        .map((a) => {
          const st = studentsList.find((s) => s.id === a.studentId);
          return `<span class="inline-block bg-blue-50 text-blue-900 border border-blue-200 text-xs px-2 py-0.5 rounded">${a.slotLabel}: ${st ? st.shortName : "-"}</span>`;
        })
        .join(" ");

      return `
      <div class="bg-white rounded-xl border ${assigned.length >= ev.mainSlots ? "border-emerald-300" : "border-slate-200"} p-3.5 shadow-sm flex flex-col justify-between gap-2.5">
        <div>
          <div class="flex justify-between items-start gap-2">
            <span class="text-xs font-bold px-2 py-0.5 rounded bg-blue-900 text-white">รุ่น ${ev.ageGroup} ปี • ${ev.category}</span>
            <span class="text-xs font-bold px-2 py-0.5 rounded ${isHighChance ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-700"}">
              ${ev.group} | ช่อง ${ev.lane} (${ev.totalTeams} ทีม${isHighChance ? " ⭐" : ""})
            </span>
          </div>
          <h3 class="font-bold text-slate-900 text-base mt-1.5">${ev.no}. ${ev.name}</h3>
          <p class="text-xs text-slate-500 mt-0.5">คู่แข่ง: ${ev.competitors || "-"}</p>
          <div class="mt-2 flex flex-wrap gap-1">
            ${assignedBadges || `<span class="text-xs text-slate-400 italic">ยังไม่ได้จัดตัวนักกีฬา (${slotsDesc})</span>`}
          </div>
        </div>

        <button onclick="openLineupModal('${ev.id}')" class="w-full py-1.5 rounded-lg text-sm font-bold ${
          assigned.length >= ev.mainSlots
            ? "bg-emerald-50 text-emerald-800 border border-emerald-300 hover:bg-emerald-100"
            : "bg-blue-700 text-white hover:bg-blue-800"
        }">
          ${assigned.length >= ev.mainSlots ? "✏️ แก้ไขรายชื่อนักกีฬา" : "➕ จัดตัวนักกีฬาลงรายการนี้"}
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
    `${ev.group} • ช่องวิ่งที่ ${ev.lane} • มีคู่แข่งรวม ${ev.totalTeams} ทีม`;

  // Build expected slots
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

  // Merge existing assigned athletes
  (ev.athletes || []).forEach((saved) => {
    const target = slots.find((s) => s.slotLabel === saved.slotLabel);
    if (target) target.studentId = saved.studentId;
  });
  tempAthletes = slots;

  // Set default checked classes based on age group (with ability to toggle ป.1 for age 6, etc.)
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
      <label class="inline-flex items-center gap-1 bg-white border border-blue-200 px-2 py-1 rounded cursor-pointer font-semibold text-slate-700">
        <input type="checkbox" ${checked} onchange="toggleClassInModal('${cls}', this.checked)" class="rounded text-blue-600">
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
        st ? "bg-blue-50 border-blue-300" : isReserve ? "bg-amber-50/40 border-dashed border-amber-300" : "bg-slate-50 border-dashed border-slate-300"
      }">
        <div class="flex items-center gap-2.5">
          <span class="text-xs font-bold px-2 py-1 rounded ${isReserve ? "bg-amber-200 text-amber-900" : "bg-blue-800 text-white"}">
            ${slot.slotLabel}
          </span>
          ${
            st
              ? `<div class="flex items-center gap-2">
                  ${st.photoData ? `<img src="${st.photoData}" class="w-8 h-10 object-cover rounded border">` : ""}
                  <div>
                    <div class="font-bold text-sm text-slate-900">${st.shortName}</div>
                    <div class="text-[11px] text-slate-500">ชั้น ${st.className} • เกิด ${st.dob}</div>
                  </div>
                 </div>`
              : `<span class="text-xs text-slate-400">คลิกเลือกชื่อนักเรียนทางขวา...</span>`
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
      // Prioritize students whose birthYear fits the exact event age group!
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
            ? "bg-slate-100 border-slate-200 opacity-50 cursor-not-allowed"
            : isEligible
            ? "bg-white border-slate-200 hover:border-blue-500 hover:bg-blue-50/50 cursor-pointer"
            : "bg-red-50/40 border-red-200 hover:bg-red-50 cursor-pointer"
        }">
        <div class="flex items-center gap-2.5">
          ${
            s.photoData
              ? `<img src="${s.photoData}" class="w-9 h-11 object-cover rounded border border-slate-300">`
              : `<div class="w-9 h-11 bg-slate-200 rounded flex items-center justify-center text-[10px] text-slate-500">ไม่มีรูป</div>`
          }
          <div>
            <div class="font-bold text-sm text-slate-900 flex items-center gap-1">
              <span>${s.shortName} (${s.className})</span>
              ${isBonusOlderClass ? `<span class="text-[10px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-bold">⭐ พี่แต่อายุถึง!</span>` : ""}
              ${!isEligible ? `<span class="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold">⚠️ เกินเกณฑ์ (${s.minAgeGroup} ปี)</span>` : ""}
            </div>
            <div class="text-[11px] text-slate-500">เกิด ${s.dob} • ${hasEvidence ? "🟢 หลักฐานครบ" : "🟡 ขาดรูป/บัตร"}</div>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <span class="text-xs font-bold px-2 py-0.5 rounded-full ${eventCount >= 4 ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-700"}">
            🏃 ${eventCount} รายการ
          </span>
          <span class="text-xs font-bold text-blue-700">${isPicked ? "✓ เลือกแล้ว" : "+ เพิ่ม"}</span>
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
    await updateDoc(doc(db, "events", currentEditingEvent.id), {
      athletes: cleanAthletes
    });
    showToast("✅ บันทึกรายชื่อนักกีฬาเรียบร้อยแล้ว!");
    closeLineupModal();
  } catch (err) {
    console.error("Save lineup error:", err);
    alert("เกิดข้อผิดพลาดในการบันทึก กรุณาลองใหม่");
  }
};

// ==================== TAB 3: PRINT A4 PAGES ====================
window.renderPrintPages = function () {
  const scope = document.getElementById("printScopeSelect").value;
  const includeEvidence = document.getElementById("printIncludeEvidence").checked;

  let targetEvents = eventsList.filter((ev) => {
    if (scope === "assigned") return (ev.athletes || []).some((a) => a.studentId);
    if (scope.startsWith("age_")) {
      const ageNum = Number(scope.replace("age_", ""));
      return Number(ev.ageGroup) === ageNum;
    }
    return true;
  });

  const container = document.getElementById("printPagesContainer");
  if (targetEvents.length === 0) {
    container.innerHTML = `
      <div class="bg-white rounded-xl p-10 text-center text-slate-500 border border-slate-200">
        ยังไม่มีรายการแข่งขันที่จัดตัวนักกีฬาในขอบเขตที่เลือกครับ กรุณาไปที่แท็บ <b>"2. จัดตัวนักกีฬา"</b> ก่อนนะครับ
      </div>
    `;
    return;
  }

  let pagesHtml = "";
  targetEvents.forEach((ev, index) => {
    const assigned = ev.athletes || [];
    const tableRows = assigned
      .map((a, i) => {
        const st = studentsList.find((s) => s.id === a.studentId);
        if (!st) return "";
        return `
        <tr class="border-b border-slate-300">
          <td class="border border-slate-400 px-2 py-2 text-center font-semibold">${i + 1}</td>
          <td class="border border-slate-400 px-2 py-2 text-center font-bold text-blue-900">${a.slotLabel}</td>
          <td class="border border-slate-400 px-2 py-2 font-semibold">${st.fullName}</td>
          <td class="border border-slate-400 px-2 py-2 text-center">${st.className}</td>
          <td class="border border-slate-400 px-2 py-2 text-center">${st.dob}</td>
          <td class="border border-slate-400 px-2 py-2 text-center">${st.citizenId || "-"}</td>
        </tr>
      `;
      })
      .join("");

    // Evidence cards (Photo + Doc)
    let evidenceCardsHtml = "";
    if (includeEvidence && assigned.length > 0) {
      evidenceCardsHtml = `
        <div class="mt-3">
          <div class="text-sm font-bold text-blue-900 mb-1.5">หลักฐานนักกีฬา (${ev.name})</div>
          <div class="grid grid-cols-2 gap-2.5">
            ${assigned
              .map((a) => {
                const st = studentsList.find((s) => s.id === a.studentId);
                if (!st) return "";
                return `
                <div class="border border-slate-400 rounded p-2 flex gap-2 items-center bg-slate-50/40">
                  <div class="w-16 h-20 border border-slate-300 bg-white flex-shrink-0 overflow-hidden flex items-center justify-center">
                    ${st.photoData ? `<img src="${st.photoData}" class="w-full h-full object-cover">` : `<span class="text-[10px] text-slate-400">ไม่มีรูป</span>`}
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="font-bold text-xs text-slate-900 truncate">${a.slotLabel}: ${st.shortName}</div>
                    <div class="text-[11px] text-slate-600">ชั้น ${st.className} • ${st.docType || "บัตร ปชช."}</div>
                    <div class="mt-1 h-14 w-full border border-slate-300 bg-white overflow-hidden flex items-center justify-center">
                      ${st.docData ? `<img src="${st.docData}" class="w-full h-full object-contain">` : `<span class="text-[10px] text-slate-400">ยังไม่มีหลักฐาน</span>`}
                    </div>
                  </div>
                </div>
              `;
              })
              .join("")}
          </div>
        </div>
      `;
    }

    pagesHtml += `
      <div class="a4-page">
        <div>
          <!-- Official Header with Credit -->
          <div class="flex justify-between items-center border-b-2 border-blue-900 pb-1.5 mb-2">
            <span class="ch-badge text-xs">โรงเรียนบ้านส้อเด่นพัฒนา (ส.ด.)</span>
            <span class="text-sm font-bold text-blue-900">แบบส่งรายชื่อและหลักฐานนักกรีฑา เชียงกลางเกมส์ 2569</span>
            <span class="text-xs font-semibold text-slate-600">ผู้จัดทำ: <strong class="text-blue-900">ครูนภรัฐ อุดเต็น</strong></span>
          </div>

          <!-- Solid Blue Rounded Banner -->
          <div class="master-banner px-4 py-2 flex justify-between items-center mb-3">
            <div class="text-base font-bold text-white">${ev.name}</div>
            <div class="text-xs text-blue-100">${ev.group} • ช่องวิ่งที่ ${ev.lane} (รุ่น ${ev.ageGroup} ปี)</div>
          </div>

          <!-- Athletes Table -->
          <table class="w-full border-collapse text-sm">
            <thead>
              <tr class="bg-blue-900 text-white">
                <th class="border border-blue-900 px-2 py-1.5 w-10">ที่</th>
                <th class="border border-blue-900 px-2 py-1.5 w-20">ตำแหน่ง/ไม้</th>
                <th class="border border-blue-900 px-2 py-1.5">ชื่อ - นามสกุล นักเรียน</th>
                <th class="border border-blue-900 px-2 py-1.5 w-14">ชั้น</th>
                <th class="border border-blue-900 px-2 py-1.5 w-28">ว/ด/ป เกิด</th>
                <th class="border border-blue-900 px-2 py-1.5 w-36">เลขประจำตัวประชาชน</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows || `<tr><td colspan="6" class="border border-slate-400 p-4 text-center text-slate-400">ยังไม่ได้จัดตัวนักกีฬา</td></tr>`}
            </tbody>
          </table>

          ${evidenceCardsHtml}
        </div>

        <!-- Certification & Signatures -->
        <div>
          <div class="mt-4 border border-dashed border-slate-400 rounded-lg p-3 bg-slate-50/50 grid grid-cols-2 gap-4 text-center text-xs">
            <div>
              <div class="mb-5">ขอรับรองว่าเป็นนักเรียนโรงเรียนบ้านส้อเด่นพัฒนาจริง</div>
              <div>ลงชื่อ ............................................................ ครูผู้ฝึกสอน</div>
              <div class="font-bold mt-0.5">( นายนภรัฐ อุดเต็น )</div>
              <div>ครู โรงเรียนบ้านส้อเด่นพัฒนา</div>
            </div>
            <div>
              <div class="mb-5">ขอรับรองและอนุมัติส่งรายชื่อเข้าร่วมการแข่งขัน</div>
              <div>ลงชื่อ ............................................................ ผู้รับรอง</div>
              <div class="font-bold mt-0.5">( นายนพคุณ เกรียงศักดานุกูล )</div>
              <div>ผู้อำนวยการโรงเรียนบ้านส้อเด่นพัฒนา</div>
            </div>
          </div>
          <div class="flex justify-between text-[11px] text-slate-500 border-t border-slate-200 pt-1 mt-2">
            <span>เชียงกลางเกมส์ ปีการศึกษา 2569 • อักษรย่อ ส.ด.</span>
            <span>หน้า ${index + 1} จาก ${targetEvents.length}</span>
            <span>ครูผู้ฝึกสอน: ครูนภรัฐ อุดเต็น</span>
          </div>
        </div>
      </div>
    `;
  });

  container.innerHTML = pagesHtml;
};

// ==================== TAB 4: LIVE RESULTS & MEDAL TALLY ====================
function renderResultsTab() {
  const gold = eventsList.filter((e) => e.resultMedal === "gold").length;
  const silver = eventsList.filter((e) => e.resultMedal === "silver").length;
  const bronze = eventsList.filter((e) => e.resultMedal === "bronze").length;

  document.getElementById("medal-gold-count").textContent = gold;
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
      match ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-700"
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
      <div class="bg-white rounded-xl border border-slate-200 p-3 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div class="flex-1 min-w-[220px]">
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold bg-blue-900 text-white px-2 py-0.5 rounded">รุ่น ${ev.ageGroup} ปี</span>
            <span class="text-xs font-semibold text-slate-500">${ev.group} • ช่อง ${ev.lane}</span>
          </div>
          <div class="font-bold text-slate-900 text-base mt-1">${ev.no}. ${ev.name}</div>
          <div class="text-xs text-slate-500">นักกีฬา: ${athletesNames || "ยังไม่ระบุตัวจริง"}</div>
        </div>

        <div class="flex flex-wrap items-center gap-1.5">
          <button onclick="saveEventResult('${ev.id}', 'gold')"
            class="px-3 py-1.5 rounded-lg text-xs font-bold border ${m === "gold" ? "bg-amber-400 text-amber-950 border-amber-500 shadow" : "bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100"}">
            🥇 ทอง (ที่ 1)
          </button>
          <button onclick="saveEventResult('${ev.id}', 'silver')"
            class="px-3 py-1.5 rounded-lg text-xs font-bold border ${m === "silver" ? "bg-slate-400 text-white border-slate-500 shadow" : "bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200"}">
            🥈 เงิน (ที่ 2)
          </button>
          <button onclick="saveEventResult('${ev.id}', 'bronze')"
            class="px-3 py-1.5 rounded-lg text-xs font-bold border ${m === "bronze" ? "bg-orange-400 text-white border-orange-500 shadow" : "bg-orange-50 text-orange-800 border-orange-200 hover:bg-orange-100"}">
            🥉 ทองแดง (ที่ 3)
          </button>
          <button onclick="saveEventResult('${ev.id}', 'other')"
            class="px-3 py-1.5 rounded-lg text-xs font-bold border ${m === "other" ? "bg-blue-600 text-white border-blue-700 shadow" : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"}">
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
